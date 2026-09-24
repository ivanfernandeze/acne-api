import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { AUDIT_ACTION_LABELS, AUDIT_ENTITY_LABELS } from './audit';

/**
 * Every action and entity the trail records has a readable name.
 *
 * The audit panel used to print the raw codes — `case.list.identity`, `hypothesis_run` — which is
 * legible to whoever wrote the call site and opaque to the auditor, who is the person the screen
 * exists for. The labels fixed that, and they can only stay fixed if adding an endpoint that
 * records a NEW action fails here instead of quietly showing a code again months later.
 *
 * A tripwire and not a rule in a document: the label catalogue is nowhere near the `auditService
 * .record(...)` call an author is writing, so nothing else would remind them.
 */
const SRC = join(__dirname, '..', '..');

const ACTION = /action: '([a-z._]+)'/g;
const ENTITY_TYPE = /entityType: '([a-z_]+)'/g;

function collect(pattern: RegExp): Set<string> {
  const found = new Set<string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.endsWith('.ts') || entry.endsWith('.spec.ts')) continue;
      const source = readFileSync(full, 'utf8');
      for (const match of source.matchAll(new RegExp(pattern.source, 'g'))) {
        const value = match[1];
        if (value !== undefined) found.add(value);
      }
    }
  };
  walk(SRC);
  return found;
}

describe('catálogo de auditoría', () => {
  it('nombra todas las acciones que el código registra', () => {
    const used = [...collect(ACTION)].sort();
    // `action:` también aparece en objetos que no son de auditoría; solo importan las que el
    // catálogo desconoce, y ese conjunto debe estar vacío.
    const sinNombre = used.filter((action) => AUDIT_ACTION_LABELS[action] === undefined);

    expect(sinNombre).toEqual([]);
    expect(used.length).toBeGreaterThan(20);
  });

  it('nombra todos los tipos de entidad que el código registra', () => {
    const used = [...collect(ENTITY_TYPE)].sort();
    const sinNombre = used.filter((entity) => AUDIT_ENTITY_LABELS[entity] === undefined);

    expect(sinNombre).toEqual([]);
    expect(used.length).toBeGreaterThan(8);
  });

  it('no declara nombres para acciones que ya nadie registra', () => {
    // El catálogo describe lo que el sistema hace HOY. Una etiqueta huérfana significa que el
    // endpoint se retiró y nadie limpió, y a la vuelta de un año nadie sabe cuál de las dos cosas
    // es la desactualizada.
    const used = collect(ACTION);
    const huerfanas = Object.keys(AUDIT_ACTION_LABELS).filter((action) => !used.has(action));

    expect(huerfanas).toEqual([]);
  });
});
