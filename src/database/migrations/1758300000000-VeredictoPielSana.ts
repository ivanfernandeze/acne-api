import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * El filtro del motor pasa a tres clases: acné, piel sana y otra condición.
 *
 * ACNE04 no tiene ni un rostro sin lesiones, así que los modelos IGA nunca sugerían
 * `sin_lesiones`. El filtro, entrenado además con rostros sanos de la Chicago Face Database y otras
 * dermatosis de Fitzpatrick17k, ahora reconoce la piel sana (las pecas incluidas) y la responde como
 * `sin_lesiones`, sin ejecutar el ensemble. La inferencia se guarda como una lectura normal —clase
 * `sin_lesiones`, su probabilidad y su GAGS— con `veredicto_codigo = 'piel_sana'` para que se sepa
 * que la dio el filtro y no los modelos IGA. `no_acne` conserva su significado: otra condición.
 */
export class VeredictoPielSana1758300000000 implements MigrationInterface {
  name = 'VeredictoPielSana1758300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "inferencias_ia" DROP CONSTRAINT IF EXISTS "CHK_inferencias_veredicto"`,
    );
    await queryRunner.query(
      `ALTER TABLE "inferencias_ia" ADD CONSTRAINT "CHK_inferencias_veredicto"
         CHECK ("veredicto_codigo" IN ('acne','piel_sana','no_acne'))`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "inferencias_ia"."veredicto_codigo" IS
       'acne: graduada por el ensemble IGA. piel_sana: el filtro vio piel sana y la lectura es sin_lesiones con la probabilidad del filtro (el ensemble no corrio). no_acne: otra condicion; no se graduo (clase, GAGS y mapa de calor nulos).'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Las lecturas de piel sana vuelven a ser lecturas sin veredicto especial: conservan su clase.
    await queryRunner.query(
      `UPDATE "inferencias_ia" SET "veredicto_codigo" = 'acne' WHERE "veredicto_codigo" = 'piel_sana'`,
    );
    await queryRunner.query(
      `ALTER TABLE "inferencias_ia" DROP CONSTRAINT IF EXISTS "CHK_inferencias_veredicto"`,
    );
    await queryRunner.query(
      `ALTER TABLE "inferencias_ia" ADD CONSTRAINT "CHK_inferencias_veredicto"
         CHECK ("veredicto_codigo" IN ('acne','no_acne'))`,
    );
  }
}
