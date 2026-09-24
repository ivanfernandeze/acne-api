import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import 'dotenv/config';
import { DataSource } from 'typeorm';

/**
 * Volcado completo de la base a JSON, antes de una migración destructiva.
 *
 * No sustituye a `pg_dump` y no pretende hacerlo: existe porque el cliente de PostgreSQL no está
 * instalado en la máquina de desarrollo y una migración que hace `DROP` de todo no debería correrse
 * sin una copia a la que volver. Guarda el DDL suficiente para saber cómo era el esquema y TODAS las
 * filas de todas las tablas, con lo que el contenido es recuperable.
 *
 * Las identidades de paciente salen tal como están en la base: ciphertext AES-256-GCM. El volcado no
 * descifra nada, de modo que el fichero no es más sensible que la propia base — pero sí es una copia
 * más, así que vive fuera del control de versiones (ver `acne-infra/.gitignore`).
 *
 *   pnpm ts-node -r tsconfig-paths/register src/scripts/dump-database.ts [directorio]
 */
async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url === '') {
    throw new Error('Falta DATABASE_URL. Copie acne-api/.env.example a .env y complételo.');
  }

  const target = resolve(
    process.argv[2] ?? join(__dirname, '..', '..', '..', 'acne-infra', 'backups'),
  );
  mkdirSync(target, { recursive: true });

  const dataSource = new DataSource({ type: 'postgres', url, ssl: false });
  await dataSource.initialize();

  try {
    const tables = await dataSource.query<Array<{ tablename: string }>>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    );

    const columns = await dataSource.query<
      Array<{
        table_name: string;
        column_name: string;
        data_type: string;
        is_nullable: string;
        column_default: string | null;
      }>
    >(
      `SELECT table_name, column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = 'public'
        ORDER BY table_name, ordinal_position`,
    );

    const constraints = await dataSource.query<
      Array<{ table_name: string; constraint_name: string; definition: string }>
    >(
      `SELECT rel.relname AS table_name, con.conname AS constraint_name,
              pg_get_constraintdef(con.oid) AS definition
         FROM pg_constraint con
         JOIN pg_class rel ON rel.oid = con.conrelid
         JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
        WHERE nsp.nspname = 'public'
        ORDER BY rel.relname, con.conname`,
    );

    const data: Record<string, unknown[]> = {};
    let total = 0;
    for (const { tablename } of tables) {
      const rows = await dataSource.query<unknown[]>(`SELECT * FROM "${tablename}"`);
      data[tablename] = rows;
      total += rows.length;
      console.log(`  ${tablename.padEnd(24)} ${String(rows.length).padStart(5)} filas`);
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const file = join(target, `volcado-${stamp}.json`);
    writeFileSync(
      file,
      JSON.stringify(
        {
          generadoEn: new Date().toISOString(),
          motivo: 'Copia previa a la migración EsquemaEspanolNormalizado (esquema en inglés).',
          esquema: { columnas: columns, restricciones: constraints },
          datos: data,
        },
        null,
        2,
      ),
      'utf8',
    );

    console.log(`\n${tables.length} tablas, ${total} filas.`);
    console.log(`Volcado escrito en: ${file}`);
  } finally {
    await dataSource.destroy();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
