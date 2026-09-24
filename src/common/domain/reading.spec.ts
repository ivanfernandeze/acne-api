import type { AnamnesisAnswer } from './anamnesis';
import { IGA_CLASSES } from './iga';
import { buildCaseReading, type ReadingView } from './reading';

const view = (shotKey: string, igaClass: ReadingView['igaClass'], members: ReadingView['members'] = []): ReadingView => ({
  shotKey,
  igaClass,
  confidence: 0.5,
  members,
});

describe('buildCaseReading', () => {
  it('says there is no reading without a graded view', () => {
    const reading = buildCaseReading({
      igaClass: null,
      confidence: null,
      agreement: null,
      views: [],
      answers: {},
      ageYears: null,
      sex: null,
    });
    expect(reading.summary).toMatch(/no hay lectura/);
    expect(reading.considerations).toEqual([]);
  });

  it('describes the grade, the views, the dissent and the asymmetry', () => {
    const reading = buildCaseReading({
      igaClass: 'moderado',
      confidence: 0.29,
      agreement: 'discrepancia',
      views: [
        view('general', 'leve', [{ tag: 'efficientnet_b2', igaClass: 'severo', confidence: 0.4 }]),
        view('perfil_derecho', 'severo'),
        view('perfil_izquierdo', 'casi_sin_lesiones'),
      ],
      answers: {},
      ageYears: 24,
      sex: 'femenino',
      rule: 'toma_mas_confiable',
      ruleDescription: 'Las tomas discrepan; se toma la lectura más segura: el perfil derecho → severo.',
      range: { min: 'casi_sin_lesiones', max: 'severo' },
    });
    expect(reading.severityRationale).toMatch(/^Las tomas discrepan; se toma la lectura más segura/);
    expect(reading.summary).toMatch(/Moderado — numerosas lesiones/);
    expect(reading.summary).toMatch(/confianza baja \(29 %\)/);
    expect(reading.summary).toMatch(/el perfil derecho como severo/);
    expect(reading.summary).toMatch(/discrepan/);
    expect(reading.severityRationale).toMatch(/alternativas contiguas eran leve y severo/);
    expect(reading.severityRationale).toMatch(/van de casi sin lesiones a severo/);
    expect(reading.severityRationale).toMatch(/efficientnet_b2 leyó la vista general como severo/);
    expect(reading.severityRationale).toMatch(/Asimetría marcada: el perfil derecho/);
    expect(reading.affectedZones).toHaveLength(2); // general (leve) + perfil derecho (severo)
    expect(reading.affectedZones.some((z) => z.includes('izquierda'))).toBe(false);
    expect(reading.considerations.some((c) => c.includes('tomas discrepan'))).toBe(true);
    // Never a prescription: no doses.
    expect(reading.considerations.join(' ')).not.toMatch(/\d+ ?mg/);
    // Woman of childbearing age with moderate acne → the pregnancy flag.
    expect(reading.anamnesisFlags.some((f) => f.includes('descartar embarazo'))).toBe(true);
  });

  it('turns the questionnaire into flags and differentials without inventing findings', () => {
    const answers: Record<string, AnamnesisAnswer> = {
      embarazo_menopausia: { value: 'embarazo actual' },
      medicacion_actual: { value: true, detail: 'litio' },
      alergia_medicamentos: { value: true, detail: 'penicilina' },
      zona_extrafacial: { value: ['espalda'] },
      tiempo_evolucion: { value: 'más de 1 año' },
      episodio_previo: { value: 'primera vez' },
      fotoproteccion: { value: false },
    };
    const reading = buildCaseReading({
      igaClass: 'severo',
      confidence: 0.8,
      agreement: 'unanime',
      views: [view('general', 'severo'), view('perfil_derecho', 'severo'), view('perfil_izquierdo', 'severo')],
      answers,
      ageYears: 34,
      sex: 'femenino',
    });
    expect(reading.summary).toMatch(/confianza alta/);
    expect(reading.anamnesisFlags).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Embarazo actual'),
        expect.stringContaining('Medicación en curso: revisar interacciones y fármacos acneigénicos: litio'),
        expect.stringContaining('penicilina'),
        expect.stringContaining('No usa fotoprotección'),
      ]),
    );
    expect(reading.differentials.some((d) => d.includes('inicio tardío'))).toBe(true);
    expect(reading.differentials.some((d) => d.includes('fármacos'))).toBe(true);
    expect(reading.considerations.some((c) => c.includes('espalda'))).toBe(true);
    expect(reading.lesionTypes).toEqual([]);
  });

  it('has a description and considerations for every IGA class', () => {
    for (const iga of IGA_CLASSES) {
      const reading = buildCaseReading({
        igaClass: iga,
        confidence: 0.6,
        agreement: 'unanime',
        views: [view('general', iga)],
        answers: {},
        ageYears: 20,
        sex: 'masculino',
      });
      expect(reading.summary).toContain('IGA');
      expect(reading.considerations.length).toBeGreaterThan(0);
    }
  });
});
