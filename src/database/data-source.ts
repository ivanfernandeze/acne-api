import { config as loadDotenv } from 'dotenv';
import { DataSource, type DataSourceOptions } from 'typeorm';

import { ENTITIES } from './entities';

loadDotenv();

/**
 * TypeORM CLI data source.
 *
 * `synchronize` is permanently false: the clinical schema only ever changes through reviewed
 * migrations, which is what makes the database reproducible six months later (RNF-03).
 */
export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  url: process.env.DATABASE_URL,
  ssl:
    process.env.DATABASE_SSL === 'true' || process.env.DATABASE_SSL === '1'
      ? { rejectUnauthorized: false }
      : false,
  entities: ENTITIES,
  migrations: [`${__dirname}/migrations/*.{ts,js}`],
  migrationsTableName: 'migrations_history',
  synchronize: false,
  logging: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
};

export default new DataSource(dataSourceOptions);
