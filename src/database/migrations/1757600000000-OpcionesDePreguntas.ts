import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Las opciones de las preguntas de elección bajan a la tabla.
 *
 * `preguntas_anamnesis` se sembró antes de que existiera la columna `opciones`, de modo que las
 * listas cerradas —«1 a 6 meses», «pican / arden / duelen»— vivían únicamente en
 * `common/domain/anamnesis.ts`. Mientras el catálogo servía el texto desde esa constante daba
 * igual; en cuanto la tabla pasó a ser la fuente de verdad, las nueve preguntas de elección
 * quedaron sin nada que ofrecer: el ingreso las habría pintado como controles vacíos y el
 * validador habría rechazado cualquier respuesta.
 *
 * Los valores son EXACTAMENTE los de la constante. No es una oportunidad para mejorar la redacción:
 * son las opciones bajo las que ya se archivaron respuestas, y cambiar una sola dejaría esas
 * anamnesis apuntando a un valor que la lista ya no contiene.
 */
export class OpcionesDePreguntas1757600000000 implements MigrationInterface {
  name = 'OpcionesDePreguntas1757600000000';

  private readonly opciones: Array<[string, string[]]> = [
    ['tiempo_evolucion', ['menos de 1 mes', '1 a 6 meses', '6 a 12 meses', 'más de 1 año']],
    ['episodio_previo', ['primera vez', 'ya las tuvo antes']],
    ['evaluacion_previa', ['no', 'médico general', 'dermatólogo']],
    ['sintomas', ['pican', 'arden', 'duelen', 'ninguna']],
    ['zona_extrafacial', ['pecho', 'espalda', 'ninguna']],
    ['antecedente_familiar', ['sí', 'no', 'no sabe']],
    ['maquillaje', ['no usa', 'usa y lo retira', 'usa y no siempre lo retira']],
    ['menstruacion_regular', ['sí', 'no', 'no aplica']],
    ['embarazo_menopausia', ['ninguno', 'embarazo actual', 'embarazo reciente', 'menopausia']],
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [clave, valores] of this.opciones) {
      await queryRunner.query(
        `UPDATE "preguntas_anamnesis" SET "opciones" = $1::jsonb WHERE "clave" = $2`,
        [JSON.stringify(valores), clave],
      );
    }

    // Una pregunta de elección sin opciones es un control vacío en pantalla. Que la base lo impida
    // evita que una edición futura la deje así sin que nadie lo note hasta el siguiente ingreso.
    await queryRunner.query(`
      ALTER TABLE "preguntas_anamnesis"
        ADD CONSTRAINT "CHK_preguntas_opciones"
        CHECK (
          "tipo_codigo" NOT IN ('opcion_unica','opcion_multiple')
          OR ("opciones" IS NOT NULL AND jsonb_array_length("opciones") >= 2)
        )`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preguntas_anamnesis" DROP CONSTRAINT IF EXISTS "CHK_preguntas_opciones"`,
    );
    await queryRunner.query(
      `UPDATE "preguntas_anamnesis" SET "opciones" = NULL WHERE "tipo_codigo" IN ('opcion_unica','opcion_multiple')`,
    );
  }
}
