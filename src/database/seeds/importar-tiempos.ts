import { readFileSync } from 'node:fs';

import dataSource from '../data-source';

/**
 * Carga los tiempos de revisión REALES cronometrados a mano (Anexo 4 en papel) en
 * `cronometrajes_revision`, reemplazando los medidos durante la carga al sistema.
 *
 * CSV con encabezado, una fila por caso:
 *     codigo_caso,hora_inicio,minutos
 *     ACN-2026-0001,08:12,5.32
 *
 * `hora_inicio` es hora de Perú (UTC-5) del día de trabajo. `minutos` admite decimales.
 * Ningún valor se inventa aquí: lo que no esté en el CSV no se toca.
 *
 *   ts-node -r tsconfig-paths/register src/database/seeds/importar-tiempos.ts <archivo.csv>           (simula)
 *   ts-node -r tsconfig-paths/register src/database/seeds/importar-tiempos.ts <archivo.csv> --apply   (ejecuta)
 */

const DIA = '2026-10-19';
const UTC_OFFSET_H = 5;

async function main(): Promise<void> {
  const file = process.argv[2];
  const apply = process.argv.includes('--apply');
  if (file === undefined || file.startsWith('--')) throw new Error('Indique el archivo CSV.');

  const lines = readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  const rows = lines.slice(1).map((line, i) => {
    const [code, start, minutes] = line.split(',').map((c) => c.trim());
    const match = /^(\d{1,2}):(\d{2})$/.exec(start ?? '');
    const min = Number(minutes);
    if (code === undefined || code === '' || match === null || !Number.isFinite(min) || min <= 0) {
      throw new Error(`Línea ${i + 2} inválida: «${line}»`);
    }
    const t0 = new Date(
      new Date(`${DIA}T00:00:00.000Z`).getTime() +
        (Number(match[1]) + UTC_OFFSET_H) * 3_600_000 +
        Number(match[2]) * 60_000,
    );
    return { code, t0, t1: new Date(t0.getTime() + min * 60_000), seconds: Math.round(min * 60), min };
  });

  await dataSource.initialize();
  const missing: string[] = [];
  const found: Array<(typeof rows)[number] & { caseId: string }> = [];
  for (const r of rows) {
    const res = (await dataSource.query(`SELECT id FROM casos WHERE codigo_caso = $1`, [r.code])) as Array<{ id: string }>;
    if (res[0] === undefined) missing.push(r.code);
    else found.push({ ...r, caseId: res[0].id });
  }
  if (missing.length > 0) throw new Error(`Casos que no existen: ${missing.join(', ')}`);

  const mean = rows.reduce((a, r) => a + r.min, 0) / rows.length;
  console.log(`${apply ? '== APLICAR ==' : '== SIMULACIÓN =='} ${rows.length} filas, promedio ${mean.toFixed(2)} min`);

  if (!apply) {
    await dataSource.destroy();
    return;
  }

  await dataSource.transaction(async (m) => {
    for (const r of found) {
      const upd = (await m.query(
        `UPDATE cronometrajes_revision SET t0=$2, t1=$3, duracion_segundos=$4, valido=true,
                notas = COALESCE(notas || E'\\n', '') || 'Tiempo reemplazado por el cronometrado a mano (Anexo 4).'
          WHERE caso_id=$1 AND modo_estudio_codigo='postest' RETURNING id`,
        [r.caseId, r.t0, r.t1, r.seconds],
      )) as unknown[];
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
