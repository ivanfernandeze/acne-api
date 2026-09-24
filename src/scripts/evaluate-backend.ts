/**
 * Re-runs every synthetic case through the active AI backend and reports how well it graded them.
 *
 * Answers "what precision does this model give us" with the number the thesis actually uses: TPD,
 * the proportion of cases whose predicted IGA class matches the consensus label. Work is handed to
 * the REAL queue — the same `ai_inferences` + `inference_jobs` pair that `InferenceService.request`
 * writes — so the running API drains it through the whole path: decryption, engine, validation,
 * persistence and region overlay. The queue's poll interval doubles as a rate limiter against the
 * provider's quota.
 *
 * It enqueues by INSERT rather than through the HTTP route because the seeded passwords are printed
 * once and never stored. The only thing skipped is the controller's audit entry, which is not what
 * is being measured.
 *
 * WHAT THIS IS NOT: evidence for the thesis. The images are synthetic. The run measures that the
 * integration works and that the model responds sensibly to a constructed visual signal. A citable
 * figure needs real clinical photographs graded by the specialist.
 *
 *   npm run evaluate:backend
 */
import { IGA_CLASSES, IGA_ORDINAL, type IgaClass } from 'src/common/domain';

import dataSource from '../database/data-source';

const POLL_MS = 3000;
const TIMEOUT_MS = 15 * 60 * 1000;
/** RNF-01 fixes the per-image budget on CPU. */
const LATENCY_BUDGET_MS = 8000;

interface CaseRow {
  caseId: string;
  caseCode: string;
  imageId: string;
  groundTruth: IgaClass;
  manualIga: IgaClass | null;
}

async function main(): Promise<void> {
  await dataSource.initialize();

  const cases = await dataSource.query<CaseRow[]>(
    `SELECT c."id"               AS "caseId",
            c."codigo_caso"        AS "caseCode",
            im."id"              AS "imageId",
            c."clase_iga_referencia" AS "groundTruth",
            dx."clase_iga_codigo"       AS "manualIga"
       FROM "casos" c
       JOIN LATERAL (
            SELECT i."id" FROM "imagenes_caso" i
             WHERE i."caso_id" = c."id" AND i."es_mapa_calor" = false
             ORDER BY i."creado_en" ASC LIMIT 1
       ) im ON true
       LEFT JOIN LATERAL (
            SELECT d."clase_iga_codigo" FROM "diagnosticos" d
             WHERE d."caso_id" = c."id" AND d."modo_estudio_codigo" = 'pretest'
             ORDER BY d."creado_en" ASC LIMIT 1
       ) dx ON true
      WHERE c."es_sintetico" = true AND c."clase_iga_referencia" IS NOT NULL
      ORDER BY c."codigo_caso" ASC`,
  );

  if (cases.length === 0) {
    console.log('No hay casos sintéticos con imagen y patrón de consenso. ¿Falta seed:study?');
    await dataSource.destroy();
    return;
  }
  console.log(`${cases.length} casos sintéticos con imagen y patrón de consenso.\n`);

  const caseIds = cases.map((row) => row.caseId);

  // Reporting on a run that already drained, without spending another 30 calls against the quota.
  if (process.env.EVAL_REPORT_ONLY === '1') {
    console.log('Modo solo-informe: no se borra ni se reencola nada.\n');
    await report(cases);
    await dataSource.destroy();
    return;
  }

  // The previous predictions have to go: `InferenceService.request` is idempotent and would hand
  // back the seeded rows instead of asking the model. Order matters — the inferences point at their
  // heatmap image, so they are removed first.
  await dataSource.query(`DELETE FROM "trabajos_inferencia" WHERE "caso_id" = ANY($1)`, [caseIds]);
  const wiped = await dataSource.query<Array<{ id: string }>>(
    `DELETE FROM "inferencias_ia" WHERE "caso_id" = ANY($1) RETURNING "id"`,
    [caseIds],
  );
  const maps = await dataSource.query<Array<{ id: string }>>(
    `DELETE FROM "imagenes_caso" WHERE "caso_id" = ANY($1) AND "es_mapa_calor" = true RETURNING "id"`,
    [caseIds],
  );
  console.log(`Se borraron ${wiped.length} inferencias anteriores y ${maps.length} mapas.\n`);

  const [requester] = await dataSource.query<Array<{ id: string }>>(
    `SELECT "id" FROM "usuarios"
      WHERE "rol_codigo" = 'dermatologo' AND "es_sintetico" = false
      ORDER BY "creado_en" ASC LIMIT 1`,
  );
  if (requester === undefined) {
    throw new Error('No hay ningún dermatólogo a quien atribuir la solicitud.');
  }

  for (const row of cases) {
    await dataSource.query(
      `INSERT INTO "inferencias_ia" ("caso_id","imagen_id","estado_codigo","version_modelo","backend_modelo","semilla")
       VALUES ($1,$2,'pendiente','pending','unknown',42)`,
      [row.caseId, row.imageId],
    );
    await dataSource.query(
      `INSERT INTO "trabajos_inferencia" ("caso_id","imagen_id","solicitado_por","estado_codigo")
       VALUES ($1,$2,$3,'pendiente')`,
      [row.caseId, row.imageId, requester.id],
    );
  }
  console.log(`${cases.length} trabajos encolados. Esperando a que la API los drene…`);

  const started = Date.now();
  for (;;) {
    const [progress] = await dataSource.query<
      Array<{ pending: string; done: string; failed: string }>
    >(
      `SELECT COUNT(*) FILTER (WHERE "estado_codigo" IN ('pendiente','ejecutando')) AS "pending",
              COUNT(*) FILTER (WHERE "estado_codigo" = 'exitoso')            AS "done",
              COUNT(*) FILTER (WHERE "estado_codigo" = 'fallido')            AS "failed"
         FROM "inferencias_ia" WHERE "caso_id" = ANY($1)`,
      [caseIds],
    );
    const pending = Number(progress?.pending ?? 0);
    const elapsed = Math.round((Date.now() - started) / 1000);
    process.stdout.write(
      `\r  ${progress?.done ?? 0} listas · ${progress?.failed ?? 0} fallidas · ` +
        `${pending} en curso · ${elapsed}s   `,
    );
    if (pending === 0) break;
    if (Date.now() - started > TIMEOUT_MS) {
      console.log('\n\nSe agotó el tiempo de espera. ¿Está corriendo la API con el worker activo?');
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  console.log('\n');

  await report(cases);
  await dataSource.destroy();
}

interface ResultRow {
  caseId: string;
  predicted: IgaClass | null;
  confidence: number | null;
  latencyMs: number | null;
  backend: string;
  version: string;
  status: string;
  heatmap: string | null;
  error: string | null;
}

async function report(cases: CaseRow[]): Promise<void> {
  const rows = await dataSource.query<ResultRow[]>(
    `SELECT "caso_id" AS "caseId", "clase_iga_codigo" AS "predicted", "confianza",
            "latencia_ms" AS "latencyMs", "backend_modelo" AS "backend",
            "version_modelo" AS "version", "estado_codigo",
            "imagen_mapa_calor" AS "heatmap", "mensaje_error" AS "error"
       FROM "inferencias_ia" WHERE "caso_id" = ANY($1)`,
    [cases.map((row) => row.caseId)],
  );
  const byCase = new Map(rows.map((row) => [row.caseId, row]));

  console.log(`Backend: ${rows[0]?.backend ?? '—'}   versión: ${rows[0]?.version ?? '—'}\n`);

  let hits = 0;
  let graded = 0;
  let adjacent = 0;
  let manualHits = 0;
  let manualGraded = 0;
  const matrix = IGA_CLASSES.map(() => IGA_CLASSES.map(() => 0));
  const latencies: number[] = [];
  const failures: string[] = [];

  console.log('CASO             PATRÓN               PREDICHO             CONF     LAT');
  console.log('-'.repeat(74));
  for (const row of cases) {
    if (row.manualIga !== null) {
      manualGraded++;
      if (row.manualIga === row.groundTruth) manualHits++;
    }

    const result = byCase.get(row.caseId);
    if (result === undefined || result.status !== 'exitoso' || result.predicted === null) {
      failures.push(`${row.caseCode}: ${result?.error ?? 'sin resultado'}`);
      console.log(`${row.caseCode.padEnd(16)} ${row.groundTruth.padEnd(20)} — FALLÓ`);
      continue;
    }

    graded++;
    const distance = Math.abs(IGA_ORDINAL[result.predicted] - IGA_ORDINAL[row.groundTruth]);
    if (distance === 0) hits++;
    if (distance === 1) adjacent++;
    matrix[IGA_ORDINAL[row.groundTruth]]![IGA_ORDINAL[result.predicted]]!++;
    if (result.latencyMs !== null) latencies.push(result.latencyMs);

    const mark = distance === 0 ? 'OK' : distance === 1 ? '~1' : 'X';
    console.log(
      `${row.caseCode.padEnd(16)} ${row.groundTruth.padEnd(20)} ${result.predicted.padEnd(20)} ` +
        `${(result.confidence ?? 0).toFixed(2)}  ${String(result.latencyMs ?? '—').padStart(6)}  ${mark}`,
    );
  }

  const pct = (part: number, whole: number): string =>
    whole === 0 ? '—' : `${((part / whole) * 100).toFixed(2)} %`;

  console.log('\n-- TPD ------------------------------------------------------');
  console.log(`  Aciertos exactos    : ${hits}/${graded}  =  ${pct(hits, graded)}`);
  console.log(
    `  Dentro de +-1 clase : ${hits + adjacent}/${graded}  =  ${pct(hits + adjacent, graded)}`,
  );
  console.log(
    `  TPD manual (pretest): ${manualHits}/${manualGraded}  =  ${pct(manualHits, manualGraded)}`,
  );

  console.log('\n-- Matriz de confusión (fila = patrón, columna = predicho) ---');
  console.log(`${''.padEnd(20)}${IGA_CLASSES.map((c) => c.slice(0, 8).padStart(10)).join('')}`);
  IGA_CLASSES.forEach((actual, index) => {
    console.log(`${actual.padEnd(20)}${matrix[index]!.map((n) => String(n).padStart(10)).join('')}`);
  });

  console.log('\n-- F1 por clase ---------------------------------------------');
  IGA_CLASSES.forEach((cls, i) => {
    const tp = matrix[i]![i]!;
    const fp = IGA_CLASSES.reduce((acc, _c, j) => acc + (j === i ? 0 : matrix[j]![i]!), 0);
    const fn = IGA_CLASSES.reduce((acc, _c, j) => acc + (j === i ? 0 : matrix[i]![j]!), 0);
    const support = tp + fn;
    const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
    const recall = support === 0 ? 0 : tp / support;
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    console.log(
      `  ${cls.padEnd(20)} soporte=${String(support).padStart(2)}  P=${precision.toFixed(2)}  ` +
        `R=${recall.toFixed(2)}  F1=${f1.toFixed(2)}`,
    );
  });

  if (latencies.length > 0) {
    const sorted = [...latencies].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)]!;
    console.log('\n-- Latencia -------------------------------------------------');
    console.log(
      `  mediana ${median} ms · p95 ${p95} ms · umbral RNF-01 (CPU) ${LATENCY_BUDGET_MS} ms`,
    );
    if (p95 > LATENCY_BUDGET_MS) {
      console.log('  AVISO: el p95 excede el máximo que RNF-01 fija para CPU.');
    }
  }

  if (failures.length > 0) {
    console.log(`\n-- Fallos (${failures.length}) -----------------------------------------`);
    failures.forEach((failure) => console.log(`  ${failure}`));
  }

  const withHeatmap = rows.filter((row) => row.heatmap !== null).length;
  console.log(`\n  Regiones señaladas guardadas en ${withHeatmap} de ${graded} inferencias.`);
  console.log(
    '\n  Recordatorio: las imágenes son SINTÉTICAS. Esta cifra mide que la integración funciona,\n' +
      '  no la precisión clínica del modelo. Eso exige fotografías reales graduadas por el especialista.',
  );
}

main().catch((error: unknown) => {
  console.error('Falló la evaluación:', error);
  process.exit(1);
});
