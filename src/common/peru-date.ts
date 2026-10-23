/**
 * Fecha civil de Perú (UTC-5, sin horario de verano) de un instante, como `YYYY-MM-DD`.
 *
 * `toISOString().slice(0, 10)` da la fecha en UTC, y desde las 19:00 de Lima ya es el día siguiente:
 * un caso revisado a las 19:30 aparecía fechado un día después en las fichas de los anexos.
 */
export function peruDate(value: Date | string): string {
  return new Date(new Date(value).getTime() - 5 * 3_600_000).toISOString().slice(0, 10);
}
