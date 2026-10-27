import { readFileSync } from 'node:fs';

import dataSource from '../data-source';

/**
 * Carga los tiempos de revisión REALES cronometrados a mano (Anexo 4 en papel) en
 * `cronometrajes_revision`, reemplazando los medidos durante la carga al sistema.
 *
 * CSV con encabezado, una fila por caso. Las columnas se leen por nombre:
 *     codigo_caso,hora_inicio,hora_fin,minutos
 *     ACN-2026-0001,08:05:12,08:10:52,5.67
 *
 *  - `hora_inicio` (obligatoria): HH:MM o HH:MM:SS, hora de Perú (UTC-5) del día de trabajo.
 *  - `hora_fin` y/o `minutos`: al menos una. Con las dos, deben coincidir (±1 s); si no, la fila se
 *    rechaza en lugar de elegir una. Sin `hora_fin`, t₁ = t₀ + minutos.
 *
 * Acepta también el CSV que guarda Excel en español (separador `;`, coma decimal).
 * Ningún valor se inventa aquí: lo que no esté en el CSV no se toca.
 *
 *   ts-node -r tsconfig-paths/register src/database/seeds/importar-tiempos.ts <archivo.csv>           (simula)
 *   ts-node -r tsconfig-paths/register src/database/seeds/importar-tiempos.ts <archivo.csv> --apply   (ejecuta)
 */

const DIA = '2026-10-19';
const UTC_OFFSET_H = 5;
const TOLERANCE_MS = 1_000;

interface Row {
  code: string;
  t0: Date;
  t1: Date;
  ms: number;
}

function peruTime(text: string): Date | null {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}(?:[.,]\d+)?))?$/.exec(text);
  if (match === null) return null;
  const seconds = Number((match[3] ?? '0').replace(',', '.'));
  if (Number(match[2]) > 59 || seconds >= 60) return null;
  return new Date(
    new Date(`${DIA}T00:00:00.000Z`).getTime() +
      (Number(match[1]) + UTC_OFFSET_H) * 3_600_000 +
      Number(match[2]) * 60_000 +
      Math.round(seconds * 1000),
  );
}

function parse(file: string): Row[] {
  const lines = readFileSync(file, 'utf8')
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '');
  const header = lines[0] ?? '';
  const delimiter = header.includes(';') ? ';' : ',';
  const names = header.split(delimiter).map((c) => c.trim().toLowerCase());
  const col = (name: string): number => names.indexOf(name);
  if (col('codigo_caso') < 0 || col('hora_inicio') < 0) {
    throw new Error('El encabezado debe tener codigo_caso y hora_inicio.');
  }
  if (col('hora_fin') < 0 && col('minutos') < 0) {
    throw new Error('El encabezado debe tener hora_fin, minutos o ambas.');
  }

  return lines.slice(1).map((line, i) => {
    const cells = line.split(delimiter).map((c) => c.trim());
    const cell = (name: string): string => (col(name) < 0 ? '' : (cells[col(name)] ?? ''));
    const fail = (why: string): never => {
      throw new Error(`Línea ${i + 2} (${why}): «${line}»`);
    };

    const code = cell('codigo_caso');
    if (code === '') fail('sin codigo_caso');
    const t0 = peruTime(cell('hora_inicio')) ?? fail('hora_inicio no es HH:MM o HH:MM:SS');
    const end = cell('hora_fin') === '' ? null : (peruTime(cell('hora_fin')) ?? fail('hora_fin no es HH:MM:SS'));
    const minutesText = cell('minutos').replace(',', '.');
    const minutes = minutesText === '' ? null : Number(minutesText);
    if (minutes !== null && (!Number.isFinite(minutes) || minutes <= 0)) fail('minutos inválido');
    if (end === null && minutes === null) fail('falta hora_fin o minutos');

    const t1 = end ?? new Date(t0.getTime() + (minutes as number) * 60_000);
    const ms = t1.getTime() - t0.getTime();
    if (ms <= 0) fail('hora_fin no es posterior a hora_inicio');
    if (end !== null && minutes !== null && Math.abs(ms - minutes * 60_000) > TOLERANCE_MS) {
      fail(`hora_fin − hora_inicio = ${(ms / 60_000).toFixed(2)} min, pero minutos = ${minutes}`);
    }
    return { code, t0, t1, ms };
  });
}

const hms = (d: Date): string => new Date(d.getTime() - UTC_OFFSET_H * 3_600_000).toISOString().slice(11, 19);

async function main(): Promise<void> {
  const file = process.argv[2];
  const apply = process.argv.includes('--apply');
  if (file === undefined || file.startsWith('--')) throw new Error('Indique el archivo CSV.');
  const rows = parse(file);

  await dataSource.initialize();
  const missing: string[] = [];
  const found: Array<Row & { caseId: string }> = [];
  const preview: Array<Record<string, string>> = [];
  for (const r of rows) {
    const res = (await dataSource.query(
      `SELECT c.id, t.t0, t.t1 FROM casos c
         LEFT JOIN cronometrajes_revision t ON t.caso_id = c.id AND t.modo_estudio_codigo = 'postest'
        WHERE c.codigo_caso = $1`,
      [r.code],
    ));
    const current = res[0];
    if (current === undefined) {
      missing.push(r.code);
      continue;
    }
    found.push({ ...r, caseId: current.id });
    preview.push({
      caso: r.code,
      't0 actual': current.t0 === null ? '—' : hms(current.t0),
      't0 nuevo': hms(r.t0),
      't1 actual': current.t1 === null ? '—' : hms(current.t1),
      't1 nuevo': hms(r.t1),
      'TR actual': current.t0 === null || current.t1 === null ? '—' : ((current.t1.getTime() - current.t0.getTime()) / 60_000).toFixed(2),
      'TR nuevo': (r.ms / 60_000).toFixed(2),
    });
  }
  if (missing.length > 0) throw new Error(`Casos que no existen: ${missing.join(', ')}`);

  const mean = rows.reduce((a, r) => a + r.ms, 0) / rows.length / 60_000;
  console.table(preview);
  console.log(`${apply ? '== APLICAR ==' : '== SIMULACIÓN =='} ${rows.length} filas, promedio ${mean.toFixed(2)} min`);

  if (!apply) {
    await dataSource.destroy();
    return;
  }

  await dataSource.transaction(async (m) => {
    for (const r of found) {
      const upd = (await m.query(
        // origen 'importada': sin esta marca las fichas exportadas presentan el cronometraje manual
        // como sellado por el servidor.
        `UPDATE cronometrajes_revision SET t0=$2, t1=$3, duracion_segundos=$4, valido=true,
                origen_codigo='importada',
                notas = COALESCE(notas || E'\\n', '') || 'Tiempo reemplazado por el cronometrado a mano (Anexo 4).'
          WHERE caso_id=$1 AND modo_estudio_codigo='postest' RETURNING id`,
        [r.caseId, r.t0, r.t1, Math.round(r.ms / 1000)],
      ));
      if (upd.length === 0) throw new Error(`El caso ${r.code} no tiene cronómetro postest.`);
    }
  });
  console.log('Listo.');
  await dataSource.destroy();
}

main().catch((error: unknown) => {
  console.error('Fallo:', error);
  process.exit(1);
});
