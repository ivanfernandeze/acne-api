import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * El motor sirve un ensemble: varios modelos por imagen, una recomendación.
 *
 * Desde la revisión del 17/09/2026 de la Sección 8.1, `POST /infer/single` ejecuta a la par los
 * clasificadores comparados en `training/compare.py` (YOLOv8s-cls, EfficientNet-B2, ResNet-50) y
 * devuelve, además de la recomendación combinada —promedio de probabilidades ponderado por el F1 de
 * cada uno en el test congelado—, la lectura de cada miembro con su propio Grad-CAM.
 *
 *  1. **`miembros_inferencia`**: un renglón por modelo y por inferencia, con clase, confianza, vector
 *     de probabilidades, mapa de calor, versión, checksum y peso. La cabecera (`inferencias_ia`)
 *     conserva la recomendación, que es lo que mide OE2; los miembros son evidencia para el médico y
 *     para la auditoría, no una segunda medición.
 *  2. **`inferencias_ia.acuerdo_codigo`**: `unanime` | `mayoria` | `discrepancia`. Nulo cuando sirve un
 *     solo modelo.
 *  3. **`inferencias_ia.version_modelo` pasa de 80 a 200 caracteres**: la versión del ensemble
 *     concatena las de sus miembros (`ensemble[a+b+c]`) y no cabía.
 */
export class EnsambleDeModelos1757900000000 implements MigrationInterface {
  name = 'EnsambleDeModelos1757900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "inferencias_ia" ALTER COLUMN "version_modelo" TYPE varchar(200)`,
    );
    await queryRunner.query(
      `ALTER TABLE "inferencias_ia" ADD COLUMN IF NOT EXISTS "acuerdo_codigo" varchar(16)`,
    );
    await queryRunner.query(
      `ALTER TABLE "inferencias_ia" ADD CONSTRAINT "CHK_inferencias_acuerdo"
         CHECK ("acuerdo_codigo" IS NULL OR "acuerdo_codigo" IN ('unanime','mayoria','discrepancia'))`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "inferencias_ia"."acuerdo_codigo" IS
       'Acuerdo entre los miembros del ensemble (unanime, mayoria, discrepancia). Nulo con un solo modelo.'`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "miembros_inferencia" (
        "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "inferencia_id"     uuid NOT NULL REFERENCES "inferencias_ia"("id") ON DELETE CASCADE,
        "orden"             smallint NOT NULL,
        "etiqueta"          varchar(40) NOT NULL,
        "nombre_modelo"     varchar(40) NOT NULL,
        "version_modelo"    varchar(80) NOT NULL,
        "checksum_pesos"    varchar(64) NOT NULL,
        "peso"              double precision NOT NULL CHECK ("peso" > 0),
        "clase_iga_codigo"  varchar(24) NOT NULL REFERENCES "clases_iga"("codigo") ON DELETE RESTRICT,
        "confianza"         double precision NOT NULL CHECK ("confianza" >= 0 AND "confianza" <= 1),
        "probabilidades"    jsonb NOT NULL,
        "imagen_mapa_calor" uuid REFERENCES "imagenes_caso"("id") ON DELETE SET NULL,
        "latencia_ms"       integer NOT NULL,
        CONSTRAINT "UQ_miembros_inferencia_orden" UNIQUE ("inferencia_id","orden"),
        CONSTRAINT "UQ_miembros_inferencia_etiqueta" UNIQUE ("inferencia_id","etiqueta")
      )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_miembros_inferencia_inferencia" ON "miembros_inferencia" ("inferencia_id")`,
    );
    await queryRunner.query(
      `COMMENT ON TABLE "miembros_inferencia" IS
       'Lectura de cada modelo dentro de una inferencia de ensemble (Seccion 8.1, revision 17/09/2026). La recomendacion combinada vive en inferencias_ia.'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "miembros_inferencia"."peso" IS
       'Peso en la votacion: F1 macro del modelo en el test congelado (training/compare.py).'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "miembros_inferencia"`);
    await queryRunner.query(
      `ALTER TABLE "inferencias_ia" DROP CONSTRAINT IF EXISTS "CHK_inferencias_acuerdo"`,
    );
    await queryRunner.query(`ALTER TABLE "inferencias_ia" DROP COLUMN IF EXISTS "acuerdo_codigo"`);
    await queryRunner.query(
      `ALTER TABLE "inferencias_ia" ALTER COLUMN "version_modelo" TYPE varchar(80)`,
    );
  }
}
