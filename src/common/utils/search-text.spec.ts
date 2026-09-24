import { matchesSearch, normalizeForSearch } from './search-text';

/**
 * Buscar no puede depender de que el usuario acierte con la tilde.
 *
 * Los apellidos peruanos van llenos de acentos y los nombres comerciales de los fármacos se
 * escriben en mayúsculas con tilde —ISOTRETINOÍNA, ÁCIDO FÓLICO—, mientras que quien busca teclea
 * rápido y sin acentos. Antes de este arreglo el buscador respondía «sin resultados» y el usuario
 * concluía que el dato no estaba.
 */
describe('normalizeForSearch', () => {
  it('quita tildes y baja a minúsculas', () => {
    expect(normalizeForSearch('ISOTRETINOÍNA 20MG')).toBe('isotretinoina 20mg');
    expect(normalizeForSearch('Chávez')).toBe('chavez');
    expect(normalizeForSearch('ÁCIDO FÓLICO')).toBe('acido folico');
  });

  it('reduce la ñ a n, igual que unaccent de PostgreSQL', () => {
    // No es una preferencia: es lo que hace la extensión que resuelve las búsquedas en SQL, y dos
    // reglas distintas harían que «munoz» encuentre al paciente en una pantalla y no en la otra.
    expect(normalizeForSearch('Muñoz')).toBe('munoz');
  });

  it('deja intacto lo que no lleva diacríticos', () => {
    expect(normalizeForSearch('ACICLOVIR 200MG')).toBe('aciclovir 200mg');
  });
});

describe('matchesSearch', () => {
  it('encuentra escribiendo sin tilde lo que está guardado con ella', () => {
    expect(matchesSearch('ISOTRETINOÍNA 20MG', 'isotretinoina')).toBe(true);
    expect(matchesSearch('Lucía Vargas Rojas', 'lucia')).toBe(true);
    expect(matchesSearch('Luis Flores Chávez', 'chavez')).toBe(true);
  });

  it('y también al revés, escribiendo la tilde sobre lo guardado sin ella', () => {
    // La mitad del arreglo que es fácil olvidar: normalizar solo el término tecleado dejaría el
    // problema simétrico en pie.
    expect(matchesSearch('Isotretinoina generica', 'isotretinoína')).toBe(true);
  });

  it('un término vacío no esconde nada', () => {
    expect(matchesSearch('cualquier cosa', '')).toBe(true);
    expect(matchesSearch('cualquier cosa', '   ')).toBe(true);
  });

  it('sigue sin encontrar lo que de verdad no coincide', () => {
    expect(matchesSearch('ISOTRETINOÍNA 20MG', 'clindamicina')).toBe(false);
  });

  it('tolera un texto ausente', () => {
    expect(matchesSearch(null, 'algo')).toBe(false);
    expect(matchesSearch(undefined, 'algo')).toBe(false);
  });
});
