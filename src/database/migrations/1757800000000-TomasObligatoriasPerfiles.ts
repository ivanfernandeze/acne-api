import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Las tomas obligatorias pasan a ser el rostro de frente y los dos perfiles.
 *
 * Hasta ahora el catálogo marcaba como obligatorias `general`, `acercamiento` y `borde` — el
 * protocolo genérico de cualquier lesión cutánea — y **nada lo hacía cumplir**: un caso con una sola
 * fotografía se analizaba y se diagnosticaba igual. Para acné facial lo que la graduación IGA
 * necesita es la cara completa: de frente y ambas mejillas, porque una puede tener las lesiones que
 * la otra no tiene. A partir de esta migración `InferenceService.request`, `DiagnosesService.submit`
 * y `CasesService.resubmit` rechazan con 400 el caso al que le falte alguna de las tres.
 *
 * La matriz de `common/domain/capture.ts` cambia en el mismo commit. `CatalogConsistencyService`
 * solo compara los códigos, así que aquí se actualiza el marcador `obligatoria` sin más.
 */
export class TomasObligatoriasPerfiles1757800000000 implements MigrationInterface {
  name = 'TomasObligatoriasPerfiles1757800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "tomas_fotograficas"
         SET "obligatoria" = ("codigo" IN ('general','perfil_derecho','perfil_izquierdo'))`);
    await queryRunner.query(`
      UPDATE "tomas_fotograficas"
         SET "instruccion" = 'Rostro completo de frente, con luz natural y sin maquillaje.'
       WHERE "codigo" = 'general'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "tomas_fotograficas"
         SET "obligatoria" = ("codigo" IN ('general','acercamiento','borde'))`);
    await queryRunner.query(`
      UPDATE "tomas_fotograficas"
         SET "instruccion" = 'Encuadre toda la zona afectada, de frente y con luz natural.'
       WHERE "codigo" = 'general'`);
  }
}
