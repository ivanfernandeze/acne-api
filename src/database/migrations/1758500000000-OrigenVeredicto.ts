import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Quién decidió que una toma no era acné: el filtro local o la segunda opinión.
 *
 * Hasta ahora `veredicto_codigo = 'no_acne'` solo podía venir del filtro local. Desde hoy también
 * lo pone la segunda opinión previa (Gemini) cuando ve otra condición —vitíligo, melasma…— en una
 * toma que el filtro había dejado pasar como acné: esa toma no se gradúa, igual que con el filtro,
 * porque un grado IGA para un vitíligo no tiene sentido clínico y quedaría en la historia.
 *
 * `veredicto_origen` lo distingue: `filtro` (todas las filas anteriores) o `segunda_opinion`. Sin
 * él, una fila con `probabilidad_acne = 0,995` y `veredicto_codigo = 'no_acne'` parecería un error.
 */

/** Comentarios de columna (sin tildes, como el resto de la base): fijos, sin datos del usuario. */
const COLUMN_COMMENTS: ReadonlyArray<readonly [string, string]> = [
  [
    'segunda_opinion_codigo',
    'Segunda opinion antes de graduar (modelo externo): acne | piel_sana | otra_condicion | indeterminado. Con otra_condicion la toma no se gradua (veredicto_origen = segunda_opinion); en los demas casos es una advertencia. Nulo si no se consulto.',
  ],
  [
    'segunda_opinion_condiciones',
    'Condiciones distintas del acne que nombro la segunda opinion, unidas por punto y coma. Texto del modelo, solo para mostrar: ningun indicador lo agrega.',
  ],
  ['segunda_opinion_explicacion', 'Una frase de la segunda opinion para el dermatologo.'],
  [
    'segunda_opinion_version',
    'Modelo y revision de la pregunta de la segunda opinion (p. ej. gemini/<modelo>/c1). No reproducible (RNF-03).',
  ],
  ['version_filtro', 'Version del filtro local de acne que decidio el veredicto. Nulo si no habia filtro.'],
];

export class OrigenVeredicto1758500000000 implements MigrationInterface {
  name = 'OrigenVeredicto1758500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "inferencias_ia" ADD COLUMN IF NOT EXISTS "veredicto_origen" varchar(16)
         NOT NULL DEFAULT 'filtro'
         CONSTRAINT "CHK_inferencias_veredicto_origen"
         CHECK ("veredicto_origen" IN ('filtro','segunda_opinion'))`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "inferencias_ia"."veredicto_origen" IS
       'Quien decidio veredicto_codigo: filtro (el filtro local de acne, o ninguno si no habia) o segunda_opinion (la verificacion previa vio otra condicion y la toma no se graduo).'`,
    );
    // Desde esta migración la segunda opinión deja de ser solo informativa: corrige el comentario
    // que dejó `SegundaOpinion` y documenta las columnas que no lo tenían.
    for (const [column, comment] of COLUMN_COMMENTS) {
      await queryRunner.query(`COMMENT ON COLUMN "inferencias_ia"."${column}" IS '${comment}'`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "inferencias_ia" DROP COLUMN IF EXISTS "veredicto_origen"`,
    );
  }
}
