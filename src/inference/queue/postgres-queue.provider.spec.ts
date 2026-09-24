import { Repository } from 'typeorm';

import type { AppConfig } from 'src/config/configuration';

import type { InferenceJob } from '../inference-job.entity';
import { PostgresQueueProvider } from './postgres-queue.provider';

/**
 * Regression tests for the queue's row extraction.
 *
 * These exist because of a real defect: TypeORM returns `[rows, affectedCount]` for an
 * `UPDATE ... RETURNING`, so an empty queue produced `raw[0] === []` — an empty ARRAY, which is
 * not `undefined` and therefore passed the original guard. The worker then "claimed" a job whose
 * every field was `undefined`, and because a TypeORM `where` silently drops undefined conditions,
 * it flipped an unrelated, already-completed inference to `running` on every poll tick.
 */
describe('PostgresQueueProvider.claimNext', () => {
  const config = { queue: { maxAttempts: 3, leaseMs: 120_000 } } as AppConfig;

  function buildProvider(rawResult: unknown): PostgresQueueProvider {
    const repository = { query: jest.fn().mockResolvedValue(rawResult) } as unknown as Repository<InferenceJob>;
    return new PostgresQueueProvider(repository, config);
  }

  it('returns null when the queue is empty and the driver reports plain rows', async () => {
    await expect(buildProvider([]).claimNext()).resolves.toBeNull();
  });

  it('returns null when the driver wraps rows in a [rows, affected] tuple', async () => {
    await expect(buildProvider([[], 0]).claimNext()).resolves.toBeNull();
  });

  it('returns null for a row without identifiers', async () => {
    await expect(buildProvider([{ attempts: 1 }]).claimNext()).resolves.toBeNull();
  });

  it('returns null when the driver returns something unexpected', async () => {
    await expect(buildProvider(null).claimNext()).resolves.toBeNull();
    await expect(buildProvider(undefined).claimNext()).resolves.toBeNull();
    await expect(buildProvider([[null]]).claimNext()).resolves.toBeNull();
  });

  it('claims a well-formed job from plain rows', async () => {
    const provider = buildProvider([
      {
        id: 'job-1',
        case_id: 'case-1',
        image_id: 'image-1',
        requested_by: 'user-1',
        attempts: 1,
        max_attempts: 3,
      },
    ]);

    await expect(provider.claimNext()).resolves.toEqual({
      jobId: 'job-1',
      caseId: 'case-1',
      imageId: 'image-1',
      requestedBy: 'user-1',
      attempts: 1,
      maxAttempts: 3,
    });
  });

  it('claims a well-formed job from a [rows, affected] tuple', async () => {
    const provider = buildProvider([
      [
        {
          id: 'job-2',
          case_id: 'case-2',
          image_id: 'image-2',
          requested_by: 'user-2',
          attempts: 2,
          max_attempts: 3,
        },
      ],
      1,
    ]);

    const claimed = await provider.claimNext();
    expect(claimed?.jobId).toBe('job-2');
    expect(claimed?.caseId).toBe('case-2');
  });

  /**
   * El fallo que dejó la cola muerta sin un solo error.
   *
   * Las columnas están en español (`caso_id`, `imagen_id`) y el validador pide `case_id` e
   * `image_id`. Sin alias, cada reclamo marcaba el trabajo como «ejecutando» y le sumaba un
   * intento, pero `claimNext` devolvía `null` y nadie lo ejecutaba: el análisis se quedaba
   * «pendiente» para siempre. Ni el compilador ni el linter ven dentro de una cadena de SQL, de
   * modo que lo mira esta prueba.
   */
  it.each(['case_id', 'image_id', 'requested_by', 'attempts', 'max_attempts'])(
    'devuelve %s con alias, que es el nombre por el que se lee la fila',
    async (column) => {
      const repository = { query: jest.fn().mockResolvedValue([]) } as unknown as Repository<InferenceJob>;
      await new PostgresQueueProvider(repository, config).claimNext();

      const [sql] = (repository.query as jest.Mock).mock.calls[0] as [string];
      expect(sql).toMatch(new RegExp(`AS\\s+"${column}"`));
    },
  );

  it('descarta la fila sin alias en vez de inventarse un trabajo', async () => {
    // Lo que devolvía la consulta rota. Que el validador diga «null» es correcto; lo que estaba
    // mal era la consulta.
    const provider = buildProvider([
      { id: 'job-3', caso_id: 'case-3', imagen_id: 'image-3', intentos: 1, max_intentos: 3 },
    ]);
    await expect(provider.claimNext()).resolves.toBeNull();
  });

  it('also considers jobs abandoned mid-flight, with the lease as the parameter', async () => {
    // El fallo real: un trabajo reclamado cuya conexión murió antes de responder se quedaba en
    // «ejecutando» para siempre, porque el reclamo solo miraba «pendiente». `bloqueado_en` se
    // escribía y no lo leía nadie.
    const repository = { query: jest.fn().mockResolvedValue([]) } as unknown as Repository<InferenceJob>;
    await new PostgresQueueProvider(repository, config).claimNext();

    const [sql, params] = (repository.query as jest.Mock).mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("'ejecutando'");
    expect(sql).toContain('bloqueado_en');
    expect(sql).toContain('"intentos" < "max_intentos"');
    expect(params).toEqual([120_000]);
  });
});

describe('PostgresQueueProvider.expireStale', () => {
  const config = { queue: { maxAttempts: 3, leaseMs: 120_000 } } as AppConfig;

  function buildProvider(rawResult: unknown): PostgresQueueProvider {
    const repository = { query: jest.fn().mockResolvedValue(rawResult) } as unknown as Repository<InferenceJob>;
    return new PostgresQueueProvider(repository, config);
  }

  it('returns the abandoned jobs so their inferences can be closed', async () => {
    const provider = buildProvider([
      [{ id: 'job-9', case_id: 'case-9', image_id: 'image-9' }],
      1,
    ]);

    await expect(provider.expireStale()).resolves.toEqual([
      { jobId: 'job-9', caseId: 'case-9', imageId: 'image-9' },
    ]);
  });

  it('returns an empty list rather than a phantom job', async () => {
    await expect(buildProvider([]).expireStale()).resolves.toEqual([]);
    await expect(buildProvider([[], 0]).expireStale()).resolves.toEqual([]);
    await expect(buildProvider([{ id: 'sin-caso' }]).expireStale()).resolves.toEqual([]);
    await expect(buildProvider(null).expireStale()).resolves.toEqual([]);
  });
});
