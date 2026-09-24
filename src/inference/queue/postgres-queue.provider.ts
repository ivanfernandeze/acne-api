import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { APP_CONFIG, type AppConfig } from 'src/config/configuration';

import { InferenceJob } from '../inference-job.entity';
import type { ClaimedJob, InferenceJobPayload, QueueProvider } from './queue.provider';

/**
 * PostgreSQL-backed inference queue.
 *
 * `claimNext` uses `FOR UPDATE SKIP LOCKED`, the standard PostgreSQL pattern for a work queue:
 * concurrent workers never hand the same job to two engines.
 *
 * A crashed worker's job is picked up again because the claim also considers jobs whose LEASE has
 * expired — `bloqueado_en` older than `queue.leaseMs`. That column was being written and never
 * read, and the difference is not academic: a connection that dies between the claiming `UPDATE`
 * and its reply leaves the job marked `ejecutando` with nobody behind it, and the portal then
 * shows "el modelo está leyendo el caso" for ever. Observed against a remote database that drops
 * connections.
 */
@Injectable()
export class PostgresQueueProvider implements QueueProvider {
  readonly driver = 'postgres';

  constructor(
    @InjectRepository(InferenceJob) private readonly repository: Repository<InferenceJob>,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async enqueue(payload: InferenceJobPayload): Promise<string> {
    const job = this.repository.create({
      caseId: payload.caseId,
      imageId: payload.imageId,
      requestedBy: payload.requestedBy,
      status: 'pendiente',
      attempts: 0,
      maxAttempts: this.config.queue.maxAttempts,
    });
    const saved = await this.repository.save(job);
    return saved.id;
  }

  /**
   * El `RETURNING` va con ALIAS, y no es cosmética.
   *
   * Las columnas de la tabla están en español y el validador de más abajo pide `case_id` e
   * `image_id`. Sin alias, cada reclamo devolvía una fila que el validador daba por malformada y
   * `claimNext` respondía `null`: el `UPDATE` sí marcaba el trabajo como «ejecutando» y le sumaba
   * un intento, pero NADIE lo ejecutaba. La cola de inferencia llevaba muerta desde el renombrado
   * al español, en silencio y sin un solo error — el análisis se quedaba «pendiente» para siempre.
   *
   * Otra cadena de SQL que ni el compilador ni el linter pueden mirar. Por eso el alias se
   * comprueba ahora en una prueba.
   */
  async claimNext(): Promise<ClaimedJob | null> {
    const raw: unknown = await this.repository.query(
      `UPDATE "trabajos_inferencia"
          SET "estado_codigo" = 'ejecutando',
              "intentos" = "intentos" + 1,
              "bloqueado_en" = now(),
              "actualizado_en" = now()
        WHERE "id" = (
          SELECT "id" FROM "trabajos_inferencia"
           WHERE "estado_codigo" = 'pendiente'
              OR ("estado_codigo" = 'ejecutando'
                  AND "intentos" < "max_intentos"
                  AND "bloqueado_en" < now() - ($1 || ' milliseconds')::interval)
           ORDER BY "creado_en" ASC
           FOR UPDATE SKIP LOCKED
           LIMIT 1
        )
        RETURNING "id",
                  "caso_id"      AS "case_id",
                  "imagen_id"    AS "image_id",
                  "solicitado_por" AS "requested_by",
                  "intentos"     AS "attempts",
                  "max_intentos" AS "max_attempts"`,
      [this.config.queue.leaseMs],
    );

    const row = extractClaimedRow(raw);
    if (row === null) return null;

    return {
      jobId: row.id,
      caseId: row.case_id,
      imageId: row.image_id,
      requestedBy: row.requested_by,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
    };
  }

  /**
   * Marca como fallidos los trabajos abandonados que ya agotaron sus intentos.
   *
   * Sin esto, un trabajo que muriera en su último intento se quedaría en `ejecutando` para
   * siempre: `claimNext` no lo reclama —no le quedan intentos— y nada más lo cierra.
   */
  async expireStale(): Promise<Array<{ jobId: string; caseId: string; imageId: string }>> {
    const raw: unknown = await this.repository.query(
      `UPDATE "trabajos_inferencia"
          SET "estado_codigo" = 'fallido',
              "bloqueado_en" = NULL,
              "ultimo_error" = 'El trabajo quedó abandonado y agotó sus intentos.',
              "actualizado_en" = now()
        WHERE "id" IN (
          SELECT "id" FROM "trabajos_inferencia"
           WHERE "estado_codigo" = 'ejecutando'
             AND "intentos" >= "max_intentos"
             AND "bloqueado_en" < now() - ($1 || ' milliseconds')::interval
           FOR UPDATE SKIP LOCKED
        )
        RETURNING "id", "caso_id" AS "case_id", "imagen_id" AS "image_id"`,
      [this.config.queue.leaseMs],
    );

    if (!Array.isArray(raw)) return [];
    const rows: unknown = Array.isArray(raw[0]) ? raw[0] : raw;
    if (!Array.isArray(rows)) return [];

    return rows.flatMap((row: unknown) => {
      if (typeof row !== 'object' || row === null) return [];
      const record = row as Record<string, unknown>;
      const id = record['id'];
      const caseId = record['case_id'];
      const imageId = record['image_id'];
      if (typeof id !== 'string' || typeof caseId !== 'string' || typeof imageId !== 'string') {
        return [];
      }
      return [{ jobId: id, caseId, imageId }];
    });
  }

  async complete(jobId: string, inferenceId: string): Promise<void> {
    await this.repository.update(
      { id: jobId },
      { status: 'exitoso', inferenceId, lockedAt: null, lastError: null },
    );
  }

  async fail(jobId: string, error: string): Promise<void> {
    const job = await this.repository.findOne({ where: { id: jobId } });
    if (job === null) return;

    const exhausted = job.attempts >= job.maxAttempts;
    await this.repository.update(
      { id: jobId },
      {
        status: exhausted ? 'fallido' : 'pendiente',
        lockedAt: null,
        lastError: error.slice(0, 2000),
      },
    );
  }

  async countByStatus(): Promise<Record<string, number>> {
    const rows = await this.repository
      .createQueryBuilder('job')
      .select('job.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('job.status')
      .getRawMany<{ status: string; count: string }>();

    const result: Record<string, number> = { pending: 0, running: 0, succeeded: 0, failed: 0 };
    for (const row of rows) result[row.status] = Number(row.count);
    return result;
  }
}

interface RawClaimedJob {
  id: string;
  case_id: string;
  image_id: string;
  requested_by: string;
  attempts: number;
  max_attempts: number;
}

/**
 * Normalises what TypeORM returns for `UPDATE ... RETURNING` and validates the row.
 *
 * TypeORM does not hand back a plain array of rows for a RETURNING statement: depending on the
 * driver and the statement type it may return `[rows, affectedCount]`. On an empty queue that
 * makes `raw[0]` an empty ARRAY rather than `undefined`, which passes a naive `=== undefined`
 * check and yields a phantom job whose every field is `undefined`. Downstream, a TypeORM `where`
 * built from undefined values silently drops those conditions and matches the newest row instead —
 * so an empty queue would repeatedly grab an unrelated, already-completed inference and flip it to
 * `running`. Validating the shape here is what keeps an idle worker genuinely idle.
 */
function extractClaimedRow(raw: unknown): RawClaimedJob | null {
  if (!Array.isArray(raw)) return null;

  const candidates: unknown = Array.isArray(raw[0]) ? raw[0] : raw;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;

  const row: unknown = candidates[0];
  if (typeof row !== 'object' || row === null) return null;

  const record = row as Record<string, unknown>;
  const hasIdentifiers =
    typeof record['id'] === 'string' &&
    typeof record['case_id'] === 'string' &&
    typeof record['image_id'] === 'string';

  return hasIdentifiers ? (record as unknown as RawClaimedJob) : null;
}
