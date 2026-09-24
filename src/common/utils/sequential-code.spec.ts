import { QueryFailedError } from 'typeorm';
import type { EntityManager } from 'typeorm';

import { nextSequentialCode, withCodeRetry } from './sequential-code';

/**
 * Regression tests for the two defects this helper exists to fix.
 *
 * The first one was live: with synthetic data seeded, `PAC-2026-S021` was the lexicographic maximum,
 * `Number('S021')` gave `NaN`, the sequence restarted at 1 and every patient registered after the
 * first failed with a 500 on the unique constraint.
 */
function managerReturning(
  max: number | null,
  capture?: (sql: string, params: unknown[]) => void,
): EntityManager {
  return {
    query: jest.fn(async (sql: string, params: unknown[]) => {
      capture?.(sql, params);
      return [{ max }];
    }),
  } as unknown as EntityManager;
}

describe('nextSequentialCode', () => {
  it('starts at 0001 on an empty table', async () => {
    const code = await nextSequentialCode(managerReturning(null), 'patients', 'patient_code', 'PAC-2026-');
    expect(code).toBe('PAC-2026-0001');
  });

  it('continues from the numeric maximum', async () => {
    const code = await nextSequentialCode(managerReturning(7), 'patients', 'patient_code', 'PAC-2026-');
    expect(code).toBe('PAC-2026-0008');
  });

  it('matches only all-digit suffixes, so synthetic codes cannot poison the counter', async () => {
    let filter = '';
    await nextSequentialCode(
      managerReturning(3, (_sql, params) => {
        filter = String(params[1]);
      }),
      'patients',
      'patient_code',
      'PAC-2026-',
    );

    expect(new RegExp(filter).test('PAC-2026-0004')).toBe(true);
    expect(new RegExp(filter).test('PAC-2026-S021')).toBe(false);
  });

  it('pads to the requested width', async () => {
    const code = await nextSequentialCode(managerReturning(9), 'cases', 'case_code', 'ACN-2026-', 6);
    expect(code).toBe('ACN-2026-000010');
  });
});

describe('withCodeRetry', () => {
  const uniqueViolation = (): QueryFailedError => {
    const error = new QueryFailedError('insert', [], new Error('duplicate key'));
    (error as unknown as { driverError: { code: string } }).driverError = { code: '23505' };
    return error;
  };

  it('retries once the code collides and succeeds on the next attempt', async () => {
    let calls = 0;
    const result = await withCodeRetry(async () => {
      calls++;
      if (calls === 1) throw uniqueViolation();
      return 'ok';
    });

    expect(result).toBe('ok');
    expect(calls).toBe(2);
  });

  it('propagates anything that is not a duplicate key', async () => {
    // Retrying a real failure is how a clinical record silently goes missing.
    await expect(
      withCodeRetry(async () => {
        throw new Error('la conexión se cayó');
      }),
    ).rejects.toThrow('la conexión se cayó');
  });

  it('gives up after the last attempt and rethrows the collision', async () => {
    await expect(
      withCodeRetry(async () => {
        throw uniqueViolation();
      }, 2),
    ).rejects.toBeInstanceOf(QueryFailedError);
  });
});
