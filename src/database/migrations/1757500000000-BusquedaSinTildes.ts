import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Buscar sin que la tilde decida.
 *
 * `ILIKE` compara literalmente, de modo que teclear «isotretinoina» no encontraba
 * ISOTRETINOÍNA y buscar «Chavez» no daba con Chávez. En un sistema lleno de apellidos peruanos
 * con tilde eso convierte el buscador en una adivinanza, y el usuario acaba creyendo que el dato
 * no existe.
 *
 * `unaccent` es una extensión de contrib que ya viene en la imagen oficial de PostgreSQL. Se aplica
 * a los DOS lados de la comparación —al término tecleado y a la columna— porque limpiar solo uno
 * deja el problema simétrico: quien sí escribe la tilde no encontraría lo guardado sin ella.
 *
 * No se crean índices funcionales. `unaccent()` no es `IMMUTABLE` sin envolverla, el censo es de
 * treinta casos y un recorrido secuencial sobre tablas de este tamaño es más rápido que el índice
 * que habría que mantener. Si el censo creciera, aquí es donde hay que volver.
 */
export class BusquedaSinTildes1757500000000 implements MigrationInterface {
  name = 'BusquedaSinTildes1757500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "unaccent"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // La extensión se deja instalada: quitarla rompería cualquier consulta que la use y no libera
    // nada que importe. Revertir esta migración solo tiene sentido junto al código que la consume.
    await queryRunner.query(`SELECT 1`);
  }
}
