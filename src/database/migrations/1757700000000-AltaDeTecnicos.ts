import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * El especialista da de alta a su propio mostrador, y el personal tiene teléfono.
 *
 * DOS COSAS, y comparten migración porque llegan juntas de la misma necesidad: poder crear la
 * cuenta de quien atiende en admisión sin pasar por el administrador, con una forma de contactarle.
 *
 *  1. **`gestionar_tecnicos`**. Un permiso atómico nuevo, para `dermatologo` y `admin`. El alcance
 *     lo pone el servidor, no la pantalla: quien lo tiene sin `gestionar_usuarios` solo ve y crea
 *     cuentas de `tecnico`, de modo que no puede fabricarse un administrador ni tocar a otro
 *     médico. La matriz de la base y la de `common/domain/roles.ts` han de coincidir, o
 *     `CatalogConsistencyService` se niega a arrancar — que es justo para lo que existe.
 *
 *  2. **`usuarios.telefono_cifrado`**. El mismo tratamiento que el teléfono del paciente: AES-256-GCM
 *     antes de tocar la fila. Un directorio del personal en claro es exactamente lo que la
 *     Ley N.º 29733 pide no dejar por ahí, y el número de un profesional identifica a una persona
 *     igual que el de un paciente. Nulo porque las cuentas que ya existen no lo tienen y pedirlo
 *     retroactivamente habría bloqueado el arranque.
 */
export class AltaDeTecnicos1757700000000 implements MigrationInterface {
  name = 'AltaDeTecnicos1757700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "permisos" ("codigo","descripcion") VALUES
        ('gestionar_tecnicos','Dar de alta y mantener las cuentas del mostrador.')
      ON CONFLICT DO NOTHING`);

    await queryRunner.query(`
      INSERT INTO "roles_permisos" ("rol_codigo","permiso_codigo") VALUES
        ('dermatologo','gestionar_tecnicos'),
        ('admin','gestionar_tecnicos')
      ON CONFLICT DO NOTHING`);

    await queryRunner.query(
      `ALTER TABLE "usuarios" ADD COLUMN IF NOT EXISTS "telefono_cifrado" text`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "usuarios"."telefono_cifrado" IS
       'Telefono de contacto del profesional, cifrado con AES-256-GCM (Ley N.o 29733).'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "usuarios" DROP COLUMN IF EXISTS "telefono_cifrado"`,
    );
    await queryRunner.query(
      `DELETE FROM "roles_permisos" WHERE "permiso_codigo" = 'gestionar_tecnicos'`,
    );
    await queryRunner.query(`DELETE FROM "permisos" WHERE "codigo" = 'gestionar_tecnicos'`);
  }
}
