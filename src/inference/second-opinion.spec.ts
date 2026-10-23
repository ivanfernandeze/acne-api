import { fromSecondOpinionColumns, toSecondOpinionColumns } from './second-opinion';

describe('second opinion columns', () => {
  it('round-trips what the engine said', () => {
    const opinion = {
      label: 'otra_condicion' as const,
      conditions: ['vitíligo', 'melasma'],
      explanation: 'Máculas acrómicas de bordes netos, sin pápulas.',
      version: 'gemini/gemini-2.5-flash/c1',
    };
    expect(fromSecondOpinionColumns(toSecondOpinionColumns(opinion))).toEqual(opinion);
  });

  it('stores nothing when it was not consulted, and reads nothing back', () => {
    const columns = toSecondOpinionColumns(null);
    expect(Object.values(columns).every((value) => value === null)).toBe(true);
    expect(fromSecondOpinionColumns(columns)).toBeNull();
  });

  it('keeps a name with a semicolon in one piece', () => {
    const columns = toSecondOpinionColumns({
      label: 'acne',
      conditions: ['dermatitis; seborreica', ''],
      explanation: '',
      version: 'v',
    });
    expect(fromSecondOpinionColumns(columns)?.conditions).toEqual(['dermatitis, seborreica']);
  });
});
