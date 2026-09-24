import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every HTTP handler must state its authorisation explicitly.
 *
 * The guards are global, so a handler with neither `@Roles` nor `@Public` is reachable by ANY
 * authenticated user. That was survivable while the roles were fixed; adding `tecnico` silently
 * widened every such route at once, which is exactly the kind of change that passes review because
 * nothing about it looks like a permission edit.
 *
 * This test is the tripwire: a new endpoint fails the build until someone decides who may call it.
 */
const SRC = join(__dirname, '..', '..');

const HTTP_DECORATOR = /^\s*@(Get|Post|Put|Patch|Delete|Head|Options|All)\(/;
const AUTHORISATION = /^\s*@(Roles|Public)\(/;

interface Handler {
  file: string;
  line: number;
  route: string;
}

describe('route authorisation', () => {
  const unguarded = collectUnguardedHandlers();

  it('declares @Roles or @Public on every HTTP handler', () => {
    const report = unguarded
      .map((handler) => `${handler.file}:${handler.line} ${handler.route}`)
      .join('\n');

    expect(report).toBe('');
  });
});

function collectUnguardedHandlers(): Handler[] {
  const found: Handler[] = [];

  for (const file of controllerFiles(SRC)) {
    const lines = readFileSync(file, 'utf8').split('\n');

    lines.forEach((line, index) => {
      if (!HTTP_DECORATOR.test(line)) return;

      // Decorators stack in any order, so the whole contiguous block above and below the HTTP
      // decorator counts as the handler's declaration.
      const guarded =
        scanDecoratorBlock(lines, index, -1).some((l) => AUTHORISATION.test(l)) ||
        scanDecoratorBlock(lines, index, 1).some((l) => AUTHORISATION.test(l));

      if (!guarded) {
        found.push({
          file: file.slice(SRC.length + 1).replace(/\\/g, '/'),
          line: index + 1,
          route: line.trim(),
        });
      }
    });
  }

  return found;
}

/** Walks away from the HTTP decorator while the lines still belong to the same decorator block. */
function scanDecoratorBlock(lines: string[], from: number, step: -1 | 1): string[] {
  const block: string[] = [];
  for (let i = from + step; i >= 0 && i < lines.length; i += step) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
    // A decorator, or the continuation of a multi-line one.
    if (/^\s*@/.test(line) || /^\s*[)}\]]/.test(line) || /^\s{4,}\S/.test(line)) {
      block.push(line);
      continue;
    }
    break;
  }
  return block;
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
