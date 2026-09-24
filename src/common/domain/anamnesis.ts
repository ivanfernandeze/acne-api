/**
 * Acne anamnesis — the clinical intake questionnaire.
 *
 * Trimmed from the advisor's modular teleconsultation questionnaire (Paso 1, Paso 2, Módulo A and
 * Módulo B), keeping ONLY the questions that change how acne is graded or treated. The other twelve
 * modules of that instrument (scalp, hair loss, nails, tinea, psoriasis…) are out of scope: section
 * 3 of the thesis specification confines the prototype to acne vulgaris.
 *
 * SCOPE NOTE: unlike the Likert of Anexo 6, this questionnaire is NOT backed by any functional
 * requirement of `requisitos.md` — it is an extension requested by the research team and declared as
 * such in `acne-infra/TRACEABILITY.md`. It feeds the specialist's reference diagnosis (RF-OE2-01).
 *
 * IT IS ALSO AN INPUT TO THE MODEL, since 03/09/2026. A backend that reasons over text receives
 * these answers alongside the photograph (`inference/clinical-context.ts`) and uses them to
 * contextualise its reading and to raise the flags that change management — a possible pregnancy
 * against isotretinoin, an allergy, a drug already in use. Two boundaries hold:
 *
 *  - **The severity is still graded from the image.** The prompt says so explicitly, because a
 *    patient who reports "acné severo" must not be able to talk the model into a severe grade:
 *    OE2 compares that grade against `cases.ground_truth_iga`.
 *  - **No identity travels with it** (RF-TR-03). Age, sex and phototype are clinical facts; the
 *    name, the document and the birth date are not sent, and a regression test pins that down.
 *
 * This reverses the earlier "image-only" design and is declared in TRACEABILITY.md.
 *
 * The wording below is the one the clinic uses with patients. The frontend renders these strings by
 * reading `GET /meta/catalogs`, so there is exactly one copy of the questionnaire in the system.
 */

export const ANAMNESIS_SECTIONS = ['contexto', 'lesion', 'acne', 'hormonal'] as const;
export type AnamnesisSection = (typeof ANAMNESIS_SECTIONS)[number];

export const ANAMNESIS_SECTION_LABELS: Readonly<Record<AnamnesisSection, string>> = {
  contexto: 'Datos básicos y antecedentes',
  lesion: 'Historia de la lesión',
  acne: 'Específico de acné',
  hormonal: 'Evaluación hormonal',
};

/**
 * Tipo de dato de una respuesta. En español desde la reestructuración del 05/09/2026: el catálogo
 * viaja tal cual a la tabla `tipos_pregunta`, y una base de datos en español con `single_choice`
 * dentro no es una base de datos en español.
 */
export const ANAMNESIS_ANSWER_TYPES = [
  'booleano',
  'texto',
  'numero',
  'opcion_unica',
  'opcion_multiple',
] as const;
export type AnamnesisAnswerType = (typeof ANAMNESIS_ANSWER_TYPES)[number];

export const ANAMNESIS_ANSWER_TYPE_LABELS: Readonly<Record<AnamnesisAnswerType, string>> = {
  booleano: 'Sí / No',
  texto: 'Texto libre',
  numero: 'Número',
  opcion_unica: 'Opción única',
  opcion_multiple: 'Opción múltiple',
};

/** Los tipos cuyas respuestas se guardan como filas en `respuestas_anamnesis_opcion`. */
export const CHOICE_ANSWER_TYPES: readonly AnamnesisAnswerType[] = [
  'opcion_unica',
  'opcion_multiple',
];

/**
 * Who the question applies to. `mujer_adulta` mirrors the advisor's Módulo B: the hormonal block is
 * only meaningful for women of reproductive age, and asking it of a 14-year-old boy would be noise
 * in the record and an awkward moment in the consulting room.
 */
export const ANAMNESIS_SCOPES = ['siempre', 'mujer_adulta'] as const;
export type AnamnesisScope = (typeof ANAMNESIS_SCOPES)[number];

/** Age from which the hormonal block applies, matching Módulo B ("adulto mujer ≥ 18"). */
export const ANAMNESIS_ADULT_AGE = 18;

export interface AnamnesisQuestion {
  /** Stable storage key. NEVER rename one: it is what the answers are filed under. */
  key: string;
  /** Presentation order, 1..21. */
  number: number;
  section: AnamnesisSection;
  /** Verbatim wording shown to the patient. */
  text: string;
  type: AnamnesisAnswerType;
  /** Valores permitidos para `opcion_unica` / `opcion_multiple`. */
  options?: readonly string[];
  unit?: string;
  scope: AnamnesisScope;
  required: boolean;
  /** Prompt for the free-text follow-up ("¿cuál?", "¿por cuánto tiempo?"). */
  detail?: string;
  /** Shown under the control as clinical guidance for whoever takes the history. */
  hint?: string;
}

/**
 * Version stamped on every stored answer set.
 *
 * The catalogue IS the schema of the `answers` JSON, so an analysis six months from now can only be
 * reproduced if the record says which catalogue it was answered against (RNF-03, RNF-05). Bump it
 * whenever a key, a type or an option list changes.
 */
export const ANAMNESIS_VERSION = '2.0';

/** Longest free-text a `detail` may carry. Keeps the record clinical and the CSV export readable. */
export const ANAMNESIS_DETAIL_MAX_LENGTH = 500;

export const ANAMNESIS_QUESTIONS: readonly AnamnesisQuestion[] = [
  // --- Contexto: lo que condiciona la prescripción -----------------------------
  {
    key: 'peso_kg',
    number: 1,
    section: 'contexto',
    text: '¿Cuál es su peso aproximado?',
    type: 'numero',
    unit: 'kg',
    scope: 'siempre',
    required: false,
    hint: 'La isotretinoína se dosifica por kilo de peso (mg/kg).',
  },
  {
    key: 'enfermedad_cronica',
    number: 2,
    section: 'contexto',
    text: '¿Tiene alguna enfermedad crónica? (diabetes, hipertensión, tiroides, etc.)',
    type: 'booleano',
    scope: 'siempre',
    required: false,
    detail: '¿Cuál?',
  },
  {
    key: 'medicacion_actual',
    number: 3,
    section: 'contexto',
    text: '¿Toma algún medicamento actualmente?',
    type: 'booleano',
    scope: 'siempre',
    required: false,
    detail: 'Nombre del medicamento',
  },
  {
    key: 'alergia_medicamentos',
    number: 4,
    section: 'contexto',
    text: '¿Tiene alergia a algún medicamento?',
    type: 'booleano',
    scope: 'siempre',
    required: false,
    detail: '¿A cuál?',
  },

  // --- Historia de la lesión ---------------------------------------------------
  {
    key: 'tiempo_evolucion',
    number: 5,
    section: 'lesion',
    text: '¿Hace cuánto tiempo aparecieron las lesiones?',
    type: 'opcion_unica',
    options: ['menos de 1 mes', '1 a 6 meses', '6 a 12 meses', 'más de 1 año'],
    scope: 'siempre',
    required: false,
  },
  {
    key: 'episodio_previo',
    number: 6,
    section: 'lesion',
    text: '¿Es la primera vez que aparecen o ya las tuvo antes?',
    type: 'opcion_unica',
    options: ['primera vez', 'ya las tuvo antes'],
    scope: 'siempre',
    required: false,
    detail: 'Si ya las tuvo: ¿desaparecieron solas o usó algún tratamiento?',
  },
  {
    key: 'evaluacion_previa',
    number: 7,
    section: 'lesion',
    text: '¿Algún médico lo evaluó antes por esto?',
    type: 'opcion_unica',
    options: ['no', 'médico general', 'dermatólogo'],
    scope: 'siempre',
    required: false,
  },
  {
    key: 'tratamientos_previos',
    number: 8,
    section: 'lesion',
    text: '¿Ya usó alguna crema o medicamento para esto?',
    type: 'booleano',
    scope: 'siempre',
    required: false,
    detail: '¿Cuál? ¿Por cuánto tiempo? ¿Cuándo fue la última vez?',
  },
  {
    key: 'sintomas',
    number: 9,
    section: 'lesion',
    text: '¿Qué molestias le dan las lesiones?',
    type: 'opcion_multiple',
    options: ['pican', 'arden', 'duelen', 'ninguna'],
    scope: 'siempre',
    required: false,
  },

  // --- Específico de acné ------------------------------------------------------
  {
    key: 'zona_extrafacial',
    number: 10,
    section: 'acne',
    text: '¿El acné también está en el pecho o la espalda?',
    type: 'opcion_multiple',
    options: ['pecho', 'espalda', 'ninguna'],
    scope: 'siempre',
    required: false,
    hint: 'El compromiso del tronco pesa en la severidad y orienta al tratamiento sistémico.',
  },
  {
    key: 'productos_acne',
    number: 11,
    section: 'acne',
    text: '¿Qué productos usa para el acné?',
    type: 'texto',
    scope: 'siempre',
    required: false,
    hint: 'Indique el nombre exacto del producto.',
  },
  {
    key: 'fotoproteccion',
    number: 12,
    section: 'acne',
    text: '¿Usa protector solar o crema hidratante?',
    type: 'booleano',
    scope: 'siempre',
    required: false,
    detail: '¿Cuál?',
  },
  {
    key: 'suplementos',
    number: 13,
    section: 'acne',
    text: '¿Toma suplementos vitamínicos, proteínas en polvo, creatina o anabólicos?',
    type: 'booleano',
    scope: 'siempre',
    required: false,
    detail: '¿Cuáles?',
    hint: 'Son desencadenantes frecuentes y a menudo el paciente no los relaciona.',
  },
  {
    key: 'antecedente_familiar',
    number: 14,
    section: 'acne',
    text: '¿Alguno de sus padres tuvo acné severo?',
    type: 'opcion_unica',
    options: ['sí', 'no', 'no sabe'],
    scope: 'siempre',
    required: false,
  },
  {
    key: 'maquillaje',
    number: 15,
    section: 'acne',
    text: '¿Usa maquillaje con frecuencia? ¿Lo retira completamente antes de dormir?',
    type: 'opcion_unica',
    options: ['no usa', 'usa y lo retira', 'usa y no siempre lo retira'],
    scope: 'siempre',
    required: false,
  },

  // --- Hormonal: solo mujeres desde los 18 años --------------------------------
  {
    key: 'menstruacion_regular',
    number: 16,
    section: 'hormonal',
    text: '¿Le viene la menstruación todos los meses y en fechas regulares?',
    type: 'opcion_unica',
    options: ['sí', 'no', 'no aplica'],
    scope: 'mujer_adulta',
    required: false,
  },
  {
    key: 'empeora_premenstrual',
    number: 17,
    section: 'hormonal',
    text: '¿El acné empeora días o semanas antes de la menstruación?',
    type: 'booleano',
    scope: 'mujer_adulta',
    required: false,
  },
  {
    key: 'embarazo_menopausia',
    number: 18,
    section: 'hormonal',
    text: '¿Está embarazada, tuvo un embarazo reciente o está en menopausia?',
    type: 'opcion_unica',
    options: ['ninguno', 'embarazo actual', 'embarazo reciente', 'menopausia'],
    scope: 'mujer_adulta',
    required: false,
    hint: 'Determinante para descartar retinoides orales.',
  },
  {
    key: 'anticonceptivo',
    number: 19,
    section: 'hormonal',
    text: '¿Usa algún método anticonceptivo?',
    type: 'booleano',
    scope: 'mujer_adulta',
    required: false,
    detail: '¿Cuál?',
  },
  {
    key: 'caida_cabello',
    number: 20,
    section: 'hormonal',
    text: '¿Nota caída de cabello?',
    type: 'booleano',
    scope: 'mujer_adulta',
    required: false,
  },
  {
    key: 'vello_inusual',
    number: 21,
    section: 'hormonal',
    text: '¿Nota vello en zonas inusuales — mentón, abdomen o pecho?',
    type: 'booleano',
    scope: 'mujer_adulta',
    required: false,
    hint: 'Junto con la caída de cabello, orienta a hiperandrogenismo.',
  },
] as const;

export const ANAMNESIS_KEYS: readonly string[] = ANAMNESIS_QUESTIONS.map((q) => q.key);

const QUESTIONS_BY_KEY = new Map(ANAMNESIS_QUESTIONS.map((q) => [q.key, q]));

export function anamnesisQuestion(key: string): AnamnesisQuestion | undefined {
  return QUESTIONS_BY_KEY.get(key);
}

/**
 * The questions that apply to one patient.
 *
 * This is the ONLY place the hormonal-branch rule lives; the intake form and the server-side
 * validator both call it, so the form can never offer a question the API would reject, nor hide one
 * it silently expects.
 */
export function anamnesisQuestionsFor(
  sex: string | null | undefined,
  ageYears: number | null | undefined,
): AnamnesisQuestion[] {
  const hormonal = sex === 'femenino' && ageYears !== null && ageYears !== undefined
    ? ageYears >= ANAMNESIS_ADULT_AGE
    : false;
  return ANAMNESIS_QUESTIONS.filter((q) => q.scope === 'siempre' || hormonal).map((q) => ({ ...q }));
}

/** One stored answer. `value` is typed by the question; `detail` is the free-text follow-up. */
export interface AnamnesisAnswer {
  value: boolean | string | number | string[] | null;
  detail?: string | null;
}

/** Keys surfaced in the longitudinal history, where the whole questionnaire would be noise. */
export const ANAMNESIS_HIGHLIGHT_KEYS: readonly string[] = [
  'tiempo_evolucion',
  'zona_extrafacial',
  'tratamientos_previos',
  'embarazo_menopausia',
];

/**
 * Clinical flag that must stay visible on the case file: oral retinoids are teratogenic, so a
 * current pregnancy changes what may be prescribed. It is a LABEL for the physician, never an
 * automated decision — the prototype does not prescribe (RNF-06).
 */
export function hasPregnancyFlag(answers: Readonly<Record<string, AnamnesisAnswer>>): boolean {
  return answers['embarazo_menopausia']?.value === 'embarazo actual';
}

/** What in the questionnaire says the patient currently has lesions, one line per answer. */
export interface ActiveAcneReport {
  active: boolean;
  evidence: string[];
}

function chosenOptions(answer: AnamnesisAnswer | undefined): string[] {
  if (answer === undefined || answer.value === null) return [];
  if (Array.isArray(answer.value)) return answer.value.map(String);
  return typeof answer.value === 'string' ? [answer.value] : [];
}

/**
 * Whether the questionnaire, read as a whole, says the patient has acne NOW.
 *
 * The instrument has no direct "do you currently have lesions?" item, so this is a HEURISTIC over
 * the answers that only make sense for someone with active lesions: how long they have been there,
 * what they feel like, whether they also reach the trunk, whether they flare before menstruation.
 * It exists to warn the physician when the model sees clean skin on a face the history describes
 * as diseased — a label to look twice, never an automated decision (RNF-06).
 */
export function reportsActiveAcne(
  answers: Readonly<Record<string, AnamnesisAnswer>>,
): ActiveAcneReport {
  const evidence: string[] = [];

  const [duration] = chosenOptions(answers['tiempo_evolucion']);
  if (duration !== undefined) evidence.push(`refiere lesiones desde hace ${duration}`);

  const symptoms = chosenOptions(answers['sintomas']).filter((option) => option !== 'ninguna');
  if (symptoms.length > 0) evidence.push(`refiere molestias (${symptoms.join(', ')})`);

  const trunk = chosenOptions(answers['zona_extrafacial']).filter((option) => option !== 'ninguna');
  if (trunk.length > 0) evidence.push(`refiere lesiones en ${trunk.join(' y ')}`);

  if (answers['empeora_premenstrual']?.value === true) {
    evidence.push('refiere empeoramiento premenstrual');
  }

  return { active: evidence.length > 0, evidence };
}

/**
 * Validates one answer against its question. Returns `null` when valid, or the reason in Spanish so
 * the API can hand the caller something actionable rather than a generic 400.
 */
export function validateAnamnesisAnswer(
  question: AnamnesisQuestion,
  answer: AnamnesisAnswer,
): string | null {
  const { value } = answer;

  if (answer.detail !== undefined && answer.detail !== null) {
    if (typeof answer.detail !== 'string') {
      return `El detalle de "${question.key}" debe ser texto.`;
    }
    if (answer.detail.length > ANAMNESIS_DETAIL_MAX_LENGTH) {
      return `El detalle de "${question.key}" supera ${ANAMNESIS_DETAIL_MAX_LENGTH} caracteres.`;
    }
  }

  // A blank answer is legitimate: the questionnaire is never a gate, the patient may not know, and
  // an unanswered question is clinically different from a "no".
  if (value === null) return null;

  switch (question.type) {
    case 'booleano':
      return typeof value === 'boolean' ? null : `"${question.key}" espera sí o no.`;
    case 'texto':
      if (typeof value !== 'string') return `"${question.key}" espera texto.`;
      return value.length <= ANAMNESIS_DETAIL_MAX_LENGTH
        ? null
        : `"${question.key}" supera ${ANAMNESIS_DETAIL_MAX_LENGTH} caracteres.`;
    case 'numero':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return `"${question.key}" espera un número.`;
      }
      return value >= 0 && value <= 500 ? null : `"${question.key}" está fuera de rango.`;
    case 'opcion_unica':
      if (typeof value !== 'string') return `"${question.key}" espera una opción.`;
      return question.options?.includes(value) === true
        ? null
        : `"${value}" no es una opción válida de "${question.key}".`;
    case 'opcion_multiple': {
      if (!Array.isArray(value)) return `"${question.key}" espera una lista de opciones.`;
      const invalid = value.find(
        (item) => typeof item !== 'string' || question.options?.includes(item) !== true,
      );
      return invalid === undefined
        ? null
        : `"${String(invalid)}" no es una opción válida de "${question.key}".`;
    }
  }
}
