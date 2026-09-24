import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * No route may delete a row.
 *
 * Every table of the study is referenced by the evidence built on top of it: `diagnoses` and
 * `review_timings` point at the professional who produced them and compose TPD and TRM; `cases`,
 * `case_images` and `ai_inferences` point at the patient and compose a whole longitudinal series.
 * Deleting one row therefore does not remove a record — it silently invalidates a measurement.
 *
 * Worse, `indicator_snapshots` and `hypothesis_runs` are immutable by RNF-05. A delete would leave
 * a published indicator that can no longer be reproduced from the data it was computed on, and
 * nothing anywhere would say so.
 *
 * The two tombstones this system has are `users.active = false` and `patients.withdrawn_at`. Both
 * keep the row.
 *
 * This is a tripwire, not a rule in a document: rules in documents get forgotten during review,
 * and a `@Delete` is the most natural thing in the world to add to a maintainer screen.
 */
const SRC = join(__dirname, '..', '..');

const DELETE_DECORATOR = /^\s*@Delete\(/;

interface Offender {
  file: string;
  line: number;
  route: string;
}

describe('no hard delete', () => {
  it('declares no @Delete route anywhere in the API', () => {
    const report = findDeleteRoutes()
      .map((hit) => `${hit.file}:${hit.line} ${hit.route}`)
      .join('\n');

    // If this fails, the fix is almost never to allow the delete: it is a tombstone column plus a
    // POST that sets it, the way `POST /patients/:id/withdraw` already works.
    expect(report).toBe('');
  });
});

function findDeleteRoutes(): Offender[] {
  const found: Offender[] = [];

  for (const file of controllerFiles(SRC)) {
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, index) => {
        if (!DELETE_DECORATOR.test(line)) return;
        found.push({
          file: file.slice(SRC.length + 1).replace(/\\/g, '/'),
          line: index + 1,
          route: line.trim(),
        });
      });
  }

  return found;
}

function controllerFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...controllerFiles(full));
    } else if (entry.endsWith('.controller.ts')) {
      files.push(full);
    }
  }
  return files;
}
