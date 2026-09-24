/**
 * Normalización de texto para buscar sin que la tilde decida.
 *
 * Quien escribe en el buscador teclea «isotretinoina», «Chavez» o «Lucia» —sin acentos, porque es
 * más rápido y porque a menudo no recuerda si la palabra los lleva— y no encontraba nada: la
 * comparación era literal, de modo que ISOTRETINOÍNA e «isotretinoina» eran cadenas distintas. En
 * un sistema lleno de apellidos peruanos con tilde, eso convierte el buscador en una adivinanza.
 *
 * La normalización va en las DOS direcciones: se limpia el término tecleado Y el texto guardado.
 * Limpiar solo uno dejaría el problema simétrico —quien sí escribe la tilde no encontraría lo
 * guardado sin ella—, que es la mitad del arreglo y la más fácil de no notar.
 *
 * Para las búsquedas que corren en SQL existe el equivalente del lado de PostgreSQL, la extensión
 * `unaccent`. Esta función es para lo que NO puede ir en SQL: los nombres de pacientes, que están
 * cifrados en la base y solo se comparan tras descifrarlos en memoria (RF-TR-03).
 */

/**
 * Minúsculas y sin diacríticos.
 *
 * `NFD` descompone cada letra acentuada en su letra base más el signo, y el reemplazo se lleva los
 * signos: «Ó» pasa a «O».
 *
 * La `ñ` TAMBIÉN se reduce a `n`, y no es un descuido. Es lo que hace `unaccent` de PostgreSQL, que
 * resuelve las búsquedas que sí pueden ir en SQL; dejar que las dos rutas trataran la `ñ` de forma
 * distinta significaría que buscar «munoz» encuentra al paciente en una pantalla y no en la otra, y
 * esa incoherencia es peor que cualquiera de las dos reglas por separado.
 *
 * Solo afecta a la COMPARACIÓN. Lo guardado y lo que se muestra conservan su ortografía intacta.
 */
export function normalizeForSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

/**
 * ¿El texto contiene el término, ignorando tildes y mayúsculas?
 *
 * Devuelve `true` con un término vacío: «sin filtro» y «no coincide» son cosas distintas, y quien
 * llama espera que un buscador vacío no esconda nada.
 */
export function matchesSearch(haystack: string | null | undefined, term: string): boolean {
  const needle = normalizeForSearch(term.trim());
  if (needle === '') return true;
  return normalizeForSearch(haystack ?? '').includes(needle);
}
