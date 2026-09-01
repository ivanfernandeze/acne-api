import { createCipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import dataSource from '../data-source';
import { buildSyntheticFaceImage, buildSyntheticHeatmap } from './synthetic-image';

/**
 * Generates a complete SYNTHETIC study: 30 cases, each measured twice (pretest and postest),
 * work journeys and Likert responses.
 *
 * Purpose: make the dashboards, the hypothesis contrasts and the four PDF reports demonstrable
 * before a single real patient exists. Every row is written with `is_synthetic = true`, and both
 * the indicators and the dataset export exclude those rows by default, so demo data can never be
 * mistaken for thesis evidence.
 *
 * Reproducibility (RNF-03): all randomness comes from a seeded generator, so running this twice
 * on an empty database produces byte-identical measurements.
 */

const SEED = 20260829;
const CASE_COUNT = 30;

const IGA_CLASSES = ['sin_lesiones', 'casi_sin_lesiones', 'leve', 'moderado', 'severo'] as const;
type IgaClass = (typeof IGA_CLASSES)[number];

/** Mulberry32 — small, fast, fully deterministic from a single 32-bit seed. */
function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = createRng(SEED);

function pick<T>(items: readonly T[]): T {
  const index = Math.floor(rng() * items.length);
  return items[Math.min(index, items.length - 1)] as T;
}

/** Box-Muller, so review times follow a plausible bell shape rather than a flat one. */
function normal(mean: number, sd: number, min: number): number {
  const u1 = Math.max(rng(), 1e-9);
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.max(min, mean + z * sd);
}

function encryptBuffer(plaintext: Buffer, keyHex: string): Buffer {
  const key = Buffer.from(keyHex, 'hex');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

function encrypt(plaintext: string, keyHex: string): string {
  return encryptBuffer(Buffer.from(plaintext, 'utf8'), keyHex).toString('base64');
}

/**
 * Writes a synthetic image through the same path a real upload takes: AES-256-GCM encrypted at
 * rest, SHA-256 of the plaintext recorded for integrity, key under the local storage root. The
 * seeded case therefore renders in the portal exactly like a real one.
 *
 * The seed only targets the local driver; with `STORAGE_DRIVER=minio` the rows would point at
 * objects that never reached the bucket, so it refuses instead of producing broken cases.
 */
async function storeSyntheticImage(
  caseId: string,
  plaintext: Buffer,
  isHeatmap: boolean,
  keyHex: string,
  storageRoot: string,
): Promise<string> {
  const key = `${isHeatmap ? 'heatmaps' : 'cases'}/${caseId}/${randomUUID()}.enc`;
  const target = resolve(join(storageRoot, key));
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, encryptBuffer(plaintext, keyHex));

  const [image] = (await dataSource.query(
    `INSERT INTO "case_images"
       ("case_id","storage_key","storage_driver","mime_type","width","height","size_bytes","sha256","encrypted","is_heatmap")
     VALUES ($1,$2,'local','image/png',256,256,$3,$4,true,$5) RETURNING "id"`,
    [
      caseId,
      key,
      plaintext.length,
      createHash('sha256').update(plaintext).digest('hex'),
      isHeatmap,
    ],
  )) as Array<{ id: string }>;

  if (image === undefined) throw new Error('No se pudo registrar la imagen sintética.');
  return image.id;
}

const FIRST_NAMES = ['María', 'José', 'Ana', 'Carlos', 'Lucía', 'Miguel', 'Rosa', 'Diego', 'Elena', 'Jorge'];
const LAST_NAMES = ['Quispe', 'Vargas', 'Rojas', 'Chávez', 'Mendoza', 'Flores', 'Castillo', 'Ramos'];

async function main(): Promise<void> {
  const encryptionKey = process.env.ENCRYPTION_KEY;
  if (encryptionKey === undefined || !/^[0-9a-fA-F]{64}$/.test(encryptionKey)) {
    throw new Error('ENCRYPTION_KEY debe estar definida en .env como 64 caracteres hexadecimales.');
  }

  const storageDriver = process.env.STORAGE_DRIVER ?? 'local';
  if (storageDriver !== 'local') {
    throw new Error(
      `El seeder solo escribe imágenes en el disco local, pero STORAGE_DRIVER=${storageDriver}. ` +
        'Póngalo temporalmente en "local" para sembrar, o los casos quedarían sin imagen legible.',
    );
  }
  const storageRoot = resolve(process.env.STORAGE_LOCAL_PATH ?? './storage');

  await dataSource.initialize();

  const professionals = (await dataSource.query(
    `SELECT "id", "full_name" FROM "users" WHERE "role" IN ('dermatologo','residente') ORDER BY "full_name" LIMIT 4`,
  )) as Array<{ id: string; full_name: string }>;

  if (professionals.length === 0) {
    throw new Error('No hay profesionales registrados. Ejecute primero: pnpm seed:admin');
  }

  const existing = (await dataSource.query(
    `SELECT COUNT(*)::int AS n FROM "cases" WHERE "is_synthetic" = true`,
  )) as Array<{ n: number }>;
  if ((existing[0]?.n ?? 0) > 0) {
    console.log('Ya existen casos sintéticos. Elimínelos antes de volver a sembrar:');
    console.log('  DELETE FROM "cases" WHERE "is_synthetic" = true;');
    console.log('  DELETE FROM "work_sessions" WHERE "is_synthetic" = true;');
    console.log('  DELETE FROM "survey_responses" WHERE "is_synthetic" = true;');
    await dataSource.destroy();
    return;
  }

  const baseDate = new Date('2026-03-02T09:00:00.000Z');
  let patientSequence = 0;
  let caseSequence = 0;

  console.log(`Sembrando ${CASE_COUNT} casos sintéticos (semilla ${SEED})…`);

  for (let i = 0; i < CASE_COUNT; i++) {
    const professional = professionals[i % professionals.length];
    if (professional === undefined) continue;

    patientSequence++;
    caseSequence++;
    const patientCode = `PAC-2026-S${String(patientSequence).padStart(3, '0')}`;
    const caseCode = `ACN-2026-S${String(caseSequence).padStart(3, '0')}`;
    const fullName = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)} ${pick(LAST_NAMES)}`;
    const groundTruth: IgaClass = pick(IGA_CLASSES);

    const [patient] = (await dataSource.query(
      `INSERT INTO "patients" ("patient_code","encrypted_full_name","birth_date","sex","fitzpatrick_phototype","consent_accepted_at")
       VALUES ($1,$2,$3,$4,$5,now()) RETURNING "id"`,
      [
        patientCode,
        encrypt(fullName, encryptionKey),
        `${1995 + Math.floor(rng() * 15)}-0${1 + Math.floor(rng() * 9)}-1${Math.floor(rng() * 9)}`,
        pick(['femenino', 'masculino']),
        pick(['II', 'III', 'IV', 'V']),
      ],
    )) as Array<{ id: string }>;
    if (patient === undefined) continue;

    const [clinicalCase] = (await dataSource.query(
      `INSERT INTO "cases" ("case_code","patient_id","assigned_user_id","study_mode","status","ground_truth_iga","is_synthetic","closed_at")
       VALUES ($1,$2,$3,'pretest','closed',$4,true,now()) RETURNING "id"`,
      [caseCode, patient.id, professional.id, groundTruth],
    )) as Array<{ id: string }>;
    if (clinicalCase === undefined) continue;

    const imageId = await storeSyntheticImage(
      clinicalCase.id,
      buildSyntheticFaceImage(rng),
      false,
      encryptionKey,
      storageRoot,
    );

    const dayOffset = Math.floor(i / 5);

    // --- O1: pretest, without AI ------------------------------------------
    // Baseline review time drawn around 9 min/case, the order of magnitude reported for manual
    // dermatological review in the literature that motivates OE1 (Chen, 2024; Huang, 2025).
    const pretestMinutes = normal(9, 2.2, 3);
    const pretestStart = new Date(baseDate.getTime() + dayOffset * 86_400_000 + i * 900_000);
    const pretestEnd = new Date(pretestStart.getTime() + pretestMinutes * 60_000);

    await dataSource.query(
      `INSERT INTO "review_timings" ("case_id","user_id","study_mode","t0","t1","duration_seconds","valid")
       VALUES ($1,$2,'pretest',$3,$4,$5,true)`,
      [clinicalCase.id, professional.id, pretestStart, pretestEnd, Math.round(pretestMinutes * 60)],
    );

    // Manual accuracy around 70 %; when wrong, the error lands on an ADJACENT IGA class, which is
    // how graders actually miss on an ordinal scale.
    const manualCorrect = rng() < 0.7;
    const manualClass = manualCorrect ? groundTruth : adjacentClass(groundTruth);
    await dataSource.query(
      `INSERT INTO "diagnoses" ("case_id","user_id","study_mode","iga_class","agreement","created_at")
       VALUES ($1,$2,'pretest',$3,$4,$5)`,
      [
        clinicalCase.id,
        professional.id,
        manualClass,
        manualCorrect ? 'correcto' : 'incorrecto',
        pretestEnd,
      ],
    );

    // --- X: intervention, then O2: postest, with AI ------------------------
    const postestMinutes = normal(5.6, 1.5, 2);
    const postestStart = new Date(pretestStart.getTime() + 30 * 86_400_000);
    const postestEnd = new Date(postestStart.getTime() + postestMinutes * 60_000);

    await dataSource.query(
      `INSERT INTO "review_timings" ("case_id","user_id","study_mode","t0","t1","duration_seconds","valid")
       VALUES ($1,$2,'postest',$3,$4,$5,true)`,
      [clinicalCase.id, professional.id, postestStart, postestEnd, Math.round(postestMinutes * 60)],
    );

    // Synthetic model accuracy around 90 %, the figure Watanabe (2025) reports for EfficientNet-B2.
    const aiCorrect = rng() < 0.9;
    const aiClass = aiCorrect ? groundTruth : adjacentClass(groundTruth);
    const confidence = aiCorrect ? 0.78 + rng() * 0.2 : 0.45 + rng() * 0.25;

    const heatmapId = await storeSyntheticImage(
      clinicalCase.id,
      buildSyntheticHeatmap(rng),
      true,
      encryptionKey,
      storageRoot,
    );

    const [inference] = (await dataSource.query(
      `INSERT INTO "ai_inferences"
         ("case_id","image_id","status","iga_class","confidence","class_probs","gags_grade","gags_score",
          "latency_ms","model_version","model_backend","seed","heatmap_image_id","created_at")
       VALUES ($1,$2,'succeeded',$3,$4,$5,$6,$7,$8,'stub-deterministic-v0','stub',42,$9,$10)
       RETURNING "id"`,
      [
        clinicalCase.id,
        imageId,
        aiClass,
        Number(confidence.toFixed(4)),
        JSON.stringify(buildProbabilities(aiClass, confidence)),
        'moderate',
        Math.round(10 + rng() * 25),
        Math.round(600 + rng() * 900),
        heatmapId,
        postestStart,
      ],
    )) as Array<{ id: string }>;

    // With the suggestion visible, the specialist keeps it most of the time and corrects it when
    // it is wrong roughly half the time — the assisted-decision pattern OE2 is meant to capture.
    const assistedCorrect = aiCorrect || rng() < 0.5;
    const assistedClass = assistedCorrect ? groundTruth : aiClass;
    await dataSource.query(
      `INSERT INTO "diagnoses"
         ("case_id","user_id","study_mode","iga_class","agreement","ai_suggestion_accepted","ai_inference_id","created_at")
       VALUES ($1,$2,'postest',$3,$4,$5,$6,$7)`,
      [
        clinicalCase.id,
        professional.id,
        assistedClass,
        assistedCorrect ? 'correcto' : 'incorrecto',
        assistedClass === aiClass,
        inference?.id ?? null,
        postestEnd,
      ],
    );
  }

  // --- Work journeys for TCAD (OE4) ---------------------------------------
  console.log('Sembrando jornadas de trabajo…');
  for (const professional of professionals) {
    for (let journey = 0; journey < 4; journey++) {
      for (const mode of ['pretest', 'postest'] as const) {
        // Same journey length in both conditions; what changes is how many cases fit in it.
        const hours = 5 + rng() * 2;
        const casesReviewed =
          mode === 'pretest'
            ? Math.round(normal(hours * 6.2, 2, 3))
            : Math.round(normal(hours * 9.4, 2.5, 4));
        const started = new Date(
          baseDate.getTime() +
            (mode === 'postest' ? 30 : 0) * 86_400_000 +
            journey * 7 * 86_400_000,
        );
        const ended = new Date(started.getTime() + hours * 3_600_000);

        await dataSource.query(
          `INSERT INTO "work_sessions"
             ("user_id","study_mode","shift","started_at","ended_at","declared_duration_hours","cases_reviewed","tcad","is_synthetic")
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true)`,
          [
            professional.id,
            mode,
            pick(['manana', 'tarde']),
            started,
            ended,
            Number(hours.toFixed(2)),
            casesReviewed,
            Number((casesReviewed / hours).toFixed(4)),
          ],
        );
      }
    }
  }

  // --- Likert questionnaires for TSP (OE3) --------------------------------
  console.log('Sembrando cuestionarios Likert…');
  for (const professional of professionals) {
    const scores = Array.from({ length: 8 }, () => (rng() < 0.65 ? 5 : 4));
    const pointsObtained = scores.reduce((acc, s) => acc + s, 0);
    const meanLikert = pointsObtained / scores.length;

    const [response] = (await dataSource.query(
      `INSERT INTO "survey_responses"
         ("user_id","study_mode","points_obtained","total_points","tsp_pct","mean_likert","postest_cases_at_submission","is_synthetic")
       VALUES ($1,'postest',$2,40,$3,$4,15,true) RETURNING "id"`,
      [professional.id, pointsObtained, Number(((pointsObtained / 40) * 100).toFixed(4)), Number(meanLikert.toFixed(4))],
    )) as Array<{ id: string }>;
    if (response === undefined) continue;

    for (let item = 1; item <= 8; item++) {
      await dataSource.query(
        `INSERT INTO "survey_answers" ("response_id","item_number","score") VALUES ($1,$2,$3)`,
        [response.id, item, scores[item - 1] ?? 4],
      );
    }
  }

  await dataSource.destroy();

  console.log('\nListo. Datos sintéticos marcados con is_synthetic = true.');
  console.log('Para verlos en el portal y en los reportes use includeSynthetic=true.');
  console.log('Para eliminarlos:');
  console.log('  DELETE FROM "cases" WHERE "is_synthetic" = true;');
  console.log('  DELETE FROM "work_sessions" WHERE "is_synthetic" = true;');
  console.log('  DELETE FROM "survey_responses" WHERE "is_synthetic" = true;');
}

/** Misclassification on an ordinal scale lands next door, not at random. */
function adjacentClass(actual: IgaClass): IgaClass {
  const index = IGA_CLASSES.indexOf(actual);
  const direction = rng() < 0.5 ? -1 : 1;
  const target = Math.min(IGA_CLASSES.length - 1, Math.max(0, index + direction));
  const candidate = IGA_CLASSES[target === index ? Math.max(0, index - 1) : target];
  return candidate ?? actual;
}

function buildProbabilities(predicted: IgaClass, confidence: number): Record<string, number> {
  const remainder = (1 - confidence) / (IGA_CLASSES.length - 1);
  const probabilities: Record<string, number> = {};
  for (const igaClass of IGA_CLASSES) {
    probabilities[igaClass] = Number((igaClass === predicted ? confidence : remainder).toFixed(4));
  }
  return probabilities;
}

main().catch((error: unknown) => {
  console.error('Fallo al sembrar el estudio sintético:', error);
  process.exit(1);
});
