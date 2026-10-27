import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { ANAMNESIS_QUESTIONS, type AnamnesisAnswer } from 'src/common/domain';

import { buildAnexo4Workbook, type Anexo4TimingRow } from './anexo4-workbook';

/**
 * CSV export of the study measurements.
 *
 * Covers: section 2 ("Exportación de datasets pretest/postest listos para análisis estadístico"),
 * section 9.2 (`/stats/dataset-export`) and the Section 11 deliverable. Restricted to `admin`
 * by RF-TR-02.
 *
 * Synthetic seed rows are excluded unless explicitly requested, and when they are included the
 * `es_sintetico` column makes it impossible to mistake them for real evidence.
 */
export type DatasetName =
  'mediciones' | 'tiempos' | 'diagnosticos' | 'jornadas' | 'encuestas' | 'anamnesis';

export const DATASET_NAMES: readonly DatasetName[] = [
  'mediciones',
  'tiempos',
  'diagnosticos',
  'jornadas',
  'encuestas',
  'anamnesis',
];

export type ExportMode = 'pretest' | 'postest';
export const EXPORT_MODES: readonly ExportMode[] = ['pretest', 'postest'];

const MODE_FILTERABLE: ReadonlySet<DatasetName> = new Set<DatasetName>([
  'tiempos',
  'diagnosticos',
  'jornadas',
  'encuestas',
]);

@Injectable()
export class DatasetExportService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * `mode` restringe a una sola condición (pretest o postest) los datasets en formato largo.
   * `mediciones` (ancho, pretest y postest del mismo caso en una fila) y `anamnesis` (por caso, sin
   * condición) no lo admiten: filtrarlos dejaría columnas vacías o vaciaría el dataset.
   */
  async export(
    dataset: DatasetName,
    includeSynthetic: boolean,
    mode: ExportMode | null = null,
  ): Promise<string> {
    const params = MODE_FILTERABLE.has(dataset) ? [includeSynthetic, mode] : [includeSynthetic];
    const rows = await this.dataSource.query<Array<Record<string, unknown>>>(
      this.queryFor(dataset),
      params,
    );
    return this.toCsv(dataset === 'anamnesis' ? rows.map(flattenAnamnesis) : rows);
  }

  /** Anexo 4 (OE1) en .xlsx con el formato de la ficha: t₀ y t₁ en hora de Lima, fuente e ID. */
  async anexo4Workbook(includeSynthetic: boolean, mode: ExportMode | null): Promise<Buffer> {
    const rows = await this.dataSource.query<Anexo4TimingRow[]>(
      `
      SELECT t."id",
             c."codigo_caso"          AS "caso",
             p."codigo_paciente"      AS "paciente",
             t."modo_estudio_codigo"  AS "modo",
             t."t0",
             t."t1",
             t."duracion_segundos"    AS "duracion_seg",
             t."valido"               AS "valida",
             t."origen_codigo"        AS "origen",
             c."es_sintetico"         AS "es_sintetico"
        FROM "cronometrajes_revision" t
        JOIN "casos" c ON c."id" = t."caso_id"
        JOIN "pacientes" p ON p."id" = c."paciente_id"
       WHERE ($1::boolean OR c."es_sintetico" = false)
         AND c."anulado_en" IS NULL
         AND ($2::text IS NULL OR t."modo_estudio_codigo" = $2)
       ORDER BY t."t0" ASC, c."codigo_caso" ASC`,
      [includeSynthetic, mode],
    );
    return buildAnexo4Workbook(rows, mode);
  }

  private queryFor(dataset: DatasetName): string {
    switch (dataset) {
      /**
       * Wide format, one row per case: the shape a paired analysis expects, with the pretest and
       * postest measurement of the same unit side by side.
       */
      case 'mediciones':
        return `
          SELECT c."codigo_caso"                              AS "caso",
                 p."codigo_paciente"                           AS "paciente",
                 c."clase_iga_referencia"                       AS "patron_referencia",
                 (pre."duracion_segundos"::numeric / 60)     AS "trm_pretest_min",
                 (post."duracion_segundos"::numeric / 60)    AS "trm_postest_min",
                 dpre."clase_iga_codigo"                           AS "iga_manual_pretest",
                 dpost."clase_iga_codigo"                          AS "iga_especialista_postest",
                 ai."clase_iga_codigo"                             AS "iga_ia",
                 ai."confianza"                            AS "confianza_ia",
                 CASE WHEN c."clase_iga_referencia" IS NULL OR dpre."clase_iga_codigo" IS NULL THEN NULL WHEN dpre."clase_iga_codigo" = c."clase_iga_referencia" THEN 1 ELSE 0 END AS "acierto_pretest",
                 CASE WHEN c."clase_iga_referencia" IS NULL OR ai."clase_iga_codigo" IS NULL THEN NULL WHEN ai."clase_iga_codigo" = c."clase_iga_referencia" THEN 1 ELSE 0 END AS "acierto_postest",
                 c."es_sintetico"                           AS "es_sintetico"
            FROM "casos" c
            JOIN "pacientes" p ON p."id" = c."paciente_id"
            LEFT JOIN "cronometrajes_revision" pre  ON pre."caso_id"  = c."id" AND pre."modo_estudio_codigo"  = 'pretest'
            LEFT JOIN "cronometrajes_revision" post ON post."caso_id" = c."id" AND post."modo_estudio_codigo" = 'postest'
            LEFT JOIN "diagnosticos" dpre      ON dpre."caso_id" = c."id" AND dpre."modo_estudio_codigo" = 'pretest'
            LEFT JOIN "diagnosticos" dpost     ON dpost."caso_id"= c."id" AND dpost."modo_estudio_codigo"= 'postest'
            LEFT JOIN LATERAL (
                 SELECT i."clase_iga_codigo", i."confianza"
                   FROM "inferencias_ia" i
                  WHERE i."caso_id" = c."id" AND i."estado_codigo" = 'exitoso'
                  ORDER BY i."creado_en" DESC LIMIT 1
            ) ai ON true
           WHERE ($1::boolean OR c."es_sintetico" = false)
             AND c."anulado_en" IS NULL
           ORDER BY c."codigo_caso" ASC`;

      case 'tiempos':
        return `
          SELECT c."codigo_caso"   AS "caso",
                 u."nombre_completo"   AS "profesional",
                 t."modo_estudio_codigo"  AS "modo",
                 t."t0",
                 t."t1",
                 t."duracion_segundos" AS "duracion_seg",
                 (t."duracion_segundos"::numeric / 60) AS "duracion_min",
                 t."valido"       AS "valida",
                 c."es_sintetico" AS "es_sintetico"
            FROM "cronometrajes_revision" t
            JOIN "casos" c ON c."id" = t."caso_id"
            JOIN "usuarios" u ON u."id" = t."usuario_id"
           WHERE ($1::boolean OR c."es_sintetico" = false)
             AND c."anulado_en" IS NULL
             AND ($2::text IS NULL OR t."modo_estudio_codigo" = $2)
           ORDER BY t."t0" ASC`;

      case 'diagnosticos':
        return `
          SELECT c."codigo_caso"        AS "caso",
                 u."nombre_completo"        AS "profesional",
                 d."modo_estudio_codigo"       AS "modo",
                 d."clase_iga_codigo"        AS "iga_especialista",
                 d."puntaje_gags"       AS "gags",
                 c."clase_iga_referencia" AS "patron_referencia",
                 d."acuerdo"        AS "resultado",
                 d."sugerencia_aceptada" AS "acepto_sugerencia_ia",
                 d."creado_en"       AS "fecha",
                 (d."corregido_en" IS NOT NULL) AS "corregido",
                 d."clase_iga_original"         AS "iga_original",
                 d."motivo_correccion"          AS "motivo_correccion",
                 c."es_sintetico"     AS "es_sintetico"
            FROM "diagnosticos" d
            JOIN "casos" c ON c."id" = d."caso_id"
            JOIN "usuarios" u ON u."id" = d."usuario_id"
           WHERE ($1::boolean OR c."es_sintetico" = false)
             AND c."anulado_en" IS NULL
             AND ($2::text IS NULL OR d."modo_estudio_codigo" = $2)
           ORDER BY d."creado_en" ASC`;

      case 'jornadas':
        return `
          SELECT u."nombre_completo"              AS "profesional",
                 s."modo_estudio_codigo"             AS "modo",
                 s."turno_codigo"                  AS "turno",
                 s."iniciada_en"             AS "inicio",
                 s."finalizada_en"               AS "fin",
                 s."casos_revisados"         AS "ncr",
                 s."horas_declaradas" AS "tj_horas",
                 s."tcad"                   AS "tcad_casos_hora",
                 s."es_sintetico"           AS "es_sintetico"
            FROM "jornadas_trabajo" s
            JOIN "usuarios" u ON u."id" = s."usuario_id"
           WHERE ($1::boolean OR s."es_sintetico" = false)
             AND s."finalizada_en" IS NOT NULL
             AND ($2::text IS NULL OR s."modo_estudio_codigo" = $2)
           ORDER BY s."iniciada_en" ASC`;

      case 'encuestas':
        return `
          SELECT u."nombre_completo"       AS "profesional",
                 r."modo_estudio_codigo"      AS "modo",
                 a."item_numero"     AS "item",
                 a."puntaje"           AS "puntaje",
                 r."puntos_obtenidos" AS "po",
                 r."puntos_totales"    AS "pt",
                 r."tsp_pct"         AS "tsp_pct",
                 r."promedio_likert"     AS "likert_promedio",
                 r."enviada_en"    AS "fecha",
                 r."es_sintetico"    AS "es_sintetico"
            FROM "respuestas_encuesta" r
            JOIN "detalle_respuestas_encuesta" a ON a."respuesta_id" = r."id"
            JOIN "usuarios" u ON u."id" = r."usuario_id"
           WHERE ($1::boolean OR r."es_sintetico" = false)
             AND ($2::text IS NULL OR r."modo_estudio_codigo" = $2)
           ORDER BY r."enviada_en" ASC, a."item_numero" ASC`;

      /**
       * One row per case, one column per catalogue key.
       *
       * The answers live in `respuestas_anamnesis` since the normalisation of 05/09/2026, so they
       * are aggregated back into one object per case here and spread into columns by
       * `flattenAnamnesis`. Long format — a row per answer — would have been the direct reading of
       * the new schema and is the wrong export: an analyst who wants a case-level contrast in SPSS
       * or R would have to pivot it back first, and the catalogue would no longer guarantee that
       * every row carries the same headers in the same order.
       *
       * Referenced by CASE CODE only — no name, no document — like every other dataset the thesis
       * exports (RF-TR-03). `version_cuestionario` is what makes the file reproducible: it says
       * which catalogue the answers were given against (RNF-03, RNF-05).
       */
      case 'anamnesis':
        return `
          SELECT c."codigo_caso"          AS "caso",
                 p."codigo_paciente"      AS "paciente",
                 c."creado_en"            AS "fecha_visita",
                 a."version_cuestionario" AS "version_cuestionario",
                 a."completa"             AS "completa",
                 COALESCE(
                   (SELECT JSONB_OBJECT_AGG(
                             q."clave",
                             JSONB_BUILD_OBJECT(
                               'value', COALESCE(
                                 TO_JSONB(r."valor_texto"),
                                 TO_JSONB(r."valor_booleano"),
                                 TO_JSONB(r."valor_numerico"),
                                 (SELECT JSONB_AGG(o."valor" ORDER BY o."orden")
                                    FROM "respuestas_anamnesis_opcion" ro
                                    JOIN "opciones_pregunta" o ON o."id" = ro."opcion_id"
                                   WHERE ro."respuesta_id" = r."id")
                               ),
                               'detail', TO_JSONB(r."detalle")
                             ))
                      FROM "respuestas_anamnesis" r
                      JOIN "preguntas_anamnesis" q ON q."id" = r."pregunta_id"
                     WHERE r."anamnesis_id" = a."id"),
                   '{}'::jsonb
                 )                        AS "respuestas",
                 c."es_sintetico"         AS "es_sintetico"
            FROM "anamnesis_caso" a
            JOIN "casos" c ON c."id" = a."caso_id"
            JOIN "pacientes" p ON p."id" = c."paciente_id"
           WHERE ($1::boolean OR c."es_sintetico" = false)
             AND c."anulado_en" IS NULL
           ORDER BY c."creado_en" ASC`;
    }
  }

  /** RFC 4180 CSV with a UTF-8 BOM so Excel in Spanish locales opens accents correctly. */
  private toCsv(rows: Array<Record<string, unknown>>): string {
    if (rows.length === 0) return '﻿';
    const first = rows[0];
    if (first === undefined) return '﻿';

    const headers = Object.keys(first);
    const lines = [headers.join(',')];

    for (const row of rows) {
      lines.push(headers.map((header) => this.escape(row[header])).join(','));
    }
    return `﻿${lines.join('\r\n')}\r\n`;
  }

  private escape(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'boolean') return value ? 'true' : 'false';

    // A `jsonb` column (class_probs, audit metadata) arrives as an object; `String()` would write
    // the literal "[object Object]" into the CSV the thesis analyses, silently losing the value.
    const text =
      typeof value === 'object' ? JSON.stringify(value) : (value as string | number).toString();
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }
}

/**
 * Spreads the `answers` JSON into one column per catalogue key.
 *
 * A single JSON column would technically be an export, but nobody can run a contrast on it in SPSS
 * or R. The catalogue drives the column set, so every row has the same headers in the same order
 * even when a patient left questions blank or the hormonal block did not apply to them.
 */
function flattenAnamnesis(row: Record<string, unknown>): Record<string, unknown> {
  const answers = (row['respuestas'] ?? {}) as Record<string, AnamnesisAnswer | undefined>;
  const flat: Record<string, unknown> = {
    caso: row['caso'],
    paciente: row['paciente'],
    fecha_visita: row['fecha_visita'],
    version_cuestionario: row['version_cuestionario'],
    completa: row['completa'],
  };

  for (const question of ANAMNESIS_QUESTIONS) {
    const answer = answers[question.key];
    const value = answer?.value ?? null;
    flat[question.key] = Array.isArray(value) ? value.join('|') : value;
    if (question.detail !== undefined) {
      flat[`${question.key}_detalle`] = answer?.detail ?? null;
    }
  }

  flat['es_sintetico'] = row['es_sintetico'];
  return flat;
}
