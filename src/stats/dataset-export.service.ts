import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

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
export type DatasetName = 'mediciones' | 'tiempos' | 'diagnosticos' | 'jornadas' | 'encuestas';

export const DATASET_NAMES: readonly DatasetName[] = [
  'mediciones',
  'tiempos',
  'diagnosticos',
  'jornadas',
  'encuestas',
];

@Injectable()
export class DatasetExportService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async export(dataset: DatasetName, includeSynthetic: boolean): Promise<string> {
    const rows = await this.dataSource.query(this.queryFor(dataset), [includeSynthetic]);
    return this.toCsv(rows as Array<Record<string, unknown>>);
  }

  private queryFor(dataset: DatasetName): string {
    switch (dataset) {
      /**
       * Wide format, one row per case: the shape a paired analysis expects, with the pretest and
       * postest measurement of the same unit side by side.
       */
      case 'mediciones':
        return `
          SELECT c."case_code"                              AS "caso",
                 p."patient_code"                           AS "paciente",
                 c."ground_truth_iga"                       AS "patron_referencia",
                 (pre."duration_seconds"::numeric / 60)     AS "trm_pretest_min",
                 (post."duration_seconds"::numeric / 60)    AS "trm_postest_min",
                 dpre."iga_class"                           AS "iga_manual_pretest",
                 dpost."iga_class"                          AS "iga_especialista_postest",
                 ai."iga_class"                             AS "iga_ia",
                 ai."confidence"                            AS "confianza_ia",
                 CASE WHEN dpre."iga_class" = c."ground_truth_iga" THEN 1 ELSE 0 END AS "acierto_pretest",
                 CASE WHEN ai."iga_class"  = c."ground_truth_iga" THEN 1 ELSE 0 END AS "acierto_postest",
                 c."is_synthetic"                           AS "es_sintetico"
            FROM "cases" c
            JOIN "patients" p ON p."id" = c."patient_id"
            LEFT JOIN "review_timings" pre  ON pre."case_id"  = c."id" AND pre."study_mode"  = 'pretest'
            LEFT JOIN "review_timings" post ON post."case_id" = c."id" AND post."study_mode" = 'postest'
            LEFT JOIN "diagnoses" dpre      ON dpre."case_id" = c."id" AND dpre."study_mode" = 'pretest'
            LEFT JOIN "diagnoses" dpost     ON dpost."case_id"= c."id" AND dpost."study_mode"= 'postest'
            LEFT JOIN LATERAL (
                 SELECT i."iga_class", i."confidence"
                   FROM "ai_inferences" i
                  WHERE i."case_id" = c."id" AND i."status" = 'succeeded'
                  ORDER BY i."created_at" DESC LIMIT 1
            ) ai ON true
           WHERE ($1::boolean OR c."is_synthetic" = false)
           ORDER BY c."case_code" ASC`;

      case 'tiempos':
        return `
          SELECT c."case_code"   AS "caso",
                 u."full_name"   AS "profesional",
                 t."study_mode"  AS "modo",
                 t."t0",
                 t."t1",
                 t."duration_seconds" AS "duracion_seg",
                 (t."duration_seconds"::numeric / 60) AS "duracion_min",
                 t."valid"       AS "valida",
                 c."is_synthetic" AS "es_sintetico"
            FROM "review_timings" t
            JOIN "cases" c ON c."id" = t."case_id"
            JOIN "users" u ON u."id" = t."user_id"
           WHERE ($1::boolean OR c."is_synthetic" = false)
           ORDER BY t."t0" ASC`;

      case 'diagnosticos':
        return `
          SELECT c."case_code"        AS "caso",
                 u."full_name"        AS "profesional",
                 d."study_mode"       AS "modo",
                 d."iga_class"        AS "iga_especialista",
                 d."gags_score"       AS "gags",
                 c."ground_truth_iga" AS "patron_referencia",
                 d."agreement"        AS "resultado",
                 d."ai_suggestion_accepted" AS "acepto_sugerencia_ia",
                 d."created_at"       AS "fecha",
                 c."is_synthetic"     AS "es_sintetico"
            FROM "diagnoses" d
            JOIN "cases" c ON c."id" = d."case_id"
            JOIN "users" u ON u."id" = d."user_id"
           WHERE ($1::boolean OR c."is_synthetic" = false)
           ORDER BY d."created_at" ASC`;

      case 'jornadas':
        return `
          SELECT u."full_name"              AS "profesional",
                 s."study_mode"             AS "modo",
                 s."shift"                  AS "turno",
                 s."started_at"             AS "inicio",
                 s."ended_at"               AS "fin",
                 s."cases_reviewed"         AS "ncr",
                 s."declared_duration_hours" AS "tj_horas",
                 s."tcad"                   AS "tcad_casos_hora",
                 s."is_synthetic"           AS "es_sintetico"
            FROM "work_sessions" s
            JOIN "users" u ON u."id" = s."user_id"
           WHERE ($1::boolean OR s."is_synthetic" = false)
             AND s."ended_at" IS NOT NULL
           ORDER BY s."started_at" ASC`;

      case 'encuestas':
        return `
          SELECT u."full_name"       AS "profesional",
                 r."study_mode"      AS "modo",
                 a."item_number"     AS "item",
                 a."score"           AS "puntaje",
                 r."points_obtained" AS "po",
                 r."total_points"    AS "pt",
                 r."tsp_pct"         AS "tsp_pct",
                 r."mean_likert"     AS "likert_promedio",
                 r."submitted_at"    AS "fecha",
                 r."is_synthetic"    AS "es_sintetico"
            FROM "survey_responses" r
            JOIN "survey_answers" a ON a."response_id" = r."id"
            JOIN "users" u ON u."id" = r."user_id"
           WHERE ($1::boolean OR r."is_synthetic" = false)
           ORDER BY r."submitted_at" ASC, a."item_number" ASC`;
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
