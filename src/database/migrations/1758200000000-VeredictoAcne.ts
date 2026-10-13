import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * El motor solo gradúa acné: lo demás vuelve como `no_acne`, sin clase.
 *
 * Los tres clasificadores IGA se entrenaron solo con ACNE04, que no tiene nada que no sea acné, y
 * por eso graduaban cualquier cosa: pecas, vitíligo, otra dermatosis o piel sana salían con un
 * grado de acné. El motor pone ahora un filtro binario (acné / no acné) antes de graduar. Cuando
 * dice `no_acne`, la inferencia termina EXITOSA pero sin clase IGA, sin GAGS y sin Grad-CAM, y el
 * portal avisa de la incongruencia en lugar de sugerir un grado.
 *
 *  1. **`veredicto_codigo`**: `acne` | `no_acne`. Las filas anteriores eran todas graduadas: `acne`.
 *  2. **`probabilidad_acne`** y **`version_filtro`**: lo que decidió el veredicto, para poder
 *     releerlo (RNF-03). Nulos cuando el motor no tenía filtro cargado.
 *
 * El filtro vive en la inferencia y no en el cribado de admisión: la inferencia no se invoca en
 * pretest, así que el veredicto no puede filtrarse a esa condición (RF-TR-01).
 */
export class VeredictoAcne1758200000000 implements MigrationInterface {
  name = 'VeredictoAcne1758200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "inferencias_ia" ADD COLUMN IF NOT EXISTS "veredicto_codigo" varchar(12) NOT NULL DEFAULT 'acne'`,
    );
    await queryRunner.query(
      `ALTER TABLE "inferencias_ia" ADD CONSTRAINT "CHK_inferencias_veredicto"
         CHECK ("veredicto_codigo" IN ('acne','no_acne'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "inferencias_ia" ADD COLUMN IF NOT EXISTS "probabilidad_acne" double precision
         CHECK ("probabilidad_acne" IS NULL OR ("probabilidad_acne" >= 0 AND "probabilidad_acne" <= 1))`,
    );
    await queryRunner.query(
      `ALTER TABLE "inferencias_ia" ADD COLUMN IF NOT EXISTS "version_filtro" varchar(120)`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "inferencias_ia"."veredicto_codigo" IS
       'acne: graduada. no_acne: el filtro previo determino que la imagen no muestra acne y no se graduo (clase, GAGS y mapa de calor nulos).'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "inferencias_ia"."probabilidad_acne" IS
       'Probabilidad de acne segun el filtro previo. Nulo si el motor no tenia filtro.'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "inferencias_ia" DROP COLUMN IF EXISTS "version_filtro"`);
    await queryRunner.query(
      `ALTER TABLE "inferencias_ia" DROP COLUMN IF EXISTS "probabilidad_acne"`,
    );
    await queryRunner.query(
      `ALTER TABLE "inferencias_ia" DROP CONSTRAINT IF EXISTS "CHK_inferencias_veredicto"`,
    );
    await queryRunner.query(`ALTER TABLE "inferencias_ia" DROP COLUMN IF EXISTS "veredicto_codigo"`);
  }
}
