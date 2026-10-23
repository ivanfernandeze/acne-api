import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Corrección de un diagnóstico por el administrador, con rastro.
 *
 * Un diagnóstico es la medición de OE2 y no se edita en silencio. Cuando el administrador corrige
 * uno (un error de captura, no un cambio de criterio), la fila conserva la clase IGA con la que se
 * emitió, quién la corrigió, cuándo y por qué. Así el conjunto de datos puede informar cuántas
 * mediciones fueron corregidas y las exportaciones lo marcan.
 *
 * Solo se guarda el valor ORIGINAL de la primera corrección: corregir dos veces no lo pisa.
 */
export class CorreccionDiagnostico1758600000000 implements MigrationInterface {
  name = 'CorreccionDiagnostico1758600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "diagnosticos"
      ADD COLUMN IF NOT EXISTS "clase_iga_original" varchar(24),
      ADD COLUMN IF NOT EXISTS "corregido_por" uuid,
      ADD COLUMN IF NOT EXISTS "corregido_en" timestamptz,
      ADD COLUMN IF NOT EXISTS "motivo_correccion" text`);
    await queryRunner.query(
      `ALTER TABLE "diagnosticos" ADD CONSTRAINT "FK_diagnosticos_corregido_por"
         FOREIGN KEY ("corregido_por") REFERENCES "usuarios"("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "diagnosticos" ADD CONSTRAINT "FK_diagnosticos_clase_original"
         FOREIGN KEY ("clase_iga_original") REFERENCES "clases_iga"("codigo")`,
    );
    await queryRunner.query(
      `ALTER TABLE "diagnosticos" ADD CONSTRAINT "CHK_diagnosticos_correccion"
         CHECK ("corregido_en" IS NULL OR ("motivo_correccion" IS NOT NULL AND "clase_iga_original" IS NOT NULL))`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "diagnosticos"."clase_iga_original" IS 'Clase IGA con la que se emitio el diagnostico, antes de la primera correccion del administrador. Nulo si nunca se corrigio.'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "diagnosticos"."motivo_correccion" IS 'Por que el administrador corrigio la clase IGA (obligatorio, minimo 15 caracteres en la API).'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "diagnosticos" DROP CONSTRAINT IF EXISTS "CHK_diagnosticos_correccion"`);
    await queryRunner.query(`ALTER TABLE "diagnosticos" DROP CONSTRAINT IF EXISTS "FK_diagnosticos_clase_original"`);
    await queryRunner.query(`ALTER TABLE "diagnosticos" DROP CONSTRAINT IF EXISTS "FK_diagnosticos_corregido_por"`);
    await queryRunner.query(`ALTER TABLE "diagnosticos"
      DROP COLUMN IF EXISTS "motivo_correccion", DROP COLUMN IF EXISTS "corregido_en",
      DROP COLUMN IF EXISTS "corregido_por", DROP COLUMN IF EXISTS "clase_iga_original"`);
  }
}
