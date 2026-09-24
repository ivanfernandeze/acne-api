import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * El proceso clínico completo: de la admisión a la receta.
 *
 * Hasta aquí el prototipo cubría la MEDICIÓN —tiempo de revisión, precisión, satisfacción,
 * capacidad de atención— y se detenía en el momento en que el especialista firmaba una clase IGA.
 * Eso basta para los cuatro objetivos y no basta para una consulta: el paciente se iba sin
 * diagnóstico redactado, sin código CIE-10 y sin tratamiento.
 *
 * Esta migración trae el proceso que DermAsist ya opera —admisión por el técnico, validación por el
 * médico, receta y envío al paciente— y lo monta sobre el diseño experimental sin romperlo. Tres
 * decisiones sostienen ese encaje:
 *
 * 1. **El diagnóstico redactado vive en `diagnosticos`, no en `casos`.** DermAsist lo guarda en el
 *    caso porque allí un caso se valida UNA vez. Aquí se valida DOS —una en pretest y otra en
 *    postest sobre el mismo caso, que es lo que hace de cada caso su propio control— así que
 *    ponerlo en `casos` haría que la segunda validación pisara a la primera y destruyera el par que
 *    OE1 y OE2 contrastan.
 *
 * 2. **La receta cuelga del diagnóstico que la justifica**, no solo del caso. Una receta emitida en
 *    la revisión postest y otra en la pretest son documentos distintos con fundamentos distintos, y
 *    el registro tiene que poder decir cuál de las dos lecturas la motivó.
 *
 * 3. **Los dos estados nuevos son ramas, no etapas.** `solicitar_fotos` devuelve el caso al
 *    mostrador y `derivar_presencial` lo saca del circuito digital. Ninguno es un paso más del
 *    camino feliz.
 */
export class ProcesoClinicoCompleto1757200000000 implements MigrationInterface {
  name = 'ProcesoClinicoCompleto1757200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Estados nuevos y sus aristas ─────────────────────────────────────────
    await queryRunner.query(`UPDATE "estados_caso" SET "orden" = 6 WHERE "codigo" = 'diagnosticado'`);
    await queryRunner.query(`UPDATE "estados_caso" SET "orden" = 7 WHERE "codigo" = 'cerrado'`);
    await queryRunner.query(`
      INSERT INTO "estados_caso" ("codigo","nombre","orden","es_final") VALUES
        ('solicitar_fotos','Fotos pendientes',4,false),
        ('derivar_presencial','Derivado a presencial',5,true)`);
    await queryRunner.query(
      `COMMENT ON COLUMN "estados_caso"."es_final" IS 'De aqui no sale ninguna transicion. Son dos: "cerrado", el final normal, y "derivar_presencial", donde el caso abandona el circuito digital porque la teleconsulta no alcanza. El segundo NO cuenta como caso revisado para TCAD (OE4): consumio tiempo del profesional pero no produjo un diagnostico comparable.'`,
    );

    await queryRunner.query(`
      INSERT INTO "transiciones_estado_caso" ("estado_origen","estado_destino") VALUES
        ('en_revision','solicitar_fotos'),
        ('en_revision','derivar_presencial'),
        ('procesado_ia','solicitar_fotos'),
        ('procesado_ia','derivar_presencial'),
        ('solicitar_fotos','en_revision'),
        ('diagnosticado','derivar_presencial')`);

    // ── Permisos nuevos y la matriz que los reparte ──────────────────────────
    await queryRunner.query(`
      INSERT INTO "permisos" ("codigo","descripcion") VALUES
        ('prescribir','Emitir la receta que cierra la consulta y firmarla.'),
        ('enviar_receta','Hacer llegar la receta al paciente por WhatsApp, correo o descarga.'),
        ('gestionar_medicamentos','Mantener el vademécum y las indicaciones sugeridas por fármaco.')`);

    // El mostrador ve la sugerencia del modelo: replica el flujo de DermAsist, donde la IA corre al
    // crear el caso y quien lo registra ve el resultado. Es una amenaza a la validez interna
    // DECLARADA en TRACEABILITY.md, no un descuido; el gate del dermatologo en pretest sigue intacto.
    await queryRunner.query(`
      INSERT INTO "roles_permisos" ("rol_codigo","permiso_codigo") VALUES
        ('tecnico','ver_sugerencia_ia'),
        ('tecnico','enviar_receta'),
        ('dermatologo','prescribir'),
        ('dermatologo','enviar_receta'),
        ('dermatologo','gestionar_medicamentos'),
        ('admin','gestionar_medicamentos')`);

    // ── CIE-10 ───────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "cie10" (
        "codigo" varchar(10) PRIMARY KEY,
        "nombre" varchar(160) NOT NULL,
        "orden"  smallint     NOT NULL DEFAULT 0
      )`);
    await queryRunner.query(
      `COMMENT ON TABLE "cie10" IS 'CATALOGO. Subconjunto de la CIE-10 que el prototipo puede emitir. Deliberadamente corto: la seccion 3 lo confina al acne vulgar y sus diferenciales mas frecuentes, y un catalogo de 14 000 codigos volveria el desplegable inservible en consulta.'`,
    );
    await queryRunner.query(`
      INSERT INTO "cie10" ("codigo","nombre","orden") VALUES
        ('L70.0','Acné vulgar',1),
        ('L70.1','Acné conglobata',2),
        ('L70.2','Acné varioliforme',3),
        ('L70.3','Acné tropical',4),
        ('L70.4','Acné infantil',5),
        ('L70.5','Acné excoriado de la mujer joven',6),
        ('L70.8','Otros acnés',7),
        ('L70.9','Acné, no especificado',8),
        ('L71.0','Dermatitis perioral',9),
        ('L71.9','Rosácea, no especificada',10),
        ('L21.9','Dermatitis seborreica, no especificada',11),
        ('L73.9','Trastorno folicular, no especificado',12),
        ('L98.9','Trastorno de la piel, no especificado',13)`);

    // ── Diagnóstico redactado, sobre la medición que lo produjo ──────────────
    await queryRunner.query(`ALTER TABLE "diagnosticos" ADD COLUMN "diagnostico_definitivo" text`);
    await queryRunner.query(`ALTER TABLE "diagnosticos" ADD COLUMN "cie10_codigo" varchar(10)`);
    await queryRunner.query(`ALTER TABLE "diagnosticos" ADD COLUMN "observaciones_paciente" text`);
    await queryRunner.query(`ALTER TABLE "diagnosticos" ADD COLUMN "notas_internas" text`);
    await queryRunner.query(
      `ALTER TABLE "diagnosticos" ADD CONSTRAINT "FK_diagnosticos_cie10" FOREIGN KEY ("cie10_codigo") REFERENCES "cie10"("codigo") ON DELETE RESTRICT`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_diagnosticos_cie10" ON "diagnosticos" ("cie10_codigo")`);
    await queryRunner.query(
      `COMMENT ON COLUMN "diagnosticos"."clase_iga_codigo" IS 'OBLIGATORIA y no sustituible por el diagnostico redactado. TPD (RF-OE2-05) compara esta clase contra casos.clase_iga_referencia, y un texto libre no es comparable con nada. El diagnostico redactado se agrega ENCIMA, para que la ficha sirva como historia clinica sin dejar de ser medible.'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "diagnosticos"."observaciones_paciente" IS 'Lo que se le dice al paciente; viaja impreso en la receta. Distinto de "notas_internas", que el paciente nunca ve.'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "diagnosticos"."notas_internas" IS 'Texto libre SIN cifrar, igual que casos.notas: la UI advierte que no se escriban nombres ni documentos (Ley N. 29733).'`,
    );

    // ── Quién atendió el caso ────────────────────────────────────────────────
    await queryRunner.query(`ALTER TABLE "casos" ADD COLUMN "medico_id" uuid`);
    await queryRunner.query(
      `ALTER TABLE "casos" ADD CONSTRAINT "FK_casos_medico" FOREIGN KEY ("medico_id") REFERENCES "usuarios"("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_casos_medico" ON "casos" ("medico_id")`);
    await queryRunner.query(
      `COMMENT ON COLUMN "casos"."medico_id" IS 'Especialista que TOMO el caso, sellado al abrir la ficha. Distinto de usuario_asignado_id, que es a quien se le repartio: un caso puede repartirse a uno y acabar revisandolo otro, y OE4 imputa la jornada a quien lo trabajo de verdad.'`,
    );
    await queryRunner.query(`ALTER TABLE "casos" ADD COLUMN "motivo_devolucion" text`);
    await queryRunner.query(
      `COMMENT ON COLUMN "casos"."motivo_devolucion" IS 'Por que el especialista devolvio el caso al mostrador o lo derivo a presencial. Se muestra al tecnico en su bandeja: devolver un caso sin decir que falta obliga a adivinar y garantiza una segunda devolucion.'`,
    );

    // ── Contacto del paciente ────────────────────────────────────────────────
    // Sin esto la receta no tiene a dónde ir: `envios_receta` exige un destino, y obligar a
    // teclear el número en cada envío garantiza que tarde o temprano se envíe al equivocado.
    await queryRunner.query(`ALTER TABLE "pacientes" ADD COLUMN "telefono_cifrado" text`);
    await queryRunner.query(`ALTER TABLE "pacientes" ADD COLUMN "correo_cifrado" text`);
    await queryRunner.query(
      `COMMENT ON COLUMN "pacientes"."telefono_cifrado" IS 'Ciphertext AES-256-GCM, igual que el nombre y el documento. Un telefono identifica a una persona tan bien como su nombre (Ley N. 29733), de modo que guardarlo en claro habria abierto por la puerta de atras justo lo que RF-TR-03 cierra por la principal. Solo lo descifran los roles con ver_identidad_paciente y cada lectura queda en la traza.'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "pacientes"."correo_cifrado" IS 'Ciphertext AES-256-GCM. Canal alterno cuando el paciente no usa WhatsApp.'`,
    );

    // ── Catálogo de medicamentos ─────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "medicamentos" (
        "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "nombre"           varchar(160) NOT NULL,
        "principio_activo" varchar(160),
        "descripcion"      text,
        "activo"           boolean      NOT NULL DEFAULT true,
        "creado_en"        timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_medicamentos_nombre" UNIQUE ("nombre")
      )`);
    await queryRunner.query(`CREATE INDEX "IDX_medicamentos_activo" ON "medicamentos" ("activo")`);
    await queryRunner.query(
      `COMMENT ON TABLE "medicamentos" IS 'CATALOGO. Vademecum del que el especialista arma la receta. "activo" es una lapida: un medicamento retirado deja de ofrecerse pero las recetas que ya lo citan siguen siendo legibles.'`,
    );

    await queryRunner.query(`
      CREATE TABLE "indicaciones_medicamento" (
        "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "medicamento_id"      uuid         NOT NULL,
        "indicacion"          varchar(200) NOT NULL,
        "dosis_sugerida"      varchar(120),
        "frecuencia_sugerida" varchar(120),
        "duracion_sugerida"   varchar(120),
        "orden"               smallint     NOT NULL DEFAULT 0,
        CONSTRAINT "FK_indicaciones_medicamento" FOREIGN KEY ("medicamento_id") REFERENCES "medicamentos"("id") ON DELETE CASCADE,
        CONSTRAINT "UQ_indicaciones_medicamento" UNIQUE ("medicamento_id","indicacion")
      )`);
    await queryRunner.query(
      `CREATE INDEX "IDX_indicaciones_medicamento" ON "indicaciones_medicamento" ("medicamento_id")`,
    );
    await queryRunner.query(
      `COMMENT ON TABLE "indicaciones_medicamento" IS 'DEBIL de medicamentos. Un mismo farmaco se pauta distinto segun para que se use, de modo que la dosis sugerida cuelga de la INDICACION y no del medicamento: la isotretinoina no se dosifica igual en un acne moderado que en uno conglobata.'`,
    );

    // ── Recetas ──────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "estados_receta" (
        "codigo"   varchar(20) PRIMARY KEY,
        "nombre"   varchar(40) NOT NULL,
        "orden"    smallint    NOT NULL,
        "es_final" boolean     NOT NULL DEFAULT false
      )`);
    await queryRunner.query(`
      INSERT INTO "estados_receta" ("codigo","nombre","orden","es_final") VALUES
        ('generada','Generada',1,false),
        ('enviada','Enviada al paciente',2,false),
        ('anulada','Anulada',3,true)`);
    await queryRunner.query(
      `COMMENT ON TABLE "estados_receta" IS 'CATALOGO. Ciclo de vida de una receta. "anulada" es la unica salida: una receta emitida NUNCA se borra ni se edita, se anula y se emite otra, porque el paciente ya se llevo la primera.'`,
    );

    await queryRunner.query(`
      CREATE TABLE "recetas" (
        "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "codigo_receta"  varchar(32)  NOT NULL,
        "caso_id"        uuid         NOT NULL,
        "diagnostico_id" uuid,
        "paciente_id"    uuid         NOT NULL,
        "medico_id"      uuid         NOT NULL,
        "indicaciones"   text,
        "estado_codigo"  varchar(20)  NOT NULL DEFAULT 'generada',
        "ruta_pdf"       varchar(255),
        "firma_digital"  varchar(128),
        "firmado_en"     timestamptz,
        "es_sintetico"   boolean      NOT NULL DEFAULT false,
        "creado_en"      timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_recetas_codigo" UNIQUE ("codigo_receta"),
        CONSTRAINT "FK_recetas_caso" FOREIGN KEY ("caso_id") REFERENCES "casos"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_recetas_diagnostico" FOREIGN KEY ("diagnostico_id") REFERENCES "diagnosticos"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_recetas_paciente" FOREIGN KEY ("paciente_id") REFERENCES "pacientes"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_recetas_medico" FOREIGN KEY ("medico_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_recetas_estado" FOREIGN KEY ("estado_codigo") REFERENCES "estados_receta"("codigo") ON DELETE RESTRICT
      )`);
    await queryRunner.query(`CREATE INDEX "IDX_recetas_caso" ON "recetas" ("caso_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_recetas_paciente" ON "recetas" ("paciente_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_recetas_estado" ON "recetas" ("estado_codigo")`);
    await queryRunner.query(`CREATE INDEX "IDX_recetas_sintetico" ON "recetas" ("es_sintetico")`);
    await queryRunner.query(
      `COMMENT ON TABLE "recetas" IS 'FUERTE. La prescripcion que cierra la consulta. Cuelga del DIAGNOSTICO que la justifica y no solo del caso: una receta emitida en la revision postest y otra en la pretest son documentos distintos con fundamentos distintos.'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "recetas"."firma_digital" IS 'SHA-256 sobre el contenido de la receta mas el identificador del medico. NO es una firma electronica reconocida legalmente: sirve para detectar que un PDF descargado no coincide con lo registrado, y asi se declara en TRACEABILITY.md.'`,
    );

    await queryRunner.query(`
      CREATE TABLE "items_receta" (
        "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "receta_id"      uuid         NOT NULL,
        "medicamento_id" uuid,
        "nombre"         varchar(160) NOT NULL,
        "dosis"          varchar(120) NOT NULL,
        "frecuencia"     varchar(120) NOT NULL,
        "duracion"       varchar(120) NOT NULL,
        "cantidad"       smallint     NOT NULL DEFAULT 1,
        "indicacion"     varchar(200),
        "orden"          smallint     NOT NULL DEFAULT 0,
        CONSTRAINT "FK_items_receta" FOREIGN KEY ("receta_id") REFERENCES "recetas"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_items_medicamento" FOREIGN KEY ("medicamento_id") REFERENCES "medicamentos"("id") ON DELETE SET NULL,
        CONSTRAINT "CHK_items_receta_cantidad" CHECK ("cantidad" > 0)
      )`);
    await queryRunner.query(`CREATE INDEX "IDX_items_receta" ON "items_receta" ("receta_id")`);
    await queryRunner.query(
      `COMMENT ON TABLE "items_receta" IS 'DEBIL de recetas. Un renglon del tratamiento. El "nombre" se COPIA del catalogo en vez de leerse por la clave foranea: una receta es un documento emitido en una fecha, y renombrar el medicamento en el catalogo no puede reescribir lo que el paciente ya se llevo impreso.'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "items_receta"."medicamento_id" IS 'Trazabilidad al catalogo, no la fuente del texto. Queda NULL si el medicamento se retira, y el renglon sigue siendo legible.'`,
    );

    // ── Envíos al paciente ───────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "canales_envio" (
        "codigo" varchar(20) PRIMARY KEY,
        "nombre" varchar(40) NOT NULL,
        "orden"  smallint    NOT NULL
      )`);
    await queryRunner.query(`
      INSERT INTO "canales_envio" ("codigo","nombre","orden") VALUES
        ('whatsapp','WhatsApp',1),
        ('correo','Correo electrónico',2),
        ('descarga','Descarga directa',3)`);
    await queryRunner.query(
      `COMMENT ON TABLE "canales_envio" IS 'CATALOGO. Por donde se le hace llegar la receta al paciente.'`,
    );

    await queryRunner.query(`
      CREATE TABLE "envios_receta" (
        "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "receta_id"    uuid         NOT NULL,
        "canal_codigo" varchar(20)  NOT NULL,
        "destino"      varchar(120) NOT NULL,
        "simulado"     boolean      NOT NULL DEFAULT true,
        "exitoso"      boolean      NOT NULL DEFAULT true,
        "detalle"      text,
        "enviado_por"  uuid,
        "enviado_en"   timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT "FK_envios_receta" FOREIGN KEY ("receta_id") REFERENCES "recetas"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_envios_canal" FOREIGN KEY ("canal_codigo") REFERENCES "canales_envio"("codigo") ON DELETE RESTRICT,
        CONSTRAINT "FK_envios_usuario" FOREIGN KEY ("enviado_por") REFERENCES "usuarios"("id") ON DELETE SET NULL
      )`);
    await queryRunner.query(`CREATE INDEX "IDX_envios_receta" ON "envios_receta" ("receta_id")`);
    await queryRunner.query(
      `COMMENT ON TABLE "envios_receta" IS 'Bitacora append-only de cada entrega de una receta al paciente. "simulado" en true es el estado normal del prototipo: no hay pasarela de WhatsApp contratada, el envio se registra y se muestra, y llamar a eso un envio real seria mentir en la evidencia.'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "envios_receta"."destino" IS 'Telefono o correo al que se envio. Es un dato identificador del paciente, de modo que solo lo ven los roles con ver_identidad_paciente y cada lectura queda en la traza (RF-TR-03).'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "envios_receta"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "canales_envio"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "items_receta"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "recetas"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "estados_receta"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "indicaciones_medicamento"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "medicamentos"`);

    await queryRunner.query(`ALTER TABLE "pacientes" DROP COLUMN IF EXISTS "correo_cifrado"`);
    await queryRunner.query(`ALTER TABLE "pacientes" DROP COLUMN IF EXISTS "telefono_cifrado"`);
    await queryRunner.query(`ALTER TABLE "casos" DROP COLUMN IF EXISTS "motivo_devolucion"`);
    await queryRunner.query(`ALTER TABLE "casos" DROP CONSTRAINT IF EXISTS "FK_casos_medico"`);
    await queryRunner.query(`ALTER TABLE "casos" DROP COLUMN IF EXISTS "medico_id"`);

    await queryRunner.query(
      `ALTER TABLE "diagnosticos" DROP CONSTRAINT IF EXISTS "FK_diagnosticos_cie10"`,
    );
    for (const column of [
      'diagnostico_definitivo',
      'cie10_codigo',
      'observaciones_paciente',
      'notas_internas',
    ]) {
      await queryRunner.query(`ALTER TABLE "diagnosticos" DROP COLUMN IF EXISTS "${column}"`);
    }
    await queryRunner.query(`DROP TABLE IF EXISTS "cie10"`);

    await queryRunner.query(
      `DELETE FROM "roles_permisos" WHERE "permiso_codigo" IN ('prescribir','enviar_receta','gestionar_medicamentos') OR ("rol_codigo" = 'tecnico' AND "permiso_codigo" = 'ver_sugerencia_ia')`,
    );
    await queryRunner.query(
      `DELETE FROM "permisos" WHERE "codigo" IN ('prescribir','enviar_receta','gestionar_medicamentos')`,
    );

    // Los casos que quedaron en una rama nueva vuelven al tronco antes de borrar los estados, o la
    // clave foránea lo impediría en una base que ya se usó.
    await queryRunner.query(
      `UPDATE "casos" SET "estado_codigo" = 'en_revision' WHERE "estado_codigo" IN ('solicitar_fotos','derivar_presencial')`,
    );
    await queryRunner.query(
      `DELETE FROM "transiciones_estado_caso" WHERE "estado_origen" IN ('solicitar_fotos','derivar_presencial') OR "estado_destino" IN ('solicitar_fotos','derivar_presencial')`,
    );
    await queryRunner.query(
      `DELETE FROM "estados_caso" WHERE "codigo" IN ('solicitar_fotos','derivar_presencial')`,
    );
    await queryRunner.query(`UPDATE "estados_caso" SET "orden" = 4 WHERE "codigo" = 'diagnosticado'`);
    await queryRunner.query(`UPDATE "estados_caso" SET "orden" = 5 WHERE "codigo" = 'cerrado'`);
  }
}
