import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cada fotografía guarda la orientación de la cabeza que midió el cribado de admisión.
 *
 * Hasta ahora nada comprobaba que la foto correspondiera a su toma: el mismo perfil izquierdo subido
 * en las tres casillas cumplía el protocolo. El motor ahora informa la pose (frontal o girada, y
 * hacia qué lado de la imagen apunta la nariz) a partir de los puntos faciales de YuNet, y
 * `checkShotView` (`common/domain/shot-view.ts`) rechaza una vista general girada, un perfil de
 * frente, la misma foto en dos tomas y dos perfiles girados al mismo lado.
 *
 * Se guarda para comparar un perfil con el otro sin descifrar ni volver a cribar la foto anterior.
 * Es geometría, no un dato clínico: se mide igual en pretest y postest (RF-TR-01).
 */
export class OrientacionDeTomas1758100000000 implements MigrationInterface {
  name = 'OrientacionDeTomas1758100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "imagenes_caso" ADD COLUMN IF NOT EXISTS "orientacion_detectada" varchar(24)`,
    );
    await queryRunner.query(
      `ALTER TABLE "imagenes_caso" ADD CONSTRAINT "CHK_imagenes_orientacion"
         CHECK ("orientacion_detectada" IS NULL OR "orientacion_detectada" IN
                ('frontal','nariz_derecha','nariz_izquierda','indeterminado'))`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "imagenes_caso"."orientacion_detectada" IS
       'Orientacion de la cabeza segun el cribado (frontal, nariz_derecha, nariz_izquierda, indeterminado). nariz_* es el lado de la IMAGEN. Nulo si no se midio.'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "imagenes_caso" DROP CONSTRAINT IF EXISTS "CHK_imagenes_orientacion"`,
    );
    await queryRunner.query(
      `ALTER TABLE "imagenes_caso" DROP COLUMN IF EXISTS "orientacion_detectada"`,
    );
  }
}
