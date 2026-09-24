import { aggregateViews, describeRule, type AnalysisView } from './case-analysis';

const view = (
  imageId: string,
  igaClass: AnalysisView['igaClass'],
  confidence: number,
  shotKey = imageId,
): AnalysisView => ({
  imageId,
  shotKey,
  igaClass,
  confidence,
  classProbs: { [igaClass]: confidence, leve: 1 - confidence },
});

describe('aggregateViews', () => {
  it('has nothing to say without views', () => {
    expect(aggregateViews([]).igaClass).toBeNull();
  });

  it('takes the majority class with the mean confidence of the agreeing views', () => {
    const verdict = aggregateViews([
      view('general', 'moderado', 0.6),
      view('perfil_derecho', 'moderado', 0.4),
      view('perfil_izquierdo', 'leve', 0.9),
    ]);
    expect(verdict.igaClass).toBe('moderado');
    expect(verdict.confidence).toBeCloseTo(0.5);
    expect(verdict.rule).toBe('mayoria');
    expect(verdict.agreement).toBe('mayoria');
    expect(verdict.decidedBy).toEqual(['general', 'perfil_derecho']);
    expect(verdict.range).toEqual({ min: 'leve', max: 'moderado' });
    // The dissenting view's high confidence does not sway the verdict.
    expect(verdict.classProbs?.moderado).toBeCloseTo(0.5);
  });

  it('falls back to the most confident view when every view differs', () => {
    // The case that motivated the rule: leve / severo / casi_sin_lesiones used to average to
    // moderado, a class no photograph showed.
    const verdict = aggregateViews([
      view('general', 'leve', 0.388),
      view('perfil_derecho', 'severo', 0.471),
      view('perfil_izquierdo', 'casi_sin_lesiones', 0.401),
    ]);
    expect(verdict.igaClass).toBe('severo');
    expect(verdict.confidence).toBeCloseTo(0.471);
    expect(verdict.rule).toBe('toma_mas_confiable');
    expect(verdict.agreement).toBe('discrepancia');
    expect(verdict.decidedBy).toEqual(['perfil_derecho']);
    expect(verdict.range).toEqual({ min: 'casi_sin_lesiones', max: 'severo' });
  });

  it('reports unanimity', () => {
    const verdict = aggregateViews([view('a', 'leve', 0.7), view('b', 'leve', 0.8), view('c', 'leve', 0.6)]);
    expect(verdict.agreement).toBe('unanime');
    expect(verdict.decidedBy).toHaveLength(3);
    expect(verdict.confidence).toBeCloseTo(0.7);
  });
});

describe('describeRule', () => {
  const label = (key: string | null): string => (key === null ? 'sin toma' : key.replace('_', ' '));
  const shotOf = (id: string): string => id;

  it('explains a majority and a fallback in plain words', () => {
    const majority = aggregateViews([view('general', 'leve', 0.5), view('perfil_derecho', 'leve', 0.5), view('perfil_izquierdo', 'severo', 0.9)]);
    expect(describeRule(majority, label, shotOf)).toBe(
      '2 de las tomas coinciden en leve (general, perfil derecho).',
    );
    const fallback = aggregateViews([view('general', 'leve', 0.3), view('perfil_derecho', 'severo', 0.5), view('perfil_izquierdo', 'moderado', 0.4)]);
    expect(describeRule(fallback, label, shotOf)).toMatch(/más seguros: perfil derecho → severo/);
  });
});
