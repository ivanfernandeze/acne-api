import {
  ANAMNESIS_KEYS,
  ANAMNESIS_QUESTIONS,
  ANAMNESIS_DETAIL_MAX_LENGTH,
  anamnesisQuestion,
  anamnesisQuestionsFor,
  hasPregnancyFlag,
  reportsActiveAcne,
  validateAnamnesisAnswer,
  type AnamnesisAnswer,
} from './anamnesis';

/**
 * The catalogue is the schema of every stored answer, so its shape is load-bearing: a duplicated
 * key would silently merge two questions in the record, and a choice question without options would
 * accept anything.
 */
describe('anamnesis catalogue', () => {
  it('has 21 questions with unique, stable keys', () => {
    expect(ANAMNESIS_QUESTIONS).toHaveLength(21);
    expect(new Set(ANAMNESIS_KEYS).size).toBe(21);
  });

  it('numbers the questions 1..21 without gaps', () => {
    const numbers = ANAMNESIS_QUESTIONS.map((q) => q.number).sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: 21 }, (_, i) => i + 1));
  });

  it('gives every choice question a non-empty option list', () => {
    for (const question of ANAMNESIS_QUESTIONS) {
      if (question.type === 'opcion_unica' || question.type === 'opcion_multiple') {
        expect(question.options?.length ?? 0).toBeGreaterThan(0);
      }
    }
  });
});

describe('anamnesisQuestionsFor', () => {
  it('adds the hormonal block only for women aged 18 or more', () => {
    expect(anamnesisQuestionsFor('femenino', 25)).toHaveLength(21);
    expect(anamnesisQuestionsFor('femenino', 17)).toHaveLength(15);
    expect(anamnesisQuestionsFor('masculino', 40)).toHaveLength(15);
  });

  it('omits the hormonal block when sex or age is unknown', () => {
    // Guessing would either ask a 14-year-old boy about his menstrual cycle or drop questions the
    // clinician needs; withholding is the only safe default.
    expect(anamnesisQuestionsFor(null, 30)).toHaveLength(15);
    expect(anamnesisQuestionsFor('femenino', null)).toHaveLength(15);
  });
});

describe('validateAnamnesisAnswer', () => {
  const answer = (value: AnamnesisAnswer['value'], detail?: string): AnamnesisAnswer => ({
    value,
    detail,
  });

  it('accepts a blank answer', () => {
    // Unanswered is clinically different from "no": the patient may simply not know.
    const question = anamnesisQuestion('enfermedad_cronica');
    expect(validateAnamnesisAnswer(question!, answer(null))).toBeNull();
  });

  it('rejects a value of the wrong type', () => {
    const question = anamnesisQuestion('enfermedad_cronica');
    expect(validateAnamnesisAnswer(question!, answer('sí'))).toContain('sí o no');
  });

  it('rejects an option outside the catalogue', () => {
    const question = anamnesisQuestion('tiempo_evolucion');
    expect(validateAnamnesisAnswer(question!, answer('hace años'))).toContain('no es una opción');
    expect(validateAnamnesisAnswer(question!, answer('1 a 6 meses'))).toBeNull();
  });

  it('validates every element of a multiple choice', () => {
    const question = anamnesisQuestion('sintomas');
    expect(validateAnamnesisAnswer(question!, answer(['pican', 'sangran']))).toContain('sangran');
    expect(validateAnamnesisAnswer(question!, answer(['pican', 'arden']))).toBeNull();
  });

  it('caps the free-text detail', () => {
    const question = anamnesisQuestion('medicacion_actual');
    const tooLong = 'x'.repeat(ANAMNESIS_DETAIL_MAX_LENGTH + 1);
    expect(validateAnamnesisAnswer(question!, answer(true, tooLong))).toContain('supera');
  });

  it('keeps a weight within a plausible range', () => {
    const question = anamnesisQuestion('peso_kg');
    expect(validateAnamnesisAnswer(question!, answer(62))).toBeNull();
    expect(validateAnamnesisAnswer(question!, answer(-1))).toContain('fuera de rango');
  });
});

describe('hasPregnancyFlag', () => {
  it('flags only a current pregnancy', () => {
    expect(hasPregnancyFlag({ embarazo_menopausia: { value: 'embarazo actual' } })).toBe(true);
    expect(hasPregnancyFlag({ embarazo_menopausia: { value: 'embarazo reciente' } })).toBe(false);
    expect(hasPregnancyFlag({})).toBe(false);
  });
});

describe('reportsActiveAcne', () => {
  it('says nothing about an empty questionnaire', () => {
    expect(reportsActiveAcne({})).toEqual({ active: false, evidence: [] });
  });

  it('treats "ninguna" as the absence of a claim', () => {
    const answers: Record<string, AnamnesisAnswer> = {
      sintomas: { value: ['ninguna'] },
      zona_extrafacial: { value: ['ninguna'] },
      empeora_premenstrual: { value: false },
    };
    expect(reportsActiveAcne(answers).active).toBe(false);
  });

  it('collects one line of evidence per answer that implies current lesions', () => {
    const answers: Record<string, AnamnesisAnswer> = {
      tiempo_evolucion: { value: '1 a 6 meses' },
      sintomas: { value: ['pican', 'ninguna'] },
      zona_extrafacial: { value: ['pecho', 'espalda'] },
      empeora_premenstrual: { value: true },
    };
    const report = reportsActiveAcne(answers);
    expect(report.active).toBe(true);
    expect(report.evidence).toEqual([
      'refiere lesiones desde hace 1 a 6 meses',
      'refiere molestias (pican)',
      'refiere lesiones en pecho y espalda',
      'refiere empeoramiento premenstrual',
    ]);
  });

  it('ignores answers that do not speak about current lesions', () => {
    const answers: Record<string, AnamnesisAnswer> = {
      antecedente_familiar: { value: 'sí' },
      tratamientos_previos: { value: true, detail: 'peróxido de benzoilo' },
      evaluacion_previa: { value: 'dermatólogo' },
    };
    expect(reportsActiveAcne(answers).active).toBe(false);
  });
});
