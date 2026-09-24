import { QueryFailedError } from 'typeorm';
import type { EntityManager } from 'typeorm';

/**
 * Year-scoped sequential codes: `PAC-2026-0001`, `ACN-2026-0001` (RF-TR-03).
 *
 * Two defects made this worth extracting rather than leaving inline in each service.
 *
 * **The lexicographic maximum is not the numeric maximum.** The original implementation ordered by
 * the code string and parsed the winner. Once the seeder introduced synthetic codes with a letter
 * prefix (`PAC-2026-S021`), those sorted above every real one, `Number('S021')` produced `NaN`, the
 * fallback restarted the sequence at 1, and the insert collided with the patient already holding
 * `PAC-2026-0001`. The symptom was a 500 on every patient registered after the first, on any
 * database that had been seeded — which is every demonstration database. The pattern below matches
 * digits only, so synthetic codes are ignored instead of poisoning the counter.
 *
 * **Read-then-insert is not atomic.** Two intakes running at once read the same maximum and one of
 * them violates the unique constraint. That was tolerable when a single physician created cases; it
 * is not once a technician registers patients while the clinicians work. The retry below turns the
 * collision into a second attempt rather than an error in front of a waiting patient.
 */
const UNIQUE_VIOLATION = '23505';

/**
 * @param table  identifier, interpolated into the query — pass a literal, never user input.
 * @param column identifier, same caveat.
 */
export async function nextSequentialCode(
  manager: EntityManager,
  table: string,
  column: string,
  prefix: string,
  width = 4,
): Promise<string> {
  const escaped = escapeRegex(prefix);
  const rows = await manager.query<Array<{ max: number | null }>>(
    `SELECT MAX(CAST(SUBSTRING("${column}" FROM $1) AS integer)) AS "max"
       FROM "${table}"
      WHERE "${column}" ~ $2`,
    [`^${escaped}([0-9]+)$`, `^${escaped}[0-9]+$`],
  );

  const next = (rows[0]?.max ?? 0) + 1;
  return `${prefix}${String(next).padStart(width, '0')}`;
}

/**
 * Runs `attempt` again when the database rejects the generated code as a duplicate.
 *
 * Only a unique violation is retried; anything else propagates, because swallowing a real failure
 * behind a retry loop is how a clinical record silently goes missing.
 */
export async function withCodeRetry<T>(attempt: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await attempt();
    } catch (error: unknown) {
      if (!isUniqueViolation(error)) throw error;
      lastError = error;
    }
  }
  throw lastError;
}

function isUniqueViolation(error: unknown): boolean {
  if (!(error instanceof QueryFailedError)) return false;
  return (error.driverError as { code?: string } | undefined)?.code === UNIQUE_VIOLATION;
}

/** The prefix is built from constants, but a regex metacharacter in it would silently break it. */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
