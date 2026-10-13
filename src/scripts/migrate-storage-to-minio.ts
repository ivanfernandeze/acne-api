import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';

import 'dotenv/config';
import { Client } from 'minio';
import { DataSource } from 'typeorm';

/**
 * Traslada el almacenamiento local (`STORAGE_LOCAL_PATH`, por defecto `./storage`) al bucket de
 * MinIO, conservando cada clave tal cual.
 *
 * Por qué basta con copiar: la API lee cada objeto por su clave (`imagenes_caso.clave_almacen`,
 * `usuarios.firma_ruta`) en el almacenamiento ACTIVO; la clave local `cases/<caso>/<imagen>.enc`
 * es el mismo nombre de objeto en el bucket. Los bytes se copian sin tocarlos: ya son ciphertext
 * AES-256-GCM, así que el bucket nunca ve una imagen legible y la misma `ENCRYPTION_KEY` los sigue
 * descifrando.
 *
 * Es idempotente: un objeto que ya está en el bucket con el mismo tamaño se omite, de modo que se
 * puede volver a correr tras un corte de red sin duplicar ni perder nada. Nunca borra los archivos
 * locales: quedan como respaldo hasta que se decida eliminarlos a mano.
 *
 *   pnpm storage:to-minio             # sube y verifica
 *   pnpm storage:to-minio --dry-run   # solo lista lo que subiría
 *   pnpm storage:to-minio --update-db # además marca driver_almacen = 'minio' en imagenes_caso
 */

const CONCURRENCY = 8;

async function listFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (value === undefined || value === '') {
    throw new Error(`Falta ${name} en .env (ver .env.example, sección MinIO).`);
  }
  return value;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const updateDb = process.argv.includes('--update-db');

  const root = resolve(process.env['STORAGE_LOCAL_PATH'] ?? './storage');
  const bucket = process.env['MINIO_BUCKET']?.trim() || 'tesisacne-images';
  const client = new Client({
    endPoint: required('MINIO_ENDPOINT'),
    port: Number(process.env['MINIO_PORT'] ?? 9000),
    useSSL: ['true', '1'].includes((process.env['MINIO_USE_SSL'] ?? '').toLowerCase()),
    accessKey: required('MINIO_ACCESS_KEY'),
    secretKey: required('MINIO_SECRET_KEY'),
  });

  const files = await listFiles(root);
  // Clave = ruta relativa con '/', que es como la escribió LocalStorageProvider (join(root, key)).
  const items = files.map((path) => ({ path, key: relative(root, path).split(sep).join('/') }));
  console.log(`Origen: ${root} · ${items.length} archivos`);
  console.log(`Destino: bucket "${bucket}" en ${process.env['MINIO_ENDPOINT']}`);
  if (dryRun) {
    for (const item of items.slice(0, 10)) console.log(`  ${item.key}`);
    if (items.length > 10) console.log(`  … y ${items.length - 10} más`);
    return;
  }

  if (!(await client.bucketExists(bucket))) {
    await client.makeBucket(bucket);
    console.log(`Bucket "${bucket}" creado.`);
  }

  let uploaded = 0;
  let skipped = 0;
  const failed: string[] = [];

  const queue = [...items];
  async function worker(): Promise<void> {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
      try {
        const { size } = await stat(item.path);
        const remote = await client.statObject(bucket, item.key).catch(() => null);
        if (remote !== null && remote.size === size) {
          skipped += 1;
          continue;
        }
        const data = await readFile(item.path);
        await client.putObject(bucket, item.key, data, data.length, {
          'Content-Type': 'application/octet-stream',
        });
        // Verificación: el objeto existe y pesa lo mismo que el archivo local.
        const check = await client.statObject(bucket, item.key);
        if (check.size !== size) throw new Error(`tamaño ${check.size} ≠ ${size}`);
        uploaded += 1;
        if ((uploaded + skipped) % 100 === 0) {
          console.log(`  ${uploaded + skipped}/${items.length}…`);
        }
      } catch (error: unknown) {
        failed.push(`${item.key}: ${String(error)}`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  console.log(`\nSubidos: ${uploaded} · Ya estaban: ${skipped} · Fallidos: ${failed.length}`);
  if (failed.length > 0) {
    for (const line of failed) console.error(`  ✗ ${line}`);
    console.error('\nVuelva a ejecutar el script: omite lo ya subido y reintenta lo fallido.');
    process.exit(1);
  }

  if (updateDb) {
    const dataSource = new DataSource({
      type: 'postgres',
      url: required('DATABASE_URL'),
      ssl: ['true', '1'].includes(process.env['DATABASE_SSL'] ?? '')
        ? { rejectUnauthorized: false }
        : false,
    });
    await dataSource.initialize();
    // `driver_almacen` es informativo (la lectura usa el almacenamiento activo), pero debe decir
    // la verdad: tras el traslado, esas imágenes viven en MinIO.
    const result: unknown = await dataSource.query(
      `UPDATE "imagenes_caso" SET "driver_almacen" = 'minio' WHERE "driver_almacen" = 'local'`,
    );
    const affected = Array.isArray(result) ? (result[1] as number) : 0;
    console.log(`imagenes_caso: ${affected} filas marcadas como 'minio'.`);
    await dataSource.destroy();
  }

  console.log('\nListo. Ahora ponga STORAGE_DRIVER=minio en .env y reinicie la API.');
  console.log(`Los archivos locales en ${root} NO se borraron: consérvelos como respaldo.`);
}

main().catch((error: unknown) => {
  console.error('Fallo el traslado:', error);
  process.exit(1);
});
