import { describeEvidence, removalMode, type CaseEvidence } from './case-removal';

describe('case removal', () => {
  const none: CaseEvidence = { diagnoses: 0, reviewTimings: 0, inferences: 0, prescriptions: 0 };

  it('erases a case that produced nothing for the study', () => {
    expect(removalMode(none)).toBe('eliminar');
    expect(describeEvidence(none)).toEqual([]);
  });

  it.each([
    ['diagnoses', 'diagnóstico'],
    ['reviewTimings', 'revisión medida'],
    ['inferences', 'análisis de IA'],
    ['prescriptions', 'receta'],
  ] as const)('annuls a case with %s, and says so', (key, word) => {
    const evidence = { ...none, [key]: 1 };
    expect(removalMode(evidence)).toBe('anular');
    expect(describeEvidence(evidence)).toEqual([`1 ${word}`]);
  });

  it('counts in the plural', () => {
    expect(describeEvidence({ ...none, diagnoses: 2, reviewTimings: 3 })).toEqual([
      '2 diagnósticos',
      '3 revisiones medidas',
    ]);
  });
});
