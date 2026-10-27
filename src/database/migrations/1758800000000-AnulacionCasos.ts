import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Anulación de casos, con rastro.
 *
 * Desde el 25/10/2026 cualquier rol puede quitar un caso. Si aún no tiene evidencia del estudio
 * (diagnóstico, cronometraje de revisión, inferencia o receta) se BORRA de verdad, con sus fotos.
 * Si ya la tiene, borrarlo destruiría mediciones de TRM, TPD o TCAD: se ANULA. El caso anulado
 * desaparece de la bandeja, de los indicadores, de los contrastes y de las exportaciones, pero la
 * fila queda, con quién lo anuló, cuándo y por qué, para que la auditoría pueda reconstruirlo.
 */
export class AnulacionCasos1758800000000 implements MigrationInterface {
  name = 'AnulacionCasos1758800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "casos"
      ADD COLUMN IF NOT EXISTS "anulado_en" timestamptz,
      ADD COLUMN IF NOT EXISTS "anulado_por" uuid,
      ADD COLUMN IF NOT EXISTS "motivo_anulacion" text`);
    await queryRunner.query(
      `ALTER TABLE "casos" ADD CONSTRAINT "FK_casos_anulado_por"
         FOREIGN KEY ("anulado_por") REFERENCES "usuarios"("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "casos" ADD CONSTRAINT "CHK_casos_anulacion"
         CHECK ("anulado_en" IS NULL OR "motivo_anulacion" IS NOT NULL)`,
    );
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_casos_anulado_en" ON "casos" ("anulado_en")`);
    await queryRunner.query(
      `COMMENT ON COLUMN "casos"."anulado_en" IS 'Cuando se anulo el caso. Un caso anulado no cuenta en la bandeja, los indicadores, los contrastes ni las exportaciones.'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "casos"."motivo_anulacion" IS 'Por que se anulo (obligatorio, minimo 10 caracteres en la API).'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_casos_anulado_en"`);
    await queryRunner.query(`ALTER TABLE "casos" DROP CONSTRAINT IF EXISTS "CHK_casos_anulacion"`);
    await queryRunner.query(`ALTER TABLE "casos" DROP CONSTRAINT IF EXISTS "FK_casos_anulado_por"`);
    await queryRunner.query(`ALTER TABLE "casos"
      DROP COLUMN IF EXISTS "motivo_anulacion",
      DROP COLUMN IF EXISTS "anulado_por",
      DROP COLUMN IF EXISTS "anulado_en"`);
  }
}
