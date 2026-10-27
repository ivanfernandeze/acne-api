import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Devuelve a «diagnosticado» los casos que el especialista ya firmó.
 *
 * Firmar el diagnóstico ponía el caso en `diagnosticado`, pero el portal vuelve a abrir la ficha
 * después de firmar y `POST /cases/:id/open` escribía `en_revision` sin mirar el estado: todos los
 * casos diagnosticados de la base (31 de 31 el 25/10/2026) se veían «En revisión». El servicio ya
 * no lo hace; esto corrige las filas que quedaron mal.
 *
 * Solo cuenta el diagnóstico del sistema (`postest`): el de pretest es la transcripción del registro
 * manual de la clínica y no significa que el caso se haya revisado aquí. Los casos anulados no se
 * tocan.
 */
export class EstadoDiagnosticados1758900000000 implements MigrationInterface {
  name = 'EstadoDiagnosticados1758900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "casos" c
         SET "estado_codigo" = 'diagnosticado'
       WHERE c."estado_codigo" IN ('en_revision', 'procesado_ia')
         AND c."anulado_en" IS NULL
         AND EXISTS (
               SELECT 1 FROM "diagnosticos" d
                WHERE d."caso_id" = c."id" AND d."modo_estudio_codigo" = 'postest'
             )`);
  }

  public async down(): Promise<void> {
    // Nothing to undo: the previous state was the defect, and which rows it hit is not recorded.
  }
}
