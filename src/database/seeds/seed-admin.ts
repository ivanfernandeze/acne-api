import { randomBytes, scryptSync } from 'node:crypto';

import dataSource from '../data-source';

/**
 * Creates the initial accounts so the system can be used right after `migration:run`.
 *
 * ONE ACCOUNT PER ROLE, and no more. It used to create seven — four of them dermatologists —
 * because HE₃ contrasts the satisfaction of each professional against a baseline and Shapiro-Wilk
 * needs at least three respondents to be defined at all. That reasoning was sound and the place was
 * wrong: those four were never staff of the clinic, they were padding for the demonstration census,
 * and mixing them in here made the system look like it had seven people for three roles.
 *
 * The professionals the synthetic census needs are created by `seed:study` and flagged
 * `es_sintetico`, exactly like the thirty cases they review. Deleting the demonstration data now
 * deletes them too.
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
  // Arranca en `pretest` a propósito: es la condición O₁ del diseño, y el estudio empieza midiendo
  // sin la herramienta. Pasar a postest ES la intervención X, y se hace desde el portal.
  {
    email: 'dermatologo@centro.pe',
    fullName: 'Dra. Ana Torres Vega',
    role: 'dermatologo',
    studyMode: 'pretest',
    specialty: 'Dermatología clínica',
  },
  // Opera el mostrador: registra al paciente, abre el caso y entrega el QR. No diagnostica, así que
  // no participa del experimento y se queda en `produccion`.
  {
    email: 'tecnico@centro.pe',
    fullName: 'Téc. Rosa Guerrero Lino',
    role: 'tecnico',
    studyMode: 'produccion',
    specialty: 'Admisión y toma de imágenes',
  },
];

async function main(): Promise<void> {
  await dataSource.initialize();

  const created: Array<{ email: string; role: string; password: string }> = [];

  for (const user of USERS) {
    const existing = await dataSource.query('SELECT "id" FROM "usuarios" WHERE "correo" = $1', [
      user.email,
    ]);
    if ((existing as unknown[]).length > 0) {
      console.log(`· ${user.email} ya existe, se omite.`);
      continue;
    }

    const password = generatePassword();
    await dataSource.query(
      `INSERT INTO "usuarios" ("correo","hash_contrasena","nombre_completo","rol_codigo","modo_estudio_codigo","especialidad","activo")
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
