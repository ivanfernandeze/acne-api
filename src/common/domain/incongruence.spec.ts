import type { AnamnesisAnswer } from './anamnesis';
import { IGA_CLASSES } from './iga';
import { anamnesisImageMismatch } from './incongruence';

const activeAcne: Record<string, AnamnesisAnswer> = {
  tiempo_evolucion: { value: '6 a 12 meses' },
  sintomas: { value: ['duelen'] },
};

describe('anamnesisImageMismatch', () => {
  it('is silent without a grade', () => {
    expect(anamnesisImageMismatch(null, activeAcne)).toEqual([]);
  });

  it('is silent when the questionnaire does not claim active lesions', () => {
    expect(anamnesisImageMismatch('sin_lesiones', {})).toEqual([]);
    expect(
      anamnesisImageMismatch('casi_sin_lesiones', { sintomas: { value: ['ninguna'] } }),
    ).toEqual([]);
  });

  it.each(['leve', 'moderado', 'severo'] as const)(
    'is silent when the model sees lesions (%s)',
    (iga) => {
      expect(anamnesisImageMismatch(iga, activeAcne)).toEqual([]);
    },
  );

  it.each(['sin_lesiones', 'casi_sin_lesiones'] as const)(
    'warns when the model sees clean skin (%s) on a history of active lesions',
    (iga) => {
      const messages = anamnesisImageMismatch(iga, activeAcne);
      expect(messages).toHaveLength(2);
      expect(messages[0]).toContain('refiere lesiones desde hace 6 a 12 meses');
      expect(messages[0]).toContain('refiere molestias (duelen)');
      expect(messages[1]).toMatch(/episodio anterior/);
    },
  );

  it('covers every IGA class on one side or the other', () => {
    for (const iga of IGA_CLASSES) {
      const fires = anamnesisImageMismatch(iga, activeAcne).length > 0;
      expect(fires).toBe(iga === 'sin_lesiones' || iga === 'casi_sin_lesiones');
    }
  });
});
