import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * La «Vista general» pide los ojos abiertos y dentro de la foto.
 *
 * Desde el 25/10/2026 es la toma ancla de la comprobación de identidad (`checkSameSubject`): con
 * ella se verifica que los perfiles sean del mismo paciente, y una cara cortada a la altura de los
 * ojos no se puede comparar. La API la rechaza si no muestra el rostro completo, así que la
 * instrucción lo dice antes de que se tome. Mismo texto que `common/domain/capture.ts`.
 */
export class InstruccionVistaGeneral1758700000000 implements MigrationInterface {
  name = 'InstruccionVistaGeneral1758700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "tomas_fotograficas"
         SET "instruccion" = 'Rostro completo de frente, con los ojos abiertos y dentro de la foto, con luz natural y sin maquillaje.'
       WHERE "codigo" = 'general'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "tomas_fotograficas"
         SET "instruccion" = 'Rostro completo de frente, con luz natural y sin maquillaje.'
       WHERE "codigo" = 'general'`);
  }
}
