import {
  aggregateViews,
  caseVerdictOf,
  describeRule,
  viewsForSuggestion,
  type AnalysisView,
} from './case-analysis';

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

describe('caseVerdictOf', () => {
  it('is null until a view has finished', () => {
    expect(caseVerdictOf([])).toBeNull();
  });

  it('is no_acne only when no view is gradable (another condition everywhere)', () => {
    expect(caseVerdictOf(['no_acne', 'no_acne', 'no_acne'])).toBe('no_acne');
  });

  it('is piel_sana when every gradable view is healthy skin', () => {
    expect(caseVerdictOf(['piel_sana', 'piel_sana', 'no_acne'])).toBe('piel_sana');
  });

  it('is acne as soon as one view was graded by the ensemble', () => {
    // A clear cheek next to an affected one is clinically real: the acne view wins.
    expect(caseVerdictOf(['piel_sana', 'acne', 'no_acne'])).toBe('acne');
  });
});

describe('viewsForSuggestion', () => {
  const v = (
    id: string,
    verdict: 'acne' | 'piel_sana' | 'no_acne' | null,
  ): { id: string; verdict: 'acne' | 'piel_sana' | 'no_acne' | null } => ({ id, verdict });

  it('sets healthy views aside when any view shows acne, so the gate never outvotes the grade', () => {
    // The real case: the frontal view came back healthy at «100 %» and the profiles graded
    // casi_sin_lesiones and severo. The suggestion must come from the profiles.
    const { pool, healthySetAside } = viewsForSuggestion([
      v('general', 'piel_sana'),
      v('derecho', 'acne'),
      v('izquierdo', 'acne'),
    ]);
    expect(pool.map((x) => x.id)).toEqual(['derecho', 'izquierdo']);
    expect(healthySetAside.map((x) => x.id)).toEqual(['general']);
  });

  it('lets the healthy views carry the suggestion only when no view shows acne', () => {
    const { pool, healthySetAside } = viewsForSuggestion([
      v('general', 'piel_sana'),
      v('derecho', 'piel_sana'),
      v('izquierdo', 'no_acne'),
    ]);
    expect(pool.map((x) => x.id)).toEqual(['general', 'derecho']);
    expect(healthySetAside).toEqual([]);
  });

  it('never includes another-condition views, and treats a legacy null verdict as graded', () => {
    const { pool } = viewsForSuggestion([v('a', null), v('b', 'no_acne'), v('c', 'piel_sana')]);
    expect(pool.map((x) => x.id)).toEqual(['a']);
  });
});
