import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Segunda opinión antes de graduar: qué vio un modelo externo en la fotografía.
 *
 * El filtro local de acné aprendió, además de la piel, la cámara: un acercamiento de vitíligo tomado
 * con celular salió `probabilidad_acne = 0,995`. Desde ahora, para cada imagen que el filtro deja
 * pasar como acné, el motor puede consultar a un modelo multimodal externo (Gemini) si muestra acné,
 * piel sana u otra condición. En esta migración era INFORMATIVA (no detenía la graduación ni cambiaba
 * `veredicto_codigo`; el portal la muestra como advertencia junto al resultado.
 *
 * Vive en la inferencia, que no se invoca en pretest, así que no puede filtrarse a esa condición
 * (RF-TR-01). Las cuatro columnas son nulas cuando no se consultó (desactivada, sin clave o fallida).
 *
 *  - **`segunda_opinion_codigo`**: `acne` | `piel_sana` | `otra_condicion` | `indeterminado`.
 *  - **`segunda_opinion_condiciones`**: las condiciones distintas del acné que nombró, separadas
 *    por «; ». Texto libre del modelo, solo para mostrar: ningún indicador lo agrega.
 *  - **`segunda_opinion_explicacion`**: una frase para el dermatólogo.
 *  - **`segunda_opinion_version`**: modelo y revisión de la pregunta, para poder releerla (RNF-03).
 */
export class SegundaOpinion1758400000000 implements MigrationInterface {
  name = 'SegundaOpinion1758400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "inferencias_ia" ADD COLUMN IF NOT EXISTS "segunda_opinion_codigo" varchar(16)
         CONSTRAINT "CHK_inferencias_segunda_opinion"
         CHECK ("segunda_opinion_codigo" IS NULL OR "segunda_opinion_codigo" IN
                ('acne','piel_sana','otra_condicion','indeterminado'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "inferencias_ia" ADD COLUMN IF NOT EXISTS "segunda_opinion_condiciones" varchar(300)`,
    );
    await queryRunner.query(
      `ALTER TABLE "inferencias_ia" ADD COLUMN IF NOT EXISTS "segunda_opinion_explicacion" varchar(400)`,
    );
    await queryRunner.query(
      `ALTER TABLE "inferencias_ia" ADD COLUMN IF NOT EXISTS "segunda_opinion_version" varchar(120)`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "inferencias_ia"."segunda_opinion_codigo" IS
       'Segunda opinion antes de graduar (modelo externo), INFORMATIVA: no cambia veredicto_codigo. acne | piel_sana | otra_condicion | indeterminado. Nulo si no se consulto.'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const column of [
      'segunda_opinion_version',
      'segunda_opinion_explicacion',
      'segunda_opinion_condiciones',
      'segunda_opinion_codigo',
    ]) {
      await queryRunner.query(`ALTER TABLE "inferencias_ia" DROP COLUMN IF EXISTS "${column}"`);
    }
  }
}
