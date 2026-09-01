import { randomBytes, scryptSync } from 'node:crypto';

import dataSource from '../data-source';

/**
 * Creates the initial accounts so the system can be used right after `migration:run`.
 *
 * Passwords are generated randomly and printed ONCE. Nothing is hard-coded: a thesis prototype
 * that ships with a known default password is a liability the moment it is demonstrated on a
 * networked machine.
 */

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${scryptSync(password, salt, 64).toString('hex')}`;
}

function generatePassword(): string {
  return randomBytes(9).toString('base64url');
}

interface SeedUser {
  email: string;
  fullName: string;
  role: string;
  studyMode: string;
  specialty: string | null;
}

const USERS: SeedUser[] = [
  {
    email: 'admin@unt.edu.pe',
    fullName: 'Administrador del estudio',
    role: 'admin',
    studyMode: 'produccion',
    specialty: null,
  },
  {
    email: 'dermatologo@centro.pe',
    fullName: 'Dra. Ana Torres Vega',
    role: 'dermatologo',
    studyMode: 'pretest',
    specialty: 'Dermatología clínica',
  },
  {
    email: 'residente@centro.pe',
    fullName: 'Dr. Luis Campos Ríos',
    role: 'residente',
    studyMode: 'pretest',
    specialty: 'Residencia en dermatología',
  },
  // HE3 contrasts the TSP of each professional against a baseline, so the questionnaire needs at
  // least three respondents for Shapiro-Wilk to be defined at all. A specialised centre with four
  // diagnosing professionals is also the realistic scale of the study.
  {
    email: 'dermatologo2@centro.pe',
    fullName: 'Dr. Manuel Salazar Peña',
    role: 'dermatologo',
    studyMode: 'pretest',
    specialty: 'Dermatología clínica',
  },
  {
    email: 'residente2@centro.pe',
    fullName: 'Dra. Carmen Ipanaqué Soto',
    role: 'residente',
    studyMode: 'pretest',
    specialty: 'Residencia en dermatología',
  },
  {
    email: 'evaluador@unt.edu.pe',
    fullName: 'Evaluador estadístico',
    role: 'evaluador_estadistico',
    studyMode: 'produccion',
    specialty: null,
  },
];

async function main(): Promise<void> {
  await dataSource.initialize();

  const created: Array<{ email: string; role: string; password: string }> = [];

  for (const user of USERS) {
    const existing = await dataSource.query('SELECT "id" FROM "users" WHERE "email" = $1', [
      user.email,
    ]);
    if ((existing as unknown[]).length > 0) {
      console.log(`· ${user.email} ya existe, se omite.`);
      continue;
    }

    const password = generatePassword();
    await dataSource.query(
      `INSERT INTO "users" ("email","password_hash","full_name","role","study_mode","specialty","active")
       VALUES ($1,$2,$3,$4,$5,$6,true)`,
      [user.email, hashPassword(password), user.fullName, user.role, user.studyMode, user.specialty],
    );
    created.push({ email: user.email, role: user.role, password });
  }

  await dataSource.destroy();

  if (created.length === 0) {
    console.log('\nNo se creó ninguna cuenta nueva.');
    return;
  }

  console.log('\n=========================================================');
  console.log(' CUENTAS CREADAS — anote estas contraseñas, no se repiten');
  console.log('=========================================================');
  for (const account of created) {
    console.log(` ${account.role.padEnd(22)} ${account.email.padEnd(26)} ${account.password}`);
  }
  console.log('=========================================================\n');
}

main().catch((error: unknown) => {
  console.error('Fallo al sembrar las cuentas:', error);
  process.exit(1);
});
