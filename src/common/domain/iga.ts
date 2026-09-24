/**
 * Escala de severidad IGA (Investigator's Global Assessment) para acné vulgar, más la escala
 * secundaria GAGS (Global Acne Grading System).
 *
 * Cubre: OE2 (RF-OE2-01, RF-OE2-04) — el espacio de etiquetas en el que se expresan todos los
 * diagnósticos y todas las predicciones del modelo. Referencias: Traini (2025), Vasam (2023),
 * Watanabe (2025).
 *
 * Espejo de `acne-ai-engine/app/domain/iga.py`. Cualquier cambio va en los dos sitios y se anota en
 * el CHANGELOG de cada repositorio.
 */

/** Las cinco clases IGA que exige la sección 3 de requisitos.md. */
export const IGA_CLASSES = [
  'sin_lesiones',
  'casi_sin_lesiones',
  'leve',
  'moderado',
  'severo',
] as const;

export type IgaClass = (typeof IGA_CLASSES)[number];

/**
 * Rango ordinal de cada clase IGA (0 = sin lesiones .. 4 = severo). IGA es una escala ordinal, de
 * modo que la distancia entre clases tiene significado al analizar los errores del modelo.
 */
export const IGA_ORDINAL: Readonly<Record<IgaClass, number>> = {
  sin_lesiones: 0,
  casi_sin_lesiones: 1,
  leve: 2,
  moderado: 3,
  severo: 4,
};

/** Etiquetas en español (Perú) que se muestran en la UI clínica y en los reportes PDF. */
export const IGA_LABELS: Readonly<Record<IgaClass, string>> = {
  sin_lesiones: 'Sin lesiones',
  casi_sin_lesiones: 'Casi sin lesiones',
  leve: 'Leve',
  moderado: 'Moderado',
  severo: 'Severo',
};

export function isIgaClass(value: unknown): value is IgaClass {
  return typeof value === 'string' && (IGA_CLASSES as readonly string[]).includes(value);
}

/** Distancia ordinal entre dos clases IGA; 0 significa acuerdo exacto. */
export function igaDistance(a: IgaClass, b: IgaClass): number {
  return Math.abs(IGA_ORDINAL[a] - IGA_ORDINAL[b]);
}

/**
 * Graduación GAGS secundaria, expuesta junto a IGA según la sección 3 de requisitos.md.
 *
 * Los códigos pasaron de inglés (`none`, `mild`…) a español en la reestructuración del 05/09/2026:
 * IGA ya estaba en español y tener las dos escalas clínicas en idiomas distintos dentro de la misma
 * fila era la clase de incoherencia que se nota primero en la defensa.
 */
export const GAGS_GRADES = ['sin_acne', 'leve', 'moderado', 'severo', 'muy_severo'] as const;
export type GagsGrade = (typeof GAGS_GRADES)[number];

export const GAGS_LABELS: Readonly<Record<GagsGrade, string>> = {
  sin_acne: 'Sin acné',
  leve: 'Leve',
  moderado: 'Moderado',
  severo: 'Severo',
  muy_severo: 'Muy severo',
};

export const GAGS_ORDINAL: Readonly<Record<GagsGrade, number>> = {
  sin_acne: 0,
  leve: 1,
  moderado: 2,
  severo: 3,
  muy_severo: 4,
};

/** Rango de puntaje GAGS, según el instrumento estándar. */
export const GAGS_MIN_SCORE = 0;
export const GAGS_MAX_SCORE = 44;

/**
 * Cortes de puntaje de cada banda GAGS, tal como los reporta la literatura (Vasam, 2023).
 * La tabla `grados_gags` guarda estos mismos límites, de modo que la banda puede verificarse en
 * SQL sin reimplementar la función.
 */
export const GAGS_BANDS: readonly { grade: GagsGrade; min: number; max: number }[] = [
  { grade: 'sin_acne', min: 0, max: 0 },
  { grade: 'leve', min: 1, max: 18 },
  { grade: 'moderado', min: 19, max: 30 },
  { grade: 'severo', min: 31, max: 38 },
  { grade: 'muy_severo', min: 39, max: 44 },
];

/** Mapea un puntaje GAGS numérico (0-44) a su banda. */
export function gagsGradeFromScore(score: number): GagsGrade {
  const band = GAGS_BANDS.find((b) => score >= b.min && score <= b.max);
  return band?.grade ?? (score <= 0 ? 'sin_acne' : 'muy_severo');
}

export function isGagsGrade(value: unknown): value is GagsGrade {
  return typeof value === 'string' && (GAGS_GRADES as readonly string[]).includes(value);
}

/** Fototipo Fitzpatrick, registrado para la auditoría de equidad de la sección 8.2. */
export const FITZPATRICK_TYPES = ['I', 'II', 'III', 'IV', 'V', 'VI'] as const;
export type FitzpatrickType = (typeof FITZPATRICK_TYPES)[number];

export const FITZPATRICK_LABELS: Readonly<Record<FitzpatrickType, string>> = {
  I: 'I — Piel muy clara, siempre se quema, nunca broncea',
  II: 'II — Piel clara, se quema con facilidad, broncea poco',
  III: 'III — Piel clara a mate, se quema moderadamente, broncea gradualmente',
  IV: 'IV — Piel mate, se quema poco, broncea con facilidad',
  V: 'V — Piel morena, rara vez se quema, broncea intensamente',
  VI: 'VI — Piel oscura, nunca se quema, siempre pigmentada',
};

export const SEXES = ['femenino', 'masculino', 'otro'] as const;
export type Sex = (typeof SEXES)[number];

export const SEX_LABELS: Readonly<Record<Sex, string>> = {
  femenino: 'Femenino',
  masculino: 'Masculino',
  otro: 'Otro',
};
