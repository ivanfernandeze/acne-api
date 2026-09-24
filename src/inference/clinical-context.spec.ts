import { ANAMNESIS_QUESTIONS, type AnamnesisAnswer } from 'src/common/domain';

import { ageFromBirthDate, buildClinicalContext, formatAnswer } from './clinical-context';

/**
 * El catálogo que se le pasa al constructor del contexto.
 *
 * Aquí se usa la constante semilla porque es estable y conocida; en producción llega la tabla
 * `preguntas_anamnesis`, que es la que manda. Que sea un PARÁMETRO y no un import es justamente lo
 * que arregló el fallo: una pregunta creada desde el portal ya no se cae del camino al modelo.
 */
const CATALOGUE = ANAMNESIS_QUESTIONS.map((question) => ({
  key: question.key,
  number: question.number,
  text: question.text,
}));

/**
 * The anamnesis leaves the database here, towards a backend that may be a third party. These tests
 * exist mostly to pin down what must NEVER travel with it (RF-TR-03) and to keep the rendering
 * faithful to what the clinician answered.
 */
describe('buildClinicalContext', () => {
  const patient = { sex: 'femenino', birthDate: '2001-05-20', phototype: 'IV' };

  it('sends the clinical facts and nothing that identifies the patient', () => {
    const context = buildClinicalContext(
      patient,
      { tiempo_evolucion: { value: 'más de 1 año' } },
      CATALOGUE,
    );

    // The whole payload is inspected, not just the fields we remembered to check: a leak added
    // later has to fail this, and asserting field by field would let it through.
    expect(JSON.stringify(context)).not.toMatch(/nombre|documento|dni|patient_id|birth|2001/i);
    expect(context?.age).toBe(ageFromBirthDate('2001-05-20'));
    expect(context?.sex).toBe('femenino');
    expect(context?.phototype).toBe('IV');
  });

  it('quotes the catalogue wording, not the storage key', () => {
    const context = buildClinicalContext(null, {
      tiempo_evolucion: { value: '1 a 6 meses' },
    }, CATALOGUE);

    expect(context?.answers[0]?.question).toContain('¿');
    expect(context?.answers[0]?.question).not.toBe('tiempo_evolucion');
    expect(context?.answers[0]?.answer).toBe('1 a 6 meses');
  });

  it('follows catalogue order, not the order the JSON happens to have', () => {
    // Object key order is whatever the last write produced; the questionnaire is written to be
    // read top to bottom, and the model reads it the same way.
    const context = buildClinicalContext(null, {
      embarazo_posible: { value: true },
      peso_kg: { value: 62 },
    }, CATALOGUE);

    const questions = (context?.answers ?? []).map((item) => item.question);
    expect(questions[0]).toContain('peso');
  });

  it('omits unanswered questions instead of sending blanks', () => {
    // A list of "sin responder" invites the model to reason about absences that are only an
    // unfinished intake.
    const context = buildClinicalContext(null, {
      peso_kg: { value: 62 },
      enfermedad_cronica: { value: null },
      medicacion_actual: { value: '' },
    }, CATALOGUE);

    expect(context?.answers).toHaveLength(1);
  });

  it('returns null when there is nothing clinically useful to send', () => {
    expect(buildClinicalContext(null, null, CATALOGUE)).toBeNull();
    expect(
      buildClinicalContext({ sex: null, birthDate: null, phototype: null }, {}, CATALOGUE),
    ).toBeNull();
  });

  it('ignores keys that are not in the catalogue', () => {
    const context = buildClinicalContext(null, {
      peso_kg: { value: 62 },
      pregunta_inventada: { value: 'lo que sea' },
    }, CATALOGUE);

    expect(context?.answers).toHaveLength(1);
  });
});

describe('formatAnswer', () => {
  it.each([
    [{ value: true }, 'Sí'],
    [{ value: false }, 'No'],
    [{ value: 62 }, '62'],
    [{ value: ['frente', 'mentón'] }, 'frente, mentón'],
  ])('renders %j as %s', (answer, expected) => {
    expect(formatAnswer(answer as AnamnesisAnswer)).toBe(expected);
  });

  it('keeps the follow-up text, which is where half the answer lives', () => {
    // A bare "Sí" to "¿toma algún medicamento?" is useless: which drug is the clinically relevant
    // half, and it is the half that changes what can be prescribed.
    expect(formatAnswer({ value: true, detail: 'isotretinoína' })).toBe('Sí (isotretinoína)');
  });

  it('survives a follow-up with no value', () => {
    expect(formatAnswer({ value: null, detail: 'solo en verano' })).toBe('solo en verano');
  });
});

describe('ageFromBirthDate', () => {
  it('counts completed years', () => {
    expect(ageFromBirthDate('2000-06-15', new Date('2026-06-14T00:00:00Z'))).toBe(25);
    expect(ageFromBirthDate('2000-06-15', new Date('2026-06-15T00:00:00Z'))).toBe(26);
  });

  it('refuses a date it cannot make sense of rather than sending a wrong age', () => {
    expect(ageFromBirthDate(null)).toBeNull();
    expect(ageFromBirthDate('')).toBeNull();
    expect(ageFromBirthDate('no es una fecha')).toBeNull();
    expect(ageFromBirthDate('2030-01-01', new Date('2026-01-01T00:00:00Z'))).toBeNull();
  });
});
