import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * El pretest deja de ocurrir dentro del sistema.
 *
 * Hasta aquí el modo de estudio era un interruptor por USUARIO: el mismo dermatólogo revisaba los
 * treinta casos «en pretest», con la IA bloqueada por el servidor, y luego los volvía a revisar «en
 * postest». Ese montaje medía el sistema contra sí mismo con una mano atada, y le pedía al
 * especialista revisar dos veces lo mismo fingiendo la primera vez que no sabía nada.
 *
 * El pretest real es **cómo trabaja hoy la clínica**: sin software. Así que:
 *
 *  - Toda medición registrada por el sistema es `postest` por construcción.
 *  - Las de `pretest` entran TRANSCRITAS desde el registro manual, y las carga el administrador.
 *  - `usuarios.modo_estudio_codigo` desaparece: el modo describe de dónde viene una MEDICIÓN, no en
 *    qué estado está una persona.
 *  - Desaparece el modo `produccion`. Existía para el personal fuera del experimento; ahora no hay
 *    nadie fuera — si la medición está en el sistema, es postest.
 *
 * Las mediciones ya existentes se conservan tal cual: las que decían `pretest` siguen siendo la
 * observación O₁ de su caso, sea cual sea la vía por la que se registraron.
 */
export class PretestManual1757300000000 implements MigrationInterface {
  name = 'PretestManual1757300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── El modo abandona al usuario ──────────────────────────────────────────
    await queryRunner.query(
      `ALTER TABLE "usuarios" DROP CONSTRAINT IF EXISTS "FK_usuarios_modo_estudio"`,
    );
    await queryRunner.query(`ALTER TABLE "usuarios" DROP COLUMN IF EXISTS "modo_estudio_codigo"`);

    // ── `produccion` ya no existe ────────────────────────────────────────────
    // Toda medición que lo llevara se registró DENTRO del sistema, así que es postest por la misma
    // definición que introduce esta migración. Reetiquetarlas es lo correcto, no una conveniencia:
    // borrarlas perdería trabajo real y dejarlas con un código inexistente rompería la clave ajena.
    for (const tabla of [
      'casos',
      'diagnosticos',
      'cronometrajes_revision',
      'jornadas_trabajo',
      'respuestas_encuesta',
      'instantaneas_indicador',
    ]) {
      await queryRunner.query(
        `UPDATE "${tabla}" SET "modo_estudio_codigo" = 'postest' WHERE "modo_estudio_codigo" = 'produccion'`,
      );
    }
    await queryRunner.query(`DELETE FROM "modos_estudio" WHERE "codigo" = 'produccion'`);

    await queryRunner.query(
      `COMMENT ON TABLE "modos_estudio" IS 'CATALOGO. De donde viene una medicion, que es lo que operacionaliza la variable independiente (RF-TR-01). "pretest" es la evaluacion MANUAL de la clinica, transcrita por el administrador; "postest" es lo que produce este sistema. Ya no es un estado del usuario: es una propiedad de la fila.'`,
    );

    // ── La matriz de permisos sigue al nuevo reparto ─────────────────────────
    // El análisis pasa a ser exclusivo del administrador, y el técnico entra a la encuesta: opera
    // el sistema tanto como el especialista, de modo que su satisfacción es parte de lo que mide
    // OE3. Excluirlo habría dejado fuera a la mitad de quienes lo usan.
    await queryRunner.query(
      `DELETE FROM "roles_permisos" WHERE "rol_codigo" = 'dermatologo' AND "permiso_codigo" IN ('leer_analisis','leer_auditoria')`,
    );
    await queryRunner.query(`
      INSERT INTO "roles_permisos" ("rol_codigo","permiso_codigo") VALUES
        ('tecnico','responder_encuesta'),
        ('tecnico','registrar_jornada')
      ON CONFLICT DO NOTHING`);

    // ── Procedencia de la medición ───────────────────────────────────────────
    // Una fila de pretest se tecleó desde un papel y una de postest la selló el servidor. Sin esta
    // marca, un evaluador no puede distinguir un cronometraje medido de uno transcrito, y la
    // diferencia importa: el primero es evidencia del sistema y el segundo es testimonio.
    await queryRunner.query(`
      CREATE TABLE "origenes_medicion" (
        "codigo"      varchar(20) PRIMARY KEY,
        "nombre"      varchar(60) NOT NULL,
        "descripcion" text        NOT NULL
      )`);
    await queryRunner.query(`
      INSERT INTO "origenes_medicion" ("codigo","nombre","descripcion") VALUES
        ('sistema','Registrada por el sistema','Sellada por el servidor mientras ocurria. Es la evidencia directa del prototipo.'),
        ('transcrita','Transcrita del registro manual','Tecleada por el administrador desde la ficha en papel de la clinica. Es testimonio, no medicion directa, y por eso se distingue.'),
        ('importada','Importada por planilla','Cargada en lote desde un CSV del registro manual.')`);
    await queryRunner.query(
      `COMMENT ON TABLE "origenes_medicion" IS 'CATALOGO. Como llego una medicion al sistema. Separa la evidencia que el prototipo produjo de la que alguien transcribio, que es una distincion que el jurado va a pedir.'`,
    );

    for (const tabla of ['cronometrajes_revision', 'diagnosticos', 'jornadas_trabajo']) {
      await queryRunner.query(
        `ALTER TABLE "${tabla}" ADD COLUMN "origen_codigo" varchar(20) NOT NULL DEFAULT 'sistema'`,
      );
      await queryRunner.query(
        `ALTER TABLE "${tabla}" ADD CONSTRAINT "FK_${tabla}_origen" FOREIGN KEY ("origen_codigo") REFERENCES "origenes_medicion"("codigo") ON DELETE RESTRICT`,
      );
      await queryRunner.query(`CREATE INDEX "IDX_${tabla}_origen" ON "${tabla}" ("origen_codigo")`);
    }

    // Las filas de pretest que ya existían se registraron dentro del sistema con el montaje
    // anterior. Se marcan como tales y no como transcritas: decir lo contrario falsearía su origen.
    await queryRunner.query(
      `COMMENT ON COLUMN "cronometrajes_revision"."origen_codigo" IS 'Las filas anteriores a esta migracion quedan como "sistema" porque asi se produjeron, con el montaje del interruptor por usuario. Marcarlas como transcritas seria falsear su procedencia.'`,
    );

    // ── Lote de carga, para poder deshacer una importación entera ────────────
    await queryRunner.query(`
      CREATE TABLE "cargas_linea_base" (
        "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "origen_codigo"  varchar(20)  NOT NULL,
        "nombre_archivo" varchar(160),
        "filas_leidas"   integer      NOT NULL DEFAULT 0,
        "filas_aplicadas" integer     NOT NULL DEFAULT 0,
        "detalle"        jsonb,
        "cargado_por"    uuid,
        "cargado_en"     timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT "FK_cargas_origen" FOREIGN KEY ("origen_codigo") REFERENCES "origenes_medicion"("codigo") ON DELETE RESTRICT,
        CONSTRAINT "FK_cargas_usuario" FOREIGN KEY ("cargado_por") REFERENCES "usuarios"("id") ON DELETE SET NULL
      )`);
    await queryRunner.query(
      `COMMENT ON TABLE "cargas_linea_base" IS 'Una fila por carga de mediciones manuales. Guarda cuantas filas traia el archivo y cuantas se aplicaron: una importacion que acepta 27 de 30 sin decirlo es como se cuela un dataset incompleto en un contraste de hipotesis.'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "roles_permisos" WHERE "rol_codigo" = 'tecnico' AND "permiso_codigo" IN ('responder_encuesta','registrar_jornada')`,
    );
    await queryRunner.query(`
      INSERT INTO "roles_permisos" ("rol_codigo","permiso_codigo") VALUES
        ('dermatologo','leer_analisis'),
        ('dermatologo','leer_auditoria')
      ON CONFLICT DO NOTHING`);

    await queryRunner.query(`DROP TABLE IF EXISTS "cargas_linea_base"`);

    for (const tabla of ['cronometrajes_revision', 'diagnosticos', 'jornadas_trabajo']) {
      await queryRunner.query(`DROP INDEX IF EXISTS "IDX_${tabla}_origen"`);
      await queryRunner.query(
        `ALTER TABLE "${tabla}" DROP CONSTRAINT IF EXISTS "FK_${tabla}_origen"`,
      );
      await queryRunner.query(`ALTER TABLE "${tabla}" DROP COLUMN IF EXISTS "origen_codigo"`);
    }
    await queryRunner.query(`DROP TABLE IF EXISTS "origenes_medicion"`);

    await queryRunner.query(`
      INSERT INTO "modos_estudio" ("codigo","nombre","valor_iia","permite_ia","es_experimental","orden")
      VALUES ('produccion','Producción',0,true,false,3)
      ON CONFLICT DO NOTHING`);

    await queryRunner.query(
      `ALTER TABLE "usuarios" ADD COLUMN "modo_estudio_codigo" varchar(20) NOT NULL DEFAULT 'produccion'`,
    );
    await queryRunner.query(
      `ALTER TABLE "usuarios" ADD CONSTRAINT "FK_usuarios_modo_estudio" FOREIGN KEY ("modo_estudio_codigo") REFERENCES "modos_estudio"("codigo") ON DELETE RESTRICT`,
    );
  }
}
