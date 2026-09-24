import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The reading the clinician chose for the case — table `lecturas_elegidas`.
 *
 * The case suggestion is derived by a rule (majority of views; otherwise the surest view). The
 * rule is a default, not a verdict: with three photographs and three models the person who looks
 * at the face may know that the right profile is the one that shows the outbreak, or that one
 * model's Grad-CAM landed on a mole. From 18/09/2026 the technician or the dermatologist can
 * point at one cell of the analysis matrix — one view, and optionally one model within it — and
 * that reading becomes the case suggestion that feeds the anamnesis check and the diagnosis form.
 *
 * It is a history, not a slot: every choice is a new row, and going back to the automatic rule
 * or choosing again *withdraws* the previous row (`retirada_en`) instead of deleting it — nothing
 * in this schema is hard-deleted (see `no-hard-delete.spec.ts`). The active choice of a case is
 * its latest row without `retirada_en`. The chosen inference is referenced with CASCADE so an
 * inference that disappears cannot leave a dangling choice; a choice whose inference is no longer
 * the latest for its image is ignored by the analysis (the readings it pointed at are stale) and
 * reported as such. Every change is also audited (`analysis.select` / `analysis.unselect`).
 */
export class LecturaElegida1758000000000 implements MigrationInterface {
  name = 'LecturaElegida1758000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lecturas_elegidas" (
        "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "caso_id"          uuid NOT NULL REFERENCES "casos"("id") ON DELETE CASCADE,
        "inferencia_id"    uuid NOT NULL REFERENCES "inferencias_ia"("id") ON DELETE CASCADE,
        "miembro_etiqueta" varchar(40),
        "motivo"           text,
        "usuario_id"       uuid REFERENCES "usuarios"("id") ON DELETE SET NULL,
        "elegida_en"       timestamptz NOT NULL DEFAULT now(),
        "retirada_en"      timestamptz,
        "retirada_por_id"  uuid REFERENCES "usuarios"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_lecturas_elegidas_caso" ON "lecturas_elegidas" ("caso_id", "elegida_en" DESC)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_lecturas_elegidas_activa"
         ON "lecturas_elegidas" ("caso_id") WHERE "retirada_en" IS NULL`,
    );
    await queryRunner.query(
      `COMMENT ON TABLE "lecturas_elegidas" IS
       'Historial de lecturas elegidas por el técnico o el dermatólogo como sugerencia del caso: una toma (inferencia) y, opcionalmente, un modelo de esa toma. La activa es la última sin retirada_en; sustituye a la regla automática mientras la inferencia siga siendo la vigente de su imagen.'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "lecturas_elegidas"."miembro_etiqueta" IS
       'Etiqueta del miembro del ensemble elegido (miembros_inferencia.etiqueta). Nulo = la lectura del ensemble de esa toma.'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "lecturas_elegidas"`);
  }
}
