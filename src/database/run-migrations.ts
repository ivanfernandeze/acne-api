import dataSource from './data-source';

/**
 * Runs pending migrations from the compiled bundle. Used by the Docker image, where the TypeORM
 * CLI and ts-node are not installed: `node dist/database/run-migrations.js`.
 */
async function main(): Promise<void> {
  await dataSource.initialize();
  const applied = await dataSource.runMigrations();
  if (applied.length === 0) {
    console.log('No hay migraciones pendientes.');
  } else {
    for (const migration of applied) {
      console.log(`Migración aplicada: ${migration.name}`);
    }
  }
  await dataSource.destroy();
}

main().catch((error: unknown) => {
  console.error('Fallo al aplicar migraciones:', error);
  process.exit(1);
});
