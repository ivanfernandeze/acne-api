import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Un DTO usado en `@Body()` tiene que existir en tiempo de ejecución.
 *
 * Importarlo con `import type` lo borra al compilar. El `ValidationPipe` corre con
 * `forbidNonWhitelisted`, de modo que sin la clase no encuentra NINGUNA propiedad permitida y
 * rechaza la petición entera con «property X should not exist» — un 400 que culpa al cliente por
 * enviar exactamente lo que el endpoint documenta.
 *
 * Cuesta encontrarlo porque el typecheck pasa, el lint pasa y la ruta existe: solo falla al
 * llamarla. Pasó con `PATCH /questions/:id` el 08/09/2026.
 *
 * La regla es estrecha a propósito: los DTO de RESPUESTA sí deben importarse como tipo, porque
 * nadie los instancia y arrastrarlos al bundle no aporta nada.
 */
const SRC = join(__dirname, '..', '..');

const BODY_PARAM = /@Body\(\)\s*\w+\s*:\s*([A-Z]\w*)/g;
const TYPE_IMPORT = /import type \{([^}]*)\} from/g;

interface Offender {
  file: string;
  dto: string;
}

describe('DTO de entrada en runtime', () => {
  it('ningún DTO usado en @Body() se importa como tipo', () => {
    const report = findOffenders()
      .map((hit) => `${hit.file}: @Body() usa ${hit.dto}, importado con "import type"`)
      .join('\n');

    // El arreglo es separar la importación: el DTO de entrada como valor, el de salida como tipo.
    expect(report).toBe('');
  });
});

function findOffenders(): Offender[] {
  const offenders: Offender[] = [];

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.endsWith('.controller.ts')) continue;

      const source = readFileSync(full, 'utf8');

      const asType = new Set<string>();
      for (const match of source.matchAll(TYPE_IMPORT)) {
        for (const name of match[1]?.split(',') ?? []) {
          const clean = name.trim().replace(/^type\s+/, '');
          if (clean !== '') asType.add(clean);
        }
      }

      for (const match of source.matchAll(BODY_PARAM)) {
        const dto = match[1];
        if (dto !== undefined && asType.has(dto)) {
          offenders.push({ file: entry, dto });
        }
      }
    }
  };

  walk(SRC);
  return offenders;
}
