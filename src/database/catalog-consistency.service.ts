import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { DataSource } from 'typeorm';

import {
  ANAMNESIS_ANSWER_TYPES,
  ANAMNESIS_SCOPES,
  ANAMNESIS_SECTIONS,
  CASE_STATUSES,
  DELIVERY_CHANNELS,
  FITZPATRICK_TYPES,
  GAGS_GRADES,
  HYPOTHESES,
  IGA_CLASSES,
  INDICATORS,
  LIKERT_ITEM_NUMBERS,
  PERMISSIONS,
  PRESCRIPTION_STATUSES,
  PROCESS_STATUSES,
  ROLE_PERMISSIONS,
  SEXES,
  SHOT_KEYS,
  STUDY_MODES,
  USER_ROLES,
  WORK_SHIFTS,
} from 'src/common/domain';

/**
 * Fails startup when the catalogues in `common/domain/` and the catalogue tables disagree.
 *
 * The normalised schema puts every closed enumeration in a table with a foreign key, and the
 * application keeps validating against the TypeScript constants. That is two copies of the same
 * list, which is exactly the kind of duplication that rots: someone adds an IGA class to the domain
 * file, forgets the migration, and the first diagnosis carrying it dies on a foreign key at the
 * worst possible moment — with a patient in the room.
 *
 * The alternative was to drop one copy. Reading the catalogues from the database at runtime would
 * cost a query on every validation and give up compile-time exhaustiveness on `IgaClass`; dropping
 * the tables would give up referential integrity and leave the schema undocumented for an examiner.
 * Keeping both and CHECKING them once at boot buys both properties for one query per catalogue.
 *
 * It refuses to start rather than warning: a mismatch means writes will fail later anyway, and a
 * process that dies at boot in front of whoever deployed it is far cheaper to diagnose than one
 * that dies at 3 p.m. in front of a patient.
 *
 * `preguntas_anamnesis` SALIÓ de esta lista el 09/09/2026. Dejó de ser un espejo de
 * `ANAMNESIS_QUESTIONS` para convertirse en la fuente de verdad del cuestionario: la clínica crea,
 * edita y retira preguntas desde el portal, y la constante quedó como la semilla con la que arranca
 * una instalación nueva. Comprobar que coinciden impediría exactamente lo que la pantalla permite.
 */
@Injectable()
export class CatalogConsistencyService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CatalogConsistencyService.name);

  constructor(private readonly dataSource: DataSource) {}

  async onApplicationBootstrap(): Promise<void> {
    const checks: CatalogCheck[] = [
      { table: 'roles', column: 'codigo', expected: USER_ROLES },
      { table: 'permisos', column: 'codigo', expected: PERMISSIONS },
      { table: 'modos_estudio', column: 'codigo', expected: STUDY_MODES },
      { table: 'estados_caso', column: 'codigo', expected: CASE_STATUSES },
      { table: 'estados_proceso', column: 'codigo', expected: PROCESS_STATUSES },
      { table: 'estados_receta', column: 'codigo', expected: PRESCRIPTION_STATUSES },
      { table: 'canales_envio', column: 'codigo', expected: DELIVERY_CHANNELS },
      { table: 'turnos', column: 'codigo', expected: WORK_SHIFTS },
      { table: 'clases_iga', column: 'codigo', expected: IGA_CLASSES },
      { table: 'grados_gags', column: 'codigo', expected: GAGS_GRADES },
      { table: 'sexos', column: 'codigo', expected: SEXES },
      { table: 'fototipos_fitzpatrick', column: 'codigo', expected: FITZPATRICK_TYPES },
      { table: 'tomas_fotograficas', column: 'codigo', expected: SHOT_KEYS },
      { table: 'indicadores', column: 'codigo', expected: INDICATORS },
      { table: 'hipotesis', column: 'codigo', expected: HYPOTHESES },
      { table: 'secciones_anamnesis', column: 'codigo', expected: ANAMNESIS_SECTIONS },
      { table: 'tipos_pregunta', column: 'codigo', expected: ANAMNESIS_ANSWER_TYPES },
      { table: 'ambitos_anamnesis', column: 'codigo', expected: ANAMNESIS_SCOPES },
      {
        table: 'items_encuesta',
        column: 'numero',
        expected: LIKERT_ITEM_NUMBERS.map(String),
      },
    ];

    const problems: string[] = [];
    for (const check of checks) {
      problems.push(...(await this.compare(check)));
    }
    problems.push(...(await this.comparePermissionMatrix()));

    if (problems.length > 0) {
      throw new Error(
        'Los catálogos de la base de datos no coinciden con los de common/domain/:\n' +
          problems.map((problem) => `  - ${problem}`).join('\n') +
          '\nCorrija la migración o el catálogo del dominio; no son dos listas independientes.',
      );
    }

    this.logger.log(
      `Catálogos verificados: ${checks.length} tablas y la matriz de permisos coinciden con el dominio.`,
    );
  }

  /**
   * La matriz rol → permisos, comparada par a par.
   *
   * Comprobar solo que existan los mismos códigos de rol y de permiso dejaba fuera lo único que
   * decide algo: QUÉ puede hacer cada rol. Un permiso concedido en `ROLE_PERMISSIONS` y olvidado en
   * la migración no rompe ninguna clave foránea — simplemente hace que la base declare una política
   * de autorización distinta de la que el servidor aplica, que es exactamente el desacuerdo que
   * nadie descubre leyendo el esquema.
   */
  private async comparePermissionMatrix(): Promise<string[]> {
    const rows = await this.dataSource.query<Array<{ rol: string; permiso: string }>>(
      `SELECT "rol_codigo" AS "rol", "permiso_codigo" AS "permiso" FROM "roles_permisos"`,
    );
    const inDatabase = new Set(rows.map((row) => `${row.rol}/${row.permiso}`));
    const inCode = new Set(
      Object.entries(ROLE_PERMISSIONS).flatMap(([role, permissions]) =>
        permissions.map((permission) => `${role}/${permission}`),
      ),
    );

    const missing = [...inCode].filter((pair) => !inDatabase.has(pair));
    const extra = [...inDatabase].filter((pair) => !inCode.has(pair));

    const problems: string[] = [];
    if (missing.length > 0) {
      problems.push(`"roles_permisos" no concede: ${missing.join(', ')} (sí en ROLE_PERMISSIONS).`);
    }
    if (extra.length > 0) {
      problems.push(`"roles_permisos" concede de más: ${extra.join(', ')} (no en ROLE_PERMISSIONS).`);
    }
    return problems;
  }

  private async compare({ table, column, expected }: CatalogCheck): Promise<string[]> {
    const rows = await this.dataSource.query<Array<Record<string, string | number>>>(
      `SELECT "${column}" FROM "${table}"`,
    );
    const inDatabase = new Set(rows.map((row) => String(row[column])));
    const inCode = new Set(expected.map(String));

    const missing = [...inCode].filter((value) => !inDatabase.has(value));
    const extra = [...inDatabase].filter((value) => !inCode.has(value));

    const problems: string[] = [];
    if (missing.length > 0) {
      problems.push(`"${table}" no tiene: ${missing.join(', ')} (sí están en el dominio).`);
    }
    if (extra.length > 0) {
      problems.push(`"${table}" tiene de más: ${extra.join(', ')} (no están en el dominio).`);
    }
    return problems;
  }
}

interface CatalogCheck {
  table: string;
  column: string;
  expected: readonly (string | number)[];
}
