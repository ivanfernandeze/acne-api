import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Esquema único del prototipo: nombres en español y tercera forma normal.
 *
 * Reemplaza por completo a las tres migraciones anteriores (`InitialSchema`, `AnamnesisAndCapture`,
 * `InferenceAssessment`), que se eliminaron del repositorio. No es una migración incremental: hace
 * `DROP` de todo lo que hubiera y reconstruye la base desde cero, que es lo que la reestructuración
 * del 05/09/2026 pidió explícitamente.
 *
 * QUÉ CAMBIÓ Y POR QUÉ
 *
 * 1. **Idioma.** Tablas, columnas, restricciones y valores de dominio pasan a español. La base de
 *    datos es un entregable de la tesis: se imprime en los anexos y se sustenta ante un jurado que
 *    lee español. Se exceptúan los identificadores que cruzan una frontera ajena y donde traducir
 *    rompería la interoperabilidad sin ganar nada: los nombres de las pruebas de SciPy
 *    (`ttest_rel`, `wilcoxon`), las alternativas de contraste (`two-sided`, `less`, `greater`), los
 *    drivers de almacenamiento (`local`, `minio`) y los backends del modelo (`stub`, `gemini`).
 *
 * 2. **Catálogos en vez de CHECK.** Cada enumeración cerrada es ahora una tabla maestra con clave
 *    primaria propia, y las tablas transaccionales la referencian por clave foránea. Antes un rol o
 *    una clase IGA vivían dentro de un `CHECK ... IN (...)`, de modo que la lista existía dos veces
 *    —en el constraint y en `common/domain/`— y agregar un valor era un `ALTER TABLE`. Ahora es un
 *    `INSERT`, la integridad la garantiza el motor y el catálogo se puede consultar, ordenar y
 *    unir. Esto es lo que convierte al esquema en 3FN: el nombre de la clase IGA depende de su
 *    código, no de la fila del diagnóstico que la usa.
 *
 * 3. **Grupos repetitivos a filas.** Todo lo que era un arreglo o un mapa dentro de un `jsonb` y
 *    tenía forma conocida pasa a tabla hija: el vector de probabilidades de una inferencia, las
 *    observaciones de un indicador, los pares de un contraste, las listas de la lectura clínica y
 *    —la más importante— las 21 respuestas de la anamnesis. Un `jsonb` no se puede unir, ni indexar
 *    por valor, ni restringir: preguntar «cuántos pacientes declararon embarazo» era un scan con
 *    operadores de JSON y ahora es un `JOIN` de dos tablas.
 *
 * 4. **Tres roles.** `residente` y `evaluador_estadistico` desaparecen; sus permisos se absorben en
 *    `dermatologo` y `admin` respectivamente. La autorización deja de ser listas de roles regadas
 *    por el código y pasa a la matriz `roles` × `permisos`.
 *
 * 5. **Consentimiento con integridad referencial.** `consents` guardaba `subject_type` +
 *    `subject_id` sin clave foránea posible: nada impedía un consentimiento apuntando a un uuid
 *    inexistente. Ahora son dos columnas nulables con FK real y un CHECK de exactamente una.
 *
 * Cada tabla declara en un COMMENT el objetivo de la tesis al que sirve y si es fuerte o débil, de
 * modo que la base se documenta a sí misma ante un evaluador externo (RNF-04, RNF-05). El detalle
 * completo está en `acne-infra/docs/02_modelo_datos.md`.
 */
export class EsquemaEspanolNormalizado1757100000000 implements MigrationInterface {
  name = 'EsquemaEspanolNormalizado1757100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.dropEverything(queryRunner);

    // =====================================================================
    // BLOQUE 1 — CATÁLOGOS DE AUTORIZACIÓN
    // =====================================================================

    await queryRunner.query(`
      CREATE TABLE "roles" (
        "codigo"      varchar(24)  PRIMARY KEY,
        "nombre"      varchar(60)  NOT NULL,
        "descripcion" text         NOT NULL,
        "orden"       smallint     NOT NULL,
        CONSTRAINT "UQ_roles_orden" UNIQUE ("orden")
      )`);
    await queryRunner.query(
      `COMMENT ON TABLE "roles" IS 'CATALOGO. Los tres puestos del estudio. Cubre RF-TR-02. Reemplaza al CHECK de cinco valores del esquema anterior: residente se absorbio en dermatologo y evaluador_estadistico en admin.'`,
    );

    await queryRunner.query(`
      CREATE TABLE "permisos" (
        "codigo"      varchar(40) PRIMARY KEY,
        "descripcion" text        NOT NULL
      )`);
    await queryRunner.query(
      `COMMENT ON TABLE "permisos" IS 'CATALOGO. Capacidad atomica del sistema. Un permiso responde una pregunta concreta y nunca nombra un rol, de modo que agregar un puesto no obliga a revisar las reglas una por una.'`,
    );

    await queryRunner.query(`
      CREATE TABLE "roles_permisos" (
        "rol_codigo"     varchar(24) NOT NULL,
        "permiso_codigo" varchar(40) NOT NULL,
        CONSTRAINT "PK_roles_permisos" PRIMARY KEY ("rol_codigo","permiso_codigo"),
        CONSTRAINT "FK_roles_permisos_rol" FOREIGN KEY ("rol_codigo") REFERENCES "roles"("codigo") ON DELETE CASCADE,
        CONSTRAINT "FK_roles_permisos_permiso" FOREIGN KEY ("permiso_codigo") REFERENCES "permisos"("codigo") ON DELETE CASCADE
      )`);
    await queryRunner.query(
      `COMMENT ON TABLE "roles_permisos" IS 'ASOCIATIVA (N:M). La matriz de autorizacion completa. Es la misma que ROLE_PERMISSIONS en common/domain/roles.ts: lo que el codigo autoriza y lo que la base declara son una sola tabla, no dos copias que se separan.'`,
    );

    // =====================================================================
    // BLOQUE 2 — CATÁLOGOS DEL DISEÑO EXPERIMENTAL
    // =====================================================================

    await queryRunner.query(`
      CREATE TABLE "modos_estudio" (
        "codigo"          varchar(20) PRIMARY KEY,
        "nombre"          varchar(40) NOT NULL,
        "valor_iia"       smallint    NOT NULL,
        "permite_ia"      boolean     NOT NULL,
        "es_experimental" boolean     NOT NULL,
        "orden"           smallint    NOT NULL,
        CONSTRAINT "CHK_modos_estudio_iia" CHECK ("valor_iia" IN (0,1))
      )`);
    await queryRunner.query(
      `COMMENT ON TABLE "modos_estudio" IS 'CATALOGO. La variable independiente (RF-TR-01) operacionalizada. valor_iia es IIA en la notacion de la tesis; permite_ia es la regla que StudyModeGuard hace cumplir; es_experimental marca los dos modos que aportan mediciones pareadas al contraste.'`,
    );

    await queryRunner.query(`
      CREATE TABLE "estados_caso" (
        "codigo"   varchar(20) PRIMARY KEY,
        "nombre"   varchar(40) NOT NULL,
        "orden"    smallint    NOT NULL,
        "es_final" boolean     NOT NULL DEFAULT false
      )`);
    await queryRunner.query(
      `COMMENT ON TABLE "estados_caso" IS 'CATALOGO. Ciclo de vida de un caso clinico (seccion 9.2 de requisitos.md).'`,
    );

    await queryRunner.query(`
      CREATE TABLE "transiciones_estado_caso" (
        "estado_origen"  varchar(20) NOT NULL,
        "estado_destino" varchar(20) NOT NULL,
        CONSTRAINT "PK_transiciones_estado_caso" PRIMARY KEY ("estado_origen","estado_destino"),
        CONSTRAINT "FK_transiciones_origen" FOREIGN KEY ("estado_origen") REFERENCES "estados_caso"("codigo") ON DELETE CASCADE,
        CONSTRAINT "FK_transiciones_destino" FOREIGN KEY ("estado_destino") REFERENCES "estados_caso"("codigo") ON DELETE CASCADE,
        CONSTRAINT "CHK_transiciones_no_reflexiva" CHECK ("estado_origen" <> "estado_destino")
      )`);
    await queryRunner.query(
      `COMMENT ON TABLE "transiciones_estado_caso" IS 'ASOCIATIVA. Una fila por arista de la maquina de estados. Se hace cumplir en el servidor para que las mediciones de tiempo de OE1 no se corrompan con actualizaciones fuera de orden; tenerla aqui permite auditar el grafo sin leer el codigo.'`,
    );

    await queryRunner.query(`
      CREATE TABLE "estados_proceso" (
        "codigo" varchar(20) PRIMARY KEY,
        "nombre" varchar(40) NOT NULL,
        "orden"  smallint    NOT NULL
      )`);
    await queryRunner.query(
      `COMMENT ON TABLE "estados_proceso" IS 'CATALOGO. Estado de un proceso asincrono, compartido por el trabajo encolado y por la inferencia que produce. Antes eran dos listas identicas mantenidas a mano en sitios distintos.'`,
    );

    await queryRunner.query(`
      CREATE TABLE "turnos" (
        "codigo" varchar(16) PRIMARY KEY,
        "nombre" varchar(24) NOT NULL,
        "orden"  smallint    NOT NULL
      )`);
    await queryRunner.query(
      `COMMENT ON TABLE "turnos" IS 'CATALOGO. Turno de trabajo, registrado por jornada para el TCAD (Anexo 7, OE4).'`,
    );

    // =====================================================================
    // BLOQUE 3 — CATÁLOGOS CLÍNICOS
    // =====================================================================

    await queryRunner.query(`
      CREATE TABLE "clases_iga" (
        "codigo"         varchar(24) PRIMARY KEY,
        "nombre"         varchar(40) NOT NULL,
        "orden_ordinal"  smallint    NOT NULL,
        CONSTRAINT "UQ_clases_iga_ordinal" UNIQUE ("orden_ordinal"),
        CONSTRAINT "CHK_clases_iga_ordinal" CHECK ("orden_ordinal" BETWEEN 0 AND 4)
      )`);
    await queryRunner.query(
      `COMMENT ON TABLE "clases_iga" IS 'CATALOGO. Escala IGA de severidad del acne: el espacio de etiquetas de todo diagnostico y toda prediccion (OE2, RF-OE2-01). orden_ordinal es lo que hace medible la distancia entre clases al analizar los errores del modelo, porque IGA es una escala ordinal y no nominal.'`,
    );

    await queryRunner.query(`
      CREATE TABLE "grados_gags" (
        "codigo"       varchar(24) PRIMARY KEY,
        "nombre"       varchar(40) NOT NULL,
        "puntaje_min"  smallint    NOT NULL,
        "puntaje_max"  smallint    NOT NULL,
        "orden"        smallint    NOT NULL,
        CONSTRAINT "UQ_grados_gags_orden" UNIQUE ("orden"),
        CONSTRAINT "CHK_grados_gags_rango" CHECK ("puntaje_min" >= 0 AND "puntaje_max" <= 44 AND "puntaje_min" <= "puntaje_max")
      )`);
    await queryRunner.query(
      `COMMENT ON TABLE "grados_gags" IS 'CATALOGO. Escala GAGS secundaria (RF-OE2-04). Los cortes de puntaje (Vasam, 2023) viven en columnas y no solo en la funcion gagsGradeFromScore: la banda de un puntaje se puede verificar en SQL sin reimplementar la regla.'`,
    );

    await queryRunner.query(`
      CREATE TABLE "sexos" (
        "codigo" varchar(16) PRIMARY KEY,
        "nombre" varchar(24) NOT NULL,
        "orden"  smallint    NOT NULL
      )`);
    await queryRunner.query(`COMMENT ON TABLE "sexos" IS 'CATALOGO. Sexo declarado del paciente.'`);

    await queryRunner.query(`
      CREATE TABLE "fototipos_fitzpatrick" (
        "codigo"      varchar(4)  PRIMARY KEY,
        "descripcion" varchar(120) NOT NULL,
        "orden"       smallint     NOT NULL
      )`);
    await queryRunner.query(
      `COMMENT ON TABLE "fototipos_fitzpatrick" IS 'CATALOGO. Fototipo Fitzpatrick I-VI. Se registra para la auditoria de equidad de la seccion 8.2: sin esta columna no se puede demostrar que el modelo no rinde peor en pieles oscuras.'`,
    );

    await queryRunner.query(`
      CREATE TABLE "tomas_fotograficas" (
        "codigo"      varchar(24)  PRIMARY KEY,
        "nombre"      varchar(40)  NOT NULL,
        "instruccion" text         NOT NULL,
        "obligatoria" boolean      NOT NULL DEFAULT false,
        "orden"       smallint     NOT NULL,
        CONSTRAINT "UQ_tomas_orden" UNIQUE ("orden")
      )`);
    await queryRunner.query(
      `COMMENT ON TABLE "tomas_fotograficas" IS 'CATALOGO. Protocolo fotografico. La instruccion que se muestra en el telefono vive aqui una sola vez y llega a la PWA por GET /meta/catalogs, de modo que el texto que lee el paciente no puede divergir del que valida el servidor.'`,
    );

    // =====================================================================
    // BLOQUE 4 — CATÁLOGOS DE LOS INSTRUMENTOS DE MEDICIÓN
    // =====================================================================

    await queryRunner.query(`
      CREATE TABLE "indicadores" (
        "codigo"      varchar(8)   PRIMARY KEY,
        "nombre"      varchar(80)  NOT NULL,
        "objetivo"    varchar(8)   NOT NULL,
        "formula"     varchar(80)  NOT NULL,
        "unidad"      varchar(16)  NOT NULL,
        "instrumento" varchar(120) NOT NULL,
        "direccion"   varchar(8)   NOT NULL,
        "meta"        varchar(120) NOT NULL,
        CONSTRAINT "CHK_indicadores_direccion" CHECK ("direccion" IN ('menor','mayor'))
      )`);
    await queryRunner.query(
      `COMMENT ON TABLE "indicadores" IS 'CATALOGO. Los cuatro indicadores de la variable dependiente (OE1-OE4, seccion 1.3). direccion dice si un valor menor es mejor (TRM) o peor (el resto), que es lo que permite evaluar la meta sin cablear el sentido de cada indicador en el codigo del portal.'`,
    );

    await queryRunner.query(`
      CREATE TABLE "hipotesis" (
        "codigo"            varchar(8)  PRIMARY KEY,
        "indicador_codigo"  varchar(8)  NOT NULL,
        "enunciado_alterna" text        NOT NULL,
        "enunciado_nula"    text        NOT NULL,
        "diseno"            varchar(16) NOT NULL,
        "alternativa"       varchar(16) NOT NULL,
        CONSTRAINT "FK_hipotesis_indicador" FOREIGN KEY ("indicador_codigo") REFERENCES "indicadores"("codigo") ON DELETE RESTRICT,
        CONSTRAINT "UQ_hipotesis_indicador" UNIQUE ("indicador_codigo"),
        CONSTRAINT "CHK_hipotesis_diseno" CHECK ("diseno" IN ('paired','one_sample')),
        CONSTRAINT "CHK_hipotesis_alternativa" CHECK ("alternativa" IN ('two-sided','less','greater'))
      )`);
    await queryRunner.query(
      `COMMENT ON TABLE "hipotesis" IS 'CATALOGO. HE1-HE4 con sus enunciados verbatim, el indicador que contrastan y la direccion esperada. diseno y alternativa conservan la nomenclatura de SciPy a proposito: son los argumentos exactos con que se invoca la prueba, y traducirlos obligaria a un diccionario de ida y vuelta que solo puede equivocarse.'`,
    );

    await queryRunner.query(`
      CREATE TABLE "escala_likert" (
        "puntaje"  smallint    PRIMARY KEY,
        "etiqueta" varchar(24) NOT NULL,
        CONSTRAINT "CHK_escala_likert_rango" CHECK ("puntaje" BETWEEN 1 AND 5)
      )`);
    await queryRunner.query(
      `COMMENT ON TABLE "escala_likert" IS 'CATALOGO. Los cinco puntos de la escala del Anexo 6 con su etiqueta verbal.'`,
    );

    await queryRunner.query(`
      CREATE TABLE "items_encuesta" (
        "numero"    smallint     PRIMARY KEY,
        "enunciado" text         NOT NULL,
        "version"   varchar(16)  NOT NULL,
        CONSTRAINT "CHK_items_encuesta_numero" CHECK ("numero" BETWEEN 1 AND 8)
      )`);
    await queryRunner.query(
      `COMMENT ON TABLE "items_encuesta" IS 'CATALOGO. Los 8 items Likert del Anexo 6, con la redaccion VERBATIM del instrumento validado. En el esquema anterior el enunciado no estaba en la base: vivia solo en el codigo, de modo que una exportacion del dataset no era autoexplicativa y una reformulacion del item no dejaba rastro. version permite saber contra que redaccion se respondio.'`,
    );

    // =====================================================================
    // BLOQUE 5 — CATÁLOGO DE LA ANAMNESIS
    // =====================================================================

    await queryRunner.query(`
      CREATE TABLE "secciones_anamnesis" (
        "codigo" varchar(20) PRIMARY KEY,
        "nombre" varchar(60) NOT NULL,
        "orden"  smallint    NOT NULL
      )`);
    await queryRunner.query(
      `COMMENT ON TABLE "secciones_anamnesis" IS 'CATALOGO. Bloques del cuestionario de ingreso: contexto, lesion, acne, hormonal.'`,
    );

    await queryRunner.query(`
      CREATE TABLE "tipos_pregunta" (
        "codigo" varchar(20) PRIMARY KEY,
        "nombre" varchar(40) NOT NULL
      )`);
    await queryRunner.query(
      `COMMENT ON TABLE "tipos_pregunta" IS 'CATALOGO. Tipo de dato de una respuesta. Determina en cual columna de respuestas_anamnesis se guarda el valor, regla que el CHECK de esa tabla hace cumplir.'`,
    );

    await queryRunner.query(`
      CREATE TABLE "ambitos_anamnesis" (
        "codigo"      varchar(20) PRIMARY KEY,
        "descripcion" varchar(120) NOT NULL
      )`);
    await queryRunner.query(
      `COMMENT ON TABLE "ambitos_anamnesis" IS 'CATALOGO. A quien aplica una pregunta. mujer_adulta refleja el Modulo B del asesor: el bloque hormonal solo tiene sentido en mujeres en edad reproductiva, y preguntarselo a un varon de 14 anos seria ruido en el registro.'`,
    );

    await queryRunner.query(`
      CREATE TABLE "preguntas_anamnesis" (
        "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "clave"           varchar(40)  NOT NULL,
        "numero"          smallint     NOT NULL,
        "seccion_codigo"  varchar(20)  NOT NULL,
        "enunciado"       text         NOT NULL,
        "tipo_codigo"     varchar(20)  NOT NULL,
        "ambito_codigo"   varchar(20)  NOT NULL,
        "unidad"          varchar(16),
        "obligatoria"     boolean      NOT NULL DEFAULT false,
        "prompt_detalle"  varchar(160),
        "ayuda"           text,
        "version"         varchar(16)  NOT NULL,
        "activa"          boolean      NOT NULL DEFAULT true,
        CONSTRAINT "UQ_preguntas_clave" UNIQUE ("clave"),
        CONSTRAINT "UQ_preguntas_numero" UNIQUE ("numero"),
        CONSTRAINT "FK_preguntas_seccion" FOREIGN KEY ("seccion_codigo") REFERENCES "secciones_anamnesis"("codigo") ON DELETE RESTRICT,
        CONSTRAINT "FK_preguntas_tipo" FOREIGN KEY ("tipo_codigo") REFERENCES "tipos_pregunta"("codigo") ON DELETE RESTRICT,
        CONSTRAINT "FK_preguntas_ambito" FOREIGN KEY ("ambito_codigo") REFERENCES "ambitos_anamnesis"("codigo") ON DELETE RESTRICT
      )`);
    await queryRunner.query(
      `COMMENT ON TABLE "preguntas_anamnesis" IS 'CATALOGO. Las 21 preguntas del ingreso clinico, recortadas del cuestionario modular de teleconsulta. EXTENSION solicitada por el equipo de investigacion: no corresponde a ningun RF numerado de requisitos.md. Alimenta el juicio de referencia (RF-OE2-01) y el contexto clinico del modelo, que sin embargo gradua la severidad solo desde la imagen.'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "preguntas_anamnesis"."clave" IS 'Clave de almacenamiento estable. NUNCA se renombra: es la referencia bajo la que quedaron archivadas las respuestas ya tomadas.'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "preguntas_anamnesis"."activa" IS 'Una pregunta retirada se desactiva, nunca se borra: sus respuestas historicas siguen en respuestas_anamnesis y la FK debe seguir resolviendo.'`,
    );

    await queryRunner.query(`
      CREATE TABLE "opciones_pregunta" (
        "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "pregunta_id"  uuid         NOT NULL,
        "valor"        varchar(120) NOT NULL,
        "orden"        smallint     NOT NULL,
        CONSTRAINT "UQ_opciones_pregunta_valor" UNIQUE ("pregunta_id","valor"),
        CONSTRAINT "UQ_opciones_pregunta_orden" UNIQUE ("pregunta_id","orden"),
        CONSTRAINT "FK_opciones_pregunta" FOREIGN KEY ("pregunta_id") REFERENCES "preguntas_anamnesis"("id") ON DELETE CASCADE
      )`);
    await queryRunner.query(
      `COMMENT ON TABLE "opciones_pregunta" IS 'DEBIL de preguntas_anamnesis. Las opciones validas de una pregunta de eleccion. Antes eran un arreglo dentro del catalogo en codigo: una respuesta con una opcion invalida solo se detectaba en la capa de aplicacion, y ahora es imposible por clave foranea.'`,
    );

    // =====================================================================
    // BLOQUE 6 — ENTIDADES FUERTES
    // =====================================================================

    await queryRunner.query(`
      CREATE TABLE "usuarios" (
        "id"                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "correo"                varchar(180) NOT NULL,
        "hash_contrasena"       varchar(255) NOT NULL,
        "nombre_completo"       varchar(160) NOT NULL,
        "rol_codigo"            varchar(24)  NOT NULL,
        "modo_estudio_codigo"   varchar(20)  NOT NULL DEFAULT 'produccion',
        "especialidad"          varchar(120),
        "activo"                boolean      NOT NULL DEFAULT true,
        "es_sintetico"          boolean      NOT NULL DEFAULT false,
        "consentimiento_en"     timestamptz,
        "creado_en"             timestamptz  NOT NULL DEFAULT now(),
        "actualizado_en"        timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_usuarios_correo" UNIQUE ("correo"),
        CONSTRAINT "FK_usuarios_rol" FOREIGN KEY ("rol_codigo") REFERENCES "roles"("codigo") ON DELETE RESTRICT,
        CONSTRAINT "FK_usuarios_modo" FOREIGN KEY ("modo_estudio_codigo") REFERENCES "modos_estudio"("codigo") ON DELETE RESTRICT
      )`);
    await queryRunner.query(`CREATE INDEX "IDX_usuarios_rol" ON "usuarios" ("rol_codigo")`);
    await queryRunner.query(
      `COMMENT ON TABLE "usuarios" IS 'FUERTE. Personal del estudio. Cubre RF-TR-02 (JWT + roles) y RF-TR-01 (modo_estudio_codigo es el interruptor por usuario de la variable independiente: un dermatologo en pretest no alcanza la IA en absoluto).'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "usuarios"."modo_estudio_codigo" IS 'RF-TR-01. Persistido por usuario para que la condicion experimental sobreviva a un re-login.'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "usuarios"."es_sintetico" IS 'Profesional creado por seed:study para poblar el censo de demostracion. Los indicadores por profesional y las exportaciones lo excluyen igual que a los casos sinteticos: sin esta marca, un evaluador no podria distinguir una cuenta real de una de relleno, y el conteo de personal del estudio saldria inflado.'`,
    );

    await queryRunner.query(`
      CREATE TABLE "pacientes" (
        "id"                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "codigo_paciente"          varchar(32) NOT NULL,
        "nombre_completo_cifrado"  text,
        "documento_cifrado"        text,
        "fecha_nacimiento"         date,
        "sexo_codigo"              varchar(16),
        "fototipo_codigo"          varchar(4),
        "consentimiento_en"        timestamptz,
        "retirado_en"              timestamptz,
        "creado_por"               uuid,
        "creado_en"                timestamptz NOT NULL DEFAULT now(),
        "actualizado_en"           timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_pacientes_codigo" UNIQUE ("codigo_paciente"),
        CONSTRAINT "FK_pacientes_sexo" FOREIGN KEY ("sexo_codigo") REFERENCES "sexos"("codigo") ON DELETE RESTRICT,
        CONSTRAINT "FK_pacientes_fototipo" FOREIGN KEY ("fototipo_codigo") REFERENCES "fototipos_fitzpatrick"("codigo") ON DELETE RESTRICT,
        CONSTRAINT "FK_pacientes_creado_por" FOREIGN KEY ("creado_por") REFERENCES "usuarios"("id") ON DELETE SET NULL
      )`);
    await queryRunner.query(
      `COMMENT ON TABLE "pacientes" IS 'FUERTE. Paciente anonimizado. Cubre RF-TR-03 (solo circula codigo_paciente; la identidad real es ciphertext AES-256-GCM que solo descifra el personal autorizado) y RNF-07 (consentimiento y derecho a retiro).'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "pacientes"."retirado_en" IS 'RNF-07, derecho a retiro. Un paciente retirado queda excluido de todo dataset del estudio. Se marca, nunca se borra: borrarlo dejaria casos huerfanos y rompería la trazabilidad que RNF-02 exige.'`,
    );

    await queryRunner.query(`
      CREATE TABLE "jornadas_trabajo" (
        "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "usuario_id"          uuid        NOT NULL,
        "modo_estudio_codigo" varchar(20) NOT NULL,
        "turno_codigo"        varchar(16) NOT NULL,
        "iniciada_en"         timestamptz NOT NULL,
        "finalizada_en"       timestamptz,
        "horas_declaradas"    double precision,
        "casos_revisados"     integer     NOT NULL DEFAULT 0,
        "tcad"                double precision,
        "es_sintetico"        boolean     NOT NULL DEFAULT false,
        "notas"               text,
        "creado_en"           timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_jornadas_usuario" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_jornadas_modo" FOREIGN KEY ("modo_estudio_codigo") REFERENCES "modos_estudio"("codigo") ON DELETE RESTRICT,
        CONSTRAINT "FK_jornadas_turno" FOREIGN KEY ("turno_codigo") REFERENCES "turnos"("codigo") ON DELETE RESTRICT,
        CONSTRAINT "CHK_jornadas_tj" CHECK ("horas_declaradas" IS NULL OR "horas_declaradas" > 0),
        CONSTRAINT "CHK_jornadas_ncr" CHECK ("casos_revisados" >= 0),
        CONSTRAINT "CHK_jornadas_orden" CHECK ("finalizada_en" IS NULL OR "finalizada_en" >= "iniciada_en")
      )`);
    await queryRunner.query(`CREATE INDEX "IDX_jornadas_usuario" ON "jornadas_trabajo" ("usuario_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_jornadas_modo" ON "jornadas_trabajo" ("modo_estudio_codigo")`);
    await queryRunner.query(
      `COMMENT ON TABLE "jornadas_trabajo" IS 'FUERTE. Jornada de trabajo, el Anexo 7 digital. Cubre OE4 (RF-OE4-01, RF-OE4-02): TCAD = NCR / TJ, donde NCR lo cuenta el sistema (casos_revisados) y TJ lo declara el profesional al cerrar (horas_declaradas), exactamente como prescribe el instrumento.'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "jornadas_trabajo"."tcad" IS 'Se congela al cerrar la jornada. Persistido y no derivado para que la fila del Anexo 7 sea evidencia inmutable aunque los casos cambien despues.'`,
    );

    await queryRunner.query(`
      CREATE TABLE "casos" (
        "id"                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "codigo_caso"             varchar(32) NOT NULL,
        "paciente_id"             uuid        NOT NULL,
        "usuario_asignado_id"     uuid,
        "modo_estudio_codigo"     varchar(20) NOT NULL,
        "estado_codigo"           varchar(20) NOT NULL DEFAULT 'borrador',
        "clase_iga_referencia"    varchar(24),
        "es_sintetico"            boolean     NOT NULL DEFAULT false,
        "jornada_id"              uuid,
        "notas"                   text,
        "creado_en"               timestamptz NOT NULL DEFAULT now(),
        "actualizado_en"          timestamptz NOT NULL DEFAULT now(),
        "cerrado_en"              timestamptz,
        CONSTRAINT "UQ_casos_codigo" UNIQUE ("codigo_caso"),
        CONSTRAINT "FK_casos_paciente" FOREIGN KEY ("paciente_id") REFERENCES "pacientes"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_casos_usuario" FOREIGN KEY ("usuario_asignado_id") REFERENCES "usuarios"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_casos_modo" FOREIGN KEY ("modo_estudio_codigo") REFERENCES "modos_estudio"("codigo") ON DELETE RESTRICT,
        CONSTRAINT "FK_casos_estado" FOREIGN KEY ("estado_codigo") REFERENCES "estados_caso"("codigo") ON DELETE RESTRICT,
        CONSTRAINT "FK_casos_iga_referencia" FOREIGN KEY ("clase_iga_referencia") REFERENCES "clases_iga"("codigo") ON DELETE RESTRICT,
        CONSTRAINT "FK_casos_jornada" FOREIGN KEY ("jornada_id") REFERENCES "jornadas_trabajo"("id") ON DELETE SET NULL
      )`);
    await queryRunner.query(`CREATE INDEX "IDX_casos_paciente" ON "casos" ("paciente_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_casos_usuario" ON "casos" ("usuario_asignado_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_casos_modo" ON "casos" ("modo_estudio_codigo")`);
    await queryRunner.query(`CREATE INDEX "IDX_casos_estado" ON "casos" ("estado_codigo")`);
    await queryRunner.query(`CREATE INDEX "IDX_casos_sintetico" ON "casos" ("es_sintetico")`);
    await queryRunner.query(`CREATE INDEX "IDX_casos_jornada" ON "casos" ("jornada_id")`);
    await queryRunner.query(
      `COMMENT ON TABLE "casos" IS 'FUERTE. Un caso clinico: un paciente, un juego de imagenes faciales, una revision. Cubre RF-TR-01 y RF-TR-03 (codigo_caso es el identificador anonimizado que circula en todas partes).'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "casos"."clase_iga_referencia" IS 'Patron de referencia comun (gold standard). Es el pivote de RF-OE2-05: el TPD en pretest compara el juicio manual contra esta etiqueta y el TPD en postest compara la prediccion de la IA contra la MISMA etiqueta. Sin una referencia comun las dos condiciones no serian comparables.'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "casos"."modo_estudio_codigo" IS 'RF-TR-01. Condicion en que se REGISTRO el caso: procedencia, no unidad de analisis. El diseno mide los mismos 30 casos dos veces (G: O1 -> X -> O2), de modo que el caso es la UNIDAD DE EMPAREJAMIENTO y no un miembro de un brazo. El modo de una medicion vive en cronometrajes_revision y en diagnosticos.'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "casos"."es_sintetico" IS 'Filas producidas por seed:study. Excluidas por defecto de indicadores, contrastes y exportaciones para que un dato de demostracion no pueda confundirse con evidencia de la tesis.'`,
    );

    // =====================================================================
    // BLOQUE 7 — CONSENTIMIENTO
    // =====================================================================

    await queryRunner.query(`
      CREATE TABLE "consentimientos" (
        "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "paciente_id"  uuid,
        "usuario_id"   uuid,
        "version"      varchar(16) NOT NULL,
        "aceptado"     boolean     NOT NULL DEFAULT true,
        "aceptado_en"  timestamptz NOT NULL,
        "direccion_ip" varchar(64),
        "notas"        text,
        "creado_en"    timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_consentimientos_paciente" FOREIGN KEY ("paciente_id") REFERENCES "pacientes"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_consentimientos_usuario" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_consentimientos_sujeto" CHECK (("paciente_id" IS NOT NULL)::int + ("usuario_id" IS NOT NULL)::int = 1)
      )`);
    await queryRunner.query(`CREATE INDEX "IDX_consentimientos_paciente" ON "consentimientos" ("paciente_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_consentimientos_usuario" ON "consentimientos" ("usuario_id")`);
    await queryRunner.query(
      `COMMENT ON TABLE "consentimientos" IS 'DEBIL de pacientes / usuarios. Consentimiento informado electronico. Cubre RNF-07. Append-only: un retiro es una fila nueva, nunca una edicion, para que la traza sea defendible ante el comite de etica.'`,
    );
    await queryRunner.query(
      `COMMENT ON CONSTRAINT "CHK_consentimientos_sujeto" ON "consentimientos" IS 'Exactamente un sujeto. El esquema anterior usaba subject_type + subject_id sin clave foranea posible: nada impedia un consentimiento apuntando a un uuid inexistente. Dos columnas nulables con FK real y este CHECK dan la misma flexibilidad CON integridad referencial.'`,
    );

    // =====================================================================
    // BLOQUE 8 — INGRESO CLÍNICO: IMÁGENES, CAPTURA Y ANAMNESIS
    // =====================================================================

    await queryRunner.query(`
      CREATE TABLE "imagenes_caso" (
        "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "caso_id"           uuid         NOT NULL,
        "clave_almacen"     varchar(255) NOT NULL,
        "driver_almacen"    varchar(16)  NOT NULL,
        "tipo_mime"         varchar(80)  NOT NULL,
        "ancho"             integer,
        "alto"              integer,
        "tamano_bytes"      bigint       NOT NULL,
        "sha256"            varchar(64)  NOT NULL,
        "cifrada"           boolean      NOT NULL DEFAULT true,
        "es_mapa_calor"     boolean      NOT NULL DEFAULT false,
        "toma_codigo"       varchar(24),
        "subida_por"        uuid,
        "creado_en"         timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT "FK_imagenes_caso" FOREIGN KEY ("caso_id") REFERENCES "casos"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_imagenes_toma" FOREIGN KEY ("toma_codigo") REFERENCES "tomas_fotograficas"("codigo") ON DELETE RESTRICT,
        CONSTRAINT "FK_imagenes_usuario" FOREIGN KEY ("subida_por") REFERENCES "usuarios"("id") ON DELETE SET NULL,
        CONSTRAINT "CHK_imagenes_tamano" CHECK ("tamano_bytes" > 0),
        CONSTRAINT "CHK_imagenes_driver" CHECK ("driver_almacen" IN ('local','minio'))
      )`);
    await queryRunner.query(`CREATE INDEX "IDX_imagenes_caso" ON "imagenes_caso" ("caso_id")`);
    await queryRunner.query(
      `COMMENT ON TABLE "imagenes_caso" IS 'DEBIL de casos. Imagen clinica facial. Cubre RNF-02: los bytes en el almacenamiento son ciphertext AES-256-GCM y sha256 es el digest del PLAINTEXT, de modo que la integridad se puede verificar despues de descifrar.'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "imagenes_caso"."toma_codigo" IS 'Toma del protocolo fotografico. NULL en las imagenes sinteticas del seeder, que no lo siguieron; afirmar lo contrario describiria mal el registro.'`,
    );

    await queryRunner.query(`
      CREATE TABLE "sesiones_captura" (
        "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "caso_id"         uuid        NOT NULL,
        "hash_token"      varchar(64) NOT NULL,
        "creado_por"      uuid        NOT NULL,
        "expira_en"       timestamptz NOT NULL,
        "max_subidas"     integer     NOT NULL DEFAULT 8,
        "subidas"         integer     NOT NULL DEFAULT 0,
        "revocada_en"     timestamptz,
        "ultimo_uso_en"   timestamptz,
        "creado_en"       timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_sesiones_captura_token" UNIQUE ("hash_token"),
        CONSTRAINT "FK_sesiones_captura_caso" FOREIGN KEY ("caso_id") REFERENCES "casos"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_sesiones_captura_usuario" FOREIGN KEY ("creado_por") REFERENCES "usuarios"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_sesiones_captura_max" CHECK ("max_subidas" BETWEEN 1 AND 20),
        CONSTRAINT "CHK_sesiones_captura_cuenta" CHECK ("subidas" >= 0 AND "subidas" <= "max_subidas")
      )`);
    await queryRunner.query(`CREATE INDEX "IDX_sesiones_captura_caso" ON "sesiones_captura" ("caso_id")`);
    await queryRunner.query(
      `COMMENT ON TABLE "sesiones_captura" IS 'DEBIL de casos. Vincula un telefono a un caso durante una ventana corta mediante un QR, que es el mecanismo que la seccion 9.3 de requisitos.md dejo sin especificar al pedir el envio de fotos desde la PWA.'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "sesiones_captura"."hash_token" IS 'SHA-256 del token en claro. El token NUNCA se persiste: quien tenga un volcado de la base no puede reconstruir un enlace de subida funcional.'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "sesiones_captura"."max_subidas" IS 'La ruta de subida es publica, autorizada solo por el token, de modo que el alcance de un enlace filtrado lo acota este tope y no la autenticacion (RNF-02).'`,
    );

    await queryRunner.query(`
      CREATE TABLE "anamnesis_caso" (
        "id"                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "caso_id"               uuid        NOT NULL,
        "version_cuestionario"  varchar(16) NOT NULL,
        "completa"              boolean     NOT NULL DEFAULT false,
        "precargada_de_caso_id" uuid,
        "completada_por"        uuid,
        "creado_en"             timestamptz NOT NULL DEFAULT now(),
        "actualizado_en"        timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_anamnesis_caso" UNIQUE ("caso_id"),
        CONSTRAINT "FK_anamnesis_caso" FOREIGN KEY ("caso_id") REFERENCES "casos"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_anamnesis_origen" FOREIGN KEY ("precargada_de_caso_id") REFERENCES "casos"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_anamnesis_usuario" FOREIGN KEY ("completada_por") REFERENCES "usuarios"("id") ON DELETE SET NULL
      )`);
    await queryRunner.query(
      `COMMENT ON TABLE "anamnesis_caso" IS 'DEBIL de casos (1:1). Cabecera de la historia de acne tomada en el ingreso. Va atada al CASO y no al paciente: un control a las seis semanas tiene sus propios tratamientos y sus propios sintomas, y sobrescribirlos borraria como estaba el paciente en el control anterior.'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "anamnesis_caso"."version_cuestionario" IS 'ANAMNESIS_VERSION del catalogo contra el que se respondio. Sin este dato el registro no es reproducible seis meses despues (RNF-03, RNF-05).'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "anamnesis_caso"."completa" IS 'Informativo. Nunca condiciona la creacion del caso ni la revision: con 21 preguntas por caso, exigirla seria un cuello de botella para alcanzar el censo de 30.'`,
    );

    await queryRunner.query(`
      CREATE TABLE "respuestas_anamnesis" (
        "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "anamnesis_id"   uuid        NOT NULL,
        "pregunta_id"    uuid        NOT NULL,
        "valor_booleano" boolean,
        "valor_texto"    text,
        "valor_numerico" double precision,
        "detalle"        varchar(500),
        "respondida_en"  timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_respuestas_anamnesis" UNIQUE ("anamnesis_id","pregunta_id"),
        CONSTRAINT "FK_respuestas_anamnesis" FOREIGN KEY ("anamnesis_id") REFERENCES "anamnesis_caso"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_respuestas_pregunta" FOREIGN KEY ("pregunta_id") REFERENCES "preguntas_anamnesis"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_respuestas_un_valor" CHECK (
          ("valor_booleano" IS NOT NULL)::int
        + ("valor_texto"    IS NOT NULL)::int
        + ("valor_numerico" IS NOT NULL)::int <= 1
        ),
        CONSTRAINT "CHK_respuestas_numerico" CHECK ("valor_numerico" IS NULL OR ("valor_numerico" >= 0 AND "valor_numerico" <= 500))
      )`);
    await queryRunner.query(
      `CREATE INDEX "IDX_respuestas_anamnesis" ON "respuestas_anamnesis" ("anamnesis_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_respuestas_pregunta" ON "respuestas_anamnesis" ("pregunta_id")`,
    );
    await queryRunner.query(
      `COMMENT ON TABLE "respuestas_anamnesis" IS 'DEBIL de anamnesis_caso. Una fila por pregunta respondida. En el esquema anterior las 21 respuestas eran un jsonb: no se podia unir, ni indexar por valor, ni restringir. Preguntar cuantas pacientes declararon embarazo era un scan con operadores de JSON y ahora es un JOIN de dos tablas.'`,
    );
    await queryRunner.query(
      `COMMENT ON CONSTRAINT "CHK_respuestas_un_valor" ON "respuestas_anamnesis" IS 'A lo sumo una columna de valor. Cero es legitimo: una respuesta en blanco es clinicamente distinta de un no, y las de eleccion guardan su valor en respuestas_anamnesis_opcion.'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "respuestas_anamnesis"."detalle" IS 'Texto libre de seguimiento, SIN cifrar igual que casos.notas. La UI advierte que no se escriban nombres ni documentos (Ley N. 29733).'`,
    );

    await queryRunner.query(`
      CREATE TABLE "respuestas_anamnesis_opcion" (
        "respuesta_id" uuid NOT NULL,
        "opcion_id"    uuid NOT NULL,
        CONSTRAINT "PK_respuestas_opcion" PRIMARY KEY ("respuesta_id","opcion_id"),
        CONSTRAINT "FK_respuestas_opcion_respuesta" FOREIGN KEY ("respuesta_id") REFERENCES "respuestas_anamnesis"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_respuestas_opcion_opcion" FOREIGN KEY ("opcion_id") REFERENCES "opciones_pregunta"("id") ON DELETE RESTRICT
      )`);
    await queryRunner.query(
      `COMMENT ON TABLE "respuestas_anamnesis_opcion" IS 'ASOCIATIVA (N:M). Las opciones marcadas en una respuesta de eleccion: una fila para opcion_unica, varias para opcion_multiple. La FK contra opciones_pregunta hace estructuralmente imposible almacenar una opcion que la pregunta no ofrece.'`,
    );

    // =====================================================================
    // BLOQUE 9 — INFERENCIA DEL MODELO
    // =====================================================================

    await queryRunner.query(`
      CREATE TABLE "trabajos_inferencia" (
        "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "caso_id"        uuid        NOT NULL,
        "imagen_id"      uuid        NOT NULL,
        "solicitado_por" uuid        NOT NULL,
        "estado_codigo"  varchar(20) NOT NULL DEFAULT 'pendiente',
        "intentos"       integer     NOT NULL DEFAULT 0,
        "max_intentos"   integer     NOT NULL DEFAULT 3,
        "bloqueado_en"   timestamptz,
        "inferencia_id"  uuid,
        "ultimo_error"   text,
        "creado_en"      timestamptz NOT NULL DEFAULT now(),
        "actualizado_en" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_trabajos_caso" FOREIGN KEY ("caso_id") REFERENCES "casos"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_trabajos_imagen" FOREIGN KEY ("imagen_id") REFERENCES "imagenes_caso"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_trabajos_usuario" FOREIGN KEY ("solicitado_por") REFERENCES "usuarios"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_trabajos_estado" FOREIGN KEY ("estado_codigo") REFERENCES "estados_proceso"("codigo") ON DELETE RESTRICT,
        CONSTRAINT "CHK_trabajos_intentos" CHECK ("intentos" >= 0 AND "intentos" <= "max_intentos")
      )`);
    await queryRunner.query(`CREATE INDEX "IDX_trabajos_estado" ON "trabajos_inferencia" ("estado_codigo")`);
    await queryRunner.query(`CREATE INDEX "IDX_trabajos_caso" ON "trabajos_inferencia" ("caso_id")`);
    await queryRunner.query(
      `COMMENT ON TABLE "trabajos_inferencia" IS 'DEBIL de casos. Cola de inferencia respaldada por PostgreSQL. La pila obligatoria pide BullMQ sobre Redis; sin Redis aprovisionado el QueueProvider por defecto guarda los trabajos aqui. Declarado en TRACEABILITY.md seccion 4.'`,
    );

    await queryRunner.query(`
      CREATE TABLE "inferencias_ia" (
        "id"                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "caso_id"            uuid        NOT NULL,
        "imagen_id"          uuid        NOT NULL,
        "estado_codigo"      varchar(20) NOT NULL DEFAULT 'pendiente',
        "clase_iga_codigo"   varchar(24),
        "confianza"          double precision,
        "grado_gags_codigo"  varchar(24),
        "puntaje_gags"       smallint,
        "imagen_mapa_calor"  uuid,
        "latencia_ms"        integer,
        "version_modelo"     varchar(80) NOT NULL,
        "backend_modelo"     varchar(16) NOT NULL DEFAULT 'stub',
        "checksum_pesos"     varchar(64),
        "semilla"            integer     NOT NULL DEFAULT 42,
        "mensaje_error"      text,
        "creado_en"          timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_inferencias_caso" FOREIGN KEY ("caso_id") REFERENCES "casos"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_inferencias_imagen" FOREIGN KEY ("imagen_id") REFERENCES "imagenes_caso"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_inferencias_mapa" FOREIGN KEY ("imagen_mapa_calor") REFERENCES "imagenes_caso"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_inferencias_estado" FOREIGN KEY ("estado_codigo") REFERENCES "estados_proceso"("codigo") ON DELETE RESTRICT,
        CONSTRAINT "FK_inferencias_iga" FOREIGN KEY ("clase_iga_codigo") REFERENCES "clases_iga"("codigo") ON DELETE RESTRICT,
        CONSTRAINT "FK_inferencias_gags" FOREIGN KEY ("grado_gags_codigo") REFERENCES "grados_gags"("codigo") ON DELETE RESTRICT,
        CONSTRAINT "CHK_inferencias_confianza" CHECK ("confianza" IS NULL OR ("confianza" >= 0 AND "confianza" <= 1)),
        CONSTRAINT "CHK_inferencias_gags" CHECK ("puntaje_gags" IS NULL OR ("puntaje_gags" BETWEEN 0 AND 44)),
        CONSTRAINT "CHK_inferencias_latencia" CHECK ("latencia_ms" IS NULL OR "latencia_ms" >= 0)
      )`);
    await queryRunner.query(`CREATE INDEX "IDX_inferencias_caso" ON "inferencias_ia" ("caso_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_inferencias_estado" ON "inferencias_ia" ("estado_codigo")`);
    await queryRunner.query(`CREATE INDEX "IDX_inferencias_creada" ON "inferencias_ia" ("creado_en")`);
    await queryRunner.query(
      `COMMENT ON TABLE "inferencias_ia" IS 'DEBIL de casos. Una prediccion del modelo sobre una imagen: el lado IA del Anexo 5 digital. Cubre OE2 (RF-OE2-01) y alimenta el checklist IIA de RF-TR-04. version_modelo, checksum_pesos, semilla y latencia_ms son lo que hace la prediccion reproducible (RNF-03).'`,
    );

    await queryRunner.query(`
      CREATE TABLE "probabilidades_inferencia" (
        "inferencia_id"    uuid             NOT NULL,
        "clase_iga_codigo" varchar(24)      NOT NULL,
        "probabilidad"     double precision NOT NULL,
        CONSTRAINT "PK_probabilidades" PRIMARY KEY ("inferencia_id","clase_iga_codigo"),
        CONSTRAINT "FK_probabilidades_inferencia" FOREIGN KEY ("inferencia_id") REFERENCES "inferencias_ia"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_probabilidades_iga" FOREIGN KEY ("clase_iga_codigo") REFERENCES "clases_iga"("codigo") ON DELETE RESTRICT,
        CONSTRAINT "CHK_probabilidades_rango" CHECK ("probabilidad" >= 0 AND "probabilidad" <= 1)
      )`);
    await queryRunner.query(
      `COMMENT ON TABLE "probabilidades_inferencia" IS 'DEBIL de inferencias_ia. El vector completo de probabilidades sobre las cinco clases IGA, una fila por clase. Era un jsonb con las clases como llaves, lo que repetia el catalogo IGA dentro de cada fila: la matriz de confusion y el analisis de error ordinal ahora salen de un GROUP BY en vez de expandir JSON.'`,
    );

    await queryRunner.query(`
      CREATE TABLE "tipos_detalle_valoracion" (
        "codigo" varchar(24) PRIMARY KEY,
        "nombre" varchar(60) NOT NULL,
        "orden"  smallint    NOT NULL
      )`);
    await queryRunner.query(
      `COMMENT ON TABLE "tipos_detalle_valoracion" IS 'CATALOGO. Las clases de hallazgo que enumera la lectura clinica del modelo: lesiones vistas, zonas afectadas, diagnosticos diferenciales, consideraciones de manejo y banderas de la anamnesis.'`,
    );

    await queryRunner.query(`
      CREATE TABLE "valoraciones_inferencia" (
        "inferencia_id"        uuid PRIMARY KEY,
        "resumen"              text NOT NULL,
        "fundamento_severidad" text NOT NULL,
        CONSTRAINT "FK_valoraciones_inferencia" FOREIGN KEY ("inferencia_id") REFERENCES "inferencias_ia"("id") ON DELETE CASCADE
      )`);
    await queryRunner.query(
      `COMMENT ON TABLE "valoraciones_inferencia" IS 'DEBIL de inferencias_ia (1:1). La lectura razonada que acompana al grado. Existe porque una clase mas un vector de probabilidades dice QUE concluyo el modelo y nada de POR QUE, y una sugerencia que no se puede inspeccionar solo se puede creer o ignorar, que no es juicio clinico. NO es un diagnostico: el del registro es el que firma el especialista en diagnosticos.'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "valoraciones_inferencia"."fundamento_severidad" IS 'Por que esa clase IGA y no la vecina. La escala ordinal se defiende o se cae aqui.'`,
    );

    await queryRunner.query(`
      CREATE TABLE "detalles_valoracion" (
        "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "inferencia_id" uuid        NOT NULL,
        "tipo_codigo"   varchar(24) NOT NULL,
        "orden"         smallint    NOT NULL,
        "texto"         text        NOT NULL,
        CONSTRAINT "UQ_detalles_valoracion" UNIQUE ("inferencia_id","tipo_codigo","orden"),
        CONSTRAINT "FK_detalles_valoracion" FOREIGN KEY ("inferencia_id") REFERENCES "valoraciones_inferencia"("inferencia_id") ON DELETE CASCADE,
        CONSTRAINT "FK_detalles_tipo" FOREIGN KEY ("tipo_codigo") REFERENCES "tipos_detalle_valoracion"("codigo") ON DELETE RESTRICT
      )`);
    await queryRunner.query(
      `COMMENT ON TABLE "detalles_valoracion" IS 'DEBIL de valoraciones_inferencia. Una fila por elemento de las cinco listas de la lectura clinica. Eran cinco arreglos JSON dentro de una columna: contar cuantas veces el modelo menciono rosacea como diferencial exige poder agrupar, y un arreglo no agrupa.'`,
    );

    // =====================================================================
    // BLOQUE 10 — MEDICIÓN: DIAGNÓSTICO Y CRONOMETRAJE
    // =====================================================================

    await queryRunner.query(`
      CREATE TABLE "diagnosticos" (
        "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "caso_id"             uuid        NOT NULL,
        "usuario_id"          uuid        NOT NULL,
        "modo_estudio_codigo" varchar(20) NOT NULL,
        "clase_iga_codigo"    varchar(24) NOT NULL,
        "puntaje_gags"        smallint,
        "acuerdo"             varchar(16),
        "sugerencia_aceptada" boolean,
        "inferencia_id"       uuid,
        "notas"               text,
        "creado_en"           timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_diagnosticos_caso" FOREIGN KEY ("caso_id") REFERENCES "casos"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_diagnosticos_usuario" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_diagnosticos_modo" FOREIGN KEY ("modo_estudio_codigo") REFERENCES "modos_estudio"("codigo") ON DELETE RESTRICT,
        CONSTRAINT "FK_diagnosticos_iga" FOREIGN KEY ("clase_iga_codigo") REFERENCES "clases_iga"("codigo") ON DELETE RESTRICT,
        CONSTRAINT "FK_diagnosticos_inferencia" FOREIGN KEY ("inferencia_id") REFERENCES "inferencias_ia"("id") ON DELETE SET NULL,
        CONSTRAINT "CHK_diagnosticos_acuerdo" CHECK ("acuerdo" IS NULL OR "acuerdo" IN ('correcto','incorrecto')),
        CONSTRAINT "CHK_diagnosticos_gags" CHECK ("puntaje_gags" IS NULL OR ("puntaje_gags" BETWEEN 0 AND 44))
      )`);
    await queryRunner.query(`CREATE INDEX "IDX_diagnosticos_caso" ON "diagnosticos" ("caso_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_diagnosticos_usuario" ON "diagnosticos" ("usuario_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_diagnosticos_modo" ON "diagnosticos" ("modo_estudio_codigo")`);
    await queryRunner.query(
      `COMMENT ON TABLE "diagnosticos" IS 'DEBIL de casos. El juicio del especialista: el lado humano del Anexo 5 digital. Cubre OE2 (RF-OE2-01, RF-OE2-02).'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "diagnosticos"."acuerdo" IS 'Si este juicio coincidio con casos.clase_iga_referencia. Se calcula en el servidor al enviar y se CONGELA, de modo que la tabla del Anexo 5 es un registro fiel de lo que ocurrio en el momento de la revision, y no una vista que cambia si despues se corrige el patron de referencia.'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "diagnosticos"."sugerencia_aceptada" IS 'Solo tiene sentido en postest: si el medico conservo la clase que sugirio el modelo. NULL en pretest, donde no hubo sugerencia que aceptar.'`,
    );

    await queryRunner.query(`
      CREATE TABLE "cronometrajes_revision" (
        "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "caso_id"             uuid        NOT NULL,
        "usuario_id"          uuid        NOT NULL,
        "modo_estudio_codigo" varchar(20) NOT NULL,
        "t0"                  timestamptz NOT NULL,
        "t1"                  timestamptz,
        "duracion_segundos"   integer,
        "valido"              boolean     NOT NULL DEFAULT true,
        "notas"               text,
        "creado_en"           timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_cronometrajes_caso_modo" UNIQUE ("caso_id","modo_estudio_codigo"),
        CONSTRAINT "FK_cronometrajes_caso" FOREIGN KEY ("caso_id") REFERENCES "casos"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_cronometrajes_usuario" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_cronometrajes_modo" FOREIGN KEY ("modo_estudio_codigo") REFERENCES "modos_estudio"("codigo") ON DELETE RESTRICT,
        CONSTRAINT "CHK_cronometrajes_orden" CHECK ("t1" IS NULL OR "t1" >= "t0"),
        CONSTRAINT "CHK_cronometrajes_duracion" CHECK ("duracion_segundos" IS NULL OR "duracion_segundos" >= 0)
      )`);
    await queryRunner.query(`CREATE INDEX "IDX_cronometrajes_modo" ON "cronometrajes_revision" ("modo_estudio_codigo")`);
    await queryRunner.query(`CREATE INDEX "IDX_cronometrajes_usuario" ON "cronometrajes_revision" ("usuario_id")`);
    await queryRunner.query(
      `COMMENT ON TABLE "cronometrajes_revision" IS 'DEBIL de casos. Cronometraje de una revision medica: el Anexo 4 digital. Cubre OE1 (RF-OE1-01): TRi = t1 - t0. Ambas marcas las escribe el SERVIDOR, nunca el cliente, de modo que la medicion no se puede manipular desde el navegador.'`,
    );
    await queryRunner.query(
      `COMMENT ON CONSTRAINT "UQ_cronometrajes_caso_modo" ON "cronometrajes_revision" IS 'Una medicion por caso y por condicion. Es lo que hace del caso la unidad de emparejamiento del diseno O1 -> X -> O2: exactamente un valor pretest y uno postest por caso.'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "cronometrajes_revision"."duracion_segundos" IS 'Persistido en vez de derivado, para que el valor exportado en el dataset sea evidencia inmutable.'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "cronometrajes_revision"."valido" IS 'false para revisiones abandonadas o interrumpidas. Quedan en la tabla pero se excluyen del TRM: borrarlas ocultaria que ocurrieron.'`,
    );

    // =====================================================================
    // BLOQUE 11 — ENCUESTA DE SATISFACCIÓN (OE3 / ANEXO 6)
    // =====================================================================

    await queryRunner.query(`
      CREATE TABLE "respuestas_encuesta" (
        "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "usuario_id"          uuid        NOT NULL,
        "modo_estudio_codigo" varchar(20) NOT NULL,
        "puntos_obtenidos"    smallint    NOT NULL,
        "puntos_totales"      smallint    NOT NULL,
        "tsp_pct"             double precision NOT NULL,
        "promedio_likert"     double precision NOT NULL,
        "casos_postest_al_enviar" integer NOT NULL DEFAULT 0,
        "es_sintetico"        boolean     NOT NULL DEFAULT false,
        "comentarios"         text,
        "enviada_en"          timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_respuestas_encuesta_usuario" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_respuestas_encuesta_modo" FOREIGN KEY ("modo_estudio_codigo") REFERENCES "modos_estudio"("codigo") ON DELETE RESTRICT,
        CONSTRAINT "CHK_respuestas_encuesta_tsp" CHECK ("tsp_pct" >= 0 AND "tsp_pct" <= 100),
        CONSTRAINT "CHK_respuestas_encuesta_puntos" CHECK ("puntos_obtenidos" >= 0 AND "puntos_obtenidos" <= "puntos_totales"),
        CONSTRAINT "CHK_respuestas_encuesta_promedio" CHECK ("promedio_likert" >= 1 AND "promedio_likert" <= 5)
      )`);
    await queryRunner.query(`CREATE INDEX "IDX_respuestas_encuesta_usuario" ON "respuestas_encuesta" ("usuario_id")`);
    await queryRunner.query(
      `COMMENT ON TABLE "respuestas_encuesta" IS 'DEBIL de usuarios. Un cuestionario Likert completo: el Anexo 6 digital. Cubre OE3 (RF-OE3-01, RF-OE3-03). puntos_obtenidos (PO) y puntos_totales (PT) se congelan al enviar para que TSP = (PO / PT) x 100 se pueda recalcular identico meses despues (RNF-03).'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "respuestas_encuesta"."casos_postest_al_enviar" IS 'Cuantos casos postest llevaba el encuestado cuando se disparo la encuesta (RF-OE3-02). Sin este dato no se puede sustentar que respondio con experiencia suficiente del sistema.'`,
    );

    await queryRunner.query(`
      CREATE TABLE "detalle_respuestas_encuesta" (
        "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "respuesta_id" uuid     NOT NULL,
        "item_numero"  smallint NOT NULL,
        "puntaje"      smallint NOT NULL,
        CONSTRAINT "UQ_detalle_encuesta_item" UNIQUE ("respuesta_id","item_numero"),
        CONSTRAINT "FK_detalle_encuesta_respuesta" FOREIGN KEY ("respuesta_id") REFERENCES "respuestas_encuesta"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_detalle_encuesta_item" FOREIGN KEY ("item_numero") REFERENCES "items_encuesta"("numero") ON DELETE RESTRICT,
        CONSTRAINT "FK_detalle_encuesta_puntaje" FOREIGN KEY ("puntaje") REFERENCES "escala_likert"("puntaje") ON DELETE RESTRICT
      )`);
    await queryRunner.query(
      `COMMENT ON TABLE "detalle_respuestas_encuesta" IS 'DEBIL de respuestas_encuesta. Una respuesta a uno de los 8 items. Cubre RF-OE3-03 (reporte item por item). El enunciado NO se repite aqui: vive una sola vez en items_encuesta, de modo que la redaccion validada no puede divergir entre filas.'`,
    );

    // =====================================================================
    // BLOQUE 12 — BITÁCORAS INMUTABLES (RNF-05)
    // =====================================================================

    await queryRunner.query(`
      CREATE TABLE "instantaneas_indicador" (
        "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "indicador_codigo"    varchar(8)  NOT NULL,
        "modo_estudio_codigo" varchar(20) NOT NULL,
        "alcance"             varchar(64) NOT NULL DEFAULT 'global',
        "valor"               double precision NOT NULL,
        "unidad"              varchar(16) NOT NULL,
        "n"                   integer     NOT NULL,
        "media"               double precision NOT NULL,
        "desviacion_estandar" double precision NOT NULL,
        "minimo"              double precision NOT NULL,
        "q1"                  double precision NOT NULL,
        "mediana"             double precision NOT NULL,
        "q3"                  double precision NOT NULL,
        "maximo"              double precision NOT NULL,
        "hash_entrada"        varchar(64) NOT NULL,
        "version_funcion"     varchar(40) NOT NULL,
        "incluye_sinteticos"  boolean     NOT NULL DEFAULT false,
        "calculada_por"       uuid,
        "calculada_en"        timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_instantaneas_indicador" FOREIGN KEY ("indicador_codigo") REFERENCES "indicadores"("codigo") ON DELETE RESTRICT,
        CONSTRAINT "FK_instantaneas_modo" FOREIGN KEY ("modo_estudio_codigo") REFERENCES "modos_estudio"("codigo") ON DELETE RESTRICT,
        CONSTRAINT "FK_instantaneas_usuario" FOREIGN KEY ("calculada_por") REFERENCES "usuarios"("id") ON DELETE SET NULL,
        CONSTRAINT "CHK_instantaneas_n" CHECK ("n" >= 0)
      )`);
    await queryRunner.query(`CREATE INDEX "IDX_instantaneas_indicador" ON "instantaneas_indicador" ("indicador_codigo")`);
    await queryRunner.query(`CREATE INDEX "IDX_instantaneas_modo" ON "instantaneas_indicador" ("modo_estudio_codigo")`);
    await queryRunner.query(
      `COMMENT ON TABLE "instantaneas_indicador" IS 'BITACORA INMUTABLE. Un calculo de indicador. Cubre RNF-05: todo calculo genera un log inmutable con input, semilla, version de la funcion, resultado y timestamp. Solo INSERT: la aplicacion no tiene ruta de UPDATE ni de DELETE, de modo que un evaluador externo puede confiar en que una cifra reportada nunca se retro-edito.'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "instantaneas_indicador"."media" IS 'Los ocho estadisticos descriptivos pasaron de un jsonb a columnas propias: son un conjunto fijo y conocido, y como columnas se pueden ordenar, comparar entre instantaneas y graficar sin expandir JSON.'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "instantaneas_indicador"."hash_entrada" IS 'SHA-256 de las filas de entrada en orden (RNF-05). Es lo que permite a un tercero probar que el numero reportado salio exactamente de esos datos.'`,
    );

    await queryRunner.query(`
      CREATE TABLE "observaciones_indicador" (
        "instantanea_id" uuid             NOT NULL,
        "orden"          integer          NOT NULL,
        "valor"          double precision NOT NULL,
        CONSTRAINT "PK_observaciones_indicador" PRIMARY KEY ("instantanea_id","orden"),
        CONSTRAINT "FK_observaciones_instantanea" FOREIGN KEY ("instantanea_id") REFERENCES "instantaneas_indicador"("id") ON DELETE CASCADE
      )`);
    await queryRunner.query(
      `COMMENT ON TABLE "observaciones_indicador" IS 'DEBIL de instantaneas_indicador. Las observaciones individuales detras del valor agregado, en el orden exacto en que entraron al calculo. Alimentan los diagramas de caja y permiten reanalizar sin volver a consultar las tablas transaccionales, que para entonces pueden haber cambiado.'`,
    );

    await queryRunner.query(`
      CREATE TABLE "ejecuciones_hipotesis" (
        "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "hipotesis_codigo"    varchar(8)  NOT NULL,
        "indicador_codigo"    varchar(8)  NOT NULL,
        "diseno"              varchar(16) NOT NULL,
        "alfa"                double precision NOT NULL,
        "alternativa"         varchar(16) NOT NULL,
        "n_pares"             integer     NOT NULL,
        "media_pretest"       double precision NOT NULL,
        "media_postest"       double precision NOT NULL,
        "diferencia_medias"   double precision NOT NULL,
        "normalidad_prueba"   varchar(24) NOT NULL,
        "normalidad_estadistico" double precision,
        "normalidad_p_valor"  double precision,
        "normalidad_normal"   boolean     NOT NULL,
        "normalidad_aplicable" boolean    NOT NULL,
        "normalidad_nota"     text,
        "prueba_aplicada"     varchar(24) NOT NULL,
        "estadistico"         double precision NOT NULL,
        "p_valor"             double precision NOT NULL,
        "efecto_tipo"         varchar(24),
        "efecto_valor"        double precision,
        "efecto_magnitud"     varchar(16),
        "rechaza_nula"        boolean     NOT NULL,
        "conclusion"          text        NOT NULL,
        "semilla"             integer     NOT NULL DEFAULT 42,
        "version_funcion"     varchar(40) NOT NULL,
        "hash_entrada"        varchar(64) NOT NULL,
        "incluye_sinteticos"  boolean     NOT NULL DEFAULT false,
        "ejecutada_por"       uuid,
        "ejecutada_en"        timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_ejecuciones_hipotesis" FOREIGN KEY ("hipotesis_codigo") REFERENCES "hipotesis"("codigo") ON DELETE RESTRICT,
        CONSTRAINT "FK_ejecuciones_indicador" FOREIGN KEY ("indicador_codigo") REFERENCES "indicadores"("codigo") ON DELETE RESTRICT,
        CONSTRAINT "FK_ejecuciones_usuario" FOREIGN KEY ("ejecutada_por") REFERENCES "usuarios"("id") ON DELETE SET NULL,
        CONSTRAINT "CHK_ejecuciones_diseno" CHECK ("diseno" IN ('paired','one_sample')),
        CONSTRAINT "CHK_ejecuciones_prueba" CHECK ("prueba_aplicada" IN ('ttest_rel','wilcoxon','ttest_1samp','wilcoxon_1samp')),
        CONSTRAINT "CHK_ejecuciones_alternativa" CHECK ("alternativa" IN ('two-sided','less','greater')),
        CONSTRAINT "CHK_ejecuciones_p" CHECK ("p_valor" >= 0 AND "p_valor" <= 1),
        CONSTRAINT "CHK_ejecuciones_alfa" CHECK ("alfa" > 0 AND "alfa" < 1),
        CONSTRAINT "CHK_ejecuciones_efecto" CHECK ("efecto_tipo" IS NULL OR "efecto_tipo" IN ('cohens_dz','rank_biserial')),
        CONSTRAINT "CHK_ejecuciones_magnitud" CHECK ("efecto_magnitud" IS NULL OR "efecto_magnitud" IN ('trivial','small','medium','large'))
      )`);
    await queryRunner.query(`CREATE INDEX "IDX_ejecuciones_hipotesis" ON "ejecuciones_hipotesis" ("hipotesis_codigo")`);
    await queryRunner.query(
      `COMMENT ON TABLE "ejecuciones_hipotesis" IS 'BITACORA INMUTABLE. Un contraste de hipotesis. Cubre RNF-05 y RF-OE1-04 / RF-OE2-05 / RF-OE3-05 / RF-OE4-03. Guarda todo lo necesario para reejecutar la prueba identica seis meses despues: los pares exactos, la semilla, el alfa, el resultado de normalidad, la prueba elegida y la version de la funcion estadistica.'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "ejecuciones_hipotesis"."normalidad_prueba" IS 'Shapiro-Wilk sobre las diferencias pareadas, como manda la seccion de metodologia. El bloque normalidad_* era un jsonb; en columnas se puede filtrar por que contrastes fueron parametricos sin abrir el JSON.'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "ejecuciones_hipotesis"."normalidad_aplicable" IS 'Shapiro-Wilk necesita al menos 3 observaciones; por debajo la prueba se omite y esto queda en false.'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "ejecuciones_hipotesis"."prueba_aplicada" IS 'Nomenclatura de SciPy a proposito: es el argumento exacto con que se invoco la funcion. Traducirlo obligaria a un diccionario de ida y vuelta que solo puede equivocarse.'`,
    );

    await queryRunner.query(`
      CREATE TABLE "pares_hipotesis" (
        "ejecucion_id" uuid             NOT NULL,
        "clave_par"    varchar(64)      NOT NULL,
        "etiqueta"     varchar(120)     NOT NULL,
        "valor_pretest" double precision NOT NULL,
        "valor_postest" double precision NOT NULL,
        "diferencia"    double precision NOT NULL,
        CONSTRAINT "PK_pares_hipotesis" PRIMARY KEY ("ejecucion_id","clave_par"),
        CONSTRAINT "FK_pares_ejecucion" FOREIGN KEY ("ejecucion_id") REFERENCES "ejecuciones_hipotesis"("id") ON DELETE CASCADE
      )`);
    await queryRunner.query(
      `COMMENT ON TABLE "pares_hipotesis" IS 'DEBIL de ejecuciones_hipotesis. Las observaciones pareadas exactas que consumio la prueba. clave_par es un id de caso (HE1, HE2) o de profesional (HE4). Se guardan por VALOR y no por referencia: si el caso cambiara despues, el contraste ya publicado debe seguir siendo reproducible.'`,
    );

    await queryRunner.query(`
      CREATE TABLE "registros_auditoria" (
        "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "usuario_id"    uuid,
        "correo"        varchar(180),
        "accion"        varchar(64)  NOT NULL,
        "tipo_entidad"  varchar(40)  NOT NULL,
        "entidad_id"    uuid,
        "direccion_ip"  varchar(64),
        "agente_usuario" varchar(255),
        "metadatos"     jsonb,
        "creado_en"     timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT "FK_auditoria_usuario" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL
      )`);
    await queryRunner.query(`CREATE INDEX "IDX_auditoria_usuario" ON "registros_auditoria" ("usuario_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_auditoria_accion" ON "registros_auditoria" ("accion")`);
    await queryRunner.query(`CREATE INDEX "IDX_auditoria_entidad" ON "registros_auditoria" ("tipo_entidad")`);
    await queryRunner.query(`CREATE INDEX "IDX_auditoria_creado" ON "registros_auditoria" ("creado_en")`);
    await queryRunner.query(
      `COMMENT ON TABLE "registros_auditoria" IS 'BITACORA INMUTABLE. Traza append-only. Cubre RNF-02: cada lectura de imagen clinica, cada descifrado de identidad de paciente y cada exportacion de dataset aterriza aqui.'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "registros_auditoria"."correo" IS 'Copia del correo al momento del hecho. Redundante a proposito y por eso NO viola la 3FN en el sentido que importa: si la cuenta se borra o cambia de correo, la traza debe seguir diciendo quien actuo. Es un valor historico, no una dependencia transitiva de usuario_id.'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "registros_auditoria"."metadatos" IS 'Unico jsonb que sobrevive a la normalizacion, y a proposito: el contexto de una accion es genuinamente sin esquema (que filtro llevaba una exportacion, que campo se descifro). Normalizarlo exigiria una tabla por tipo de accion sin ganancia analitica.'`,
    );

    await this.seedCatalogs(queryRunner);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await this.dropEverything(queryRunner);
  }

  /**
   * Borra el esquema completo, en orden inverso de dependencia.
   *
   * Se ejecuta tanto en `up` como en `down` a propósito: `up` reconstruye desde cero por diseño, y
   * la lista incluye también las tablas en inglés del esquema anterior para que una base ya usada
   * quede limpia sin pasos manuales.
   */
  private async dropEverything(queryRunner: QueryRunner): Promise<void> {
    const tablas = [
      // Esquema nuevo, hijas primero.
      'pares_hipotesis',
      'ejecuciones_hipotesis',
      'observaciones_indicador',
      'instantaneas_indicador',
      'registros_auditoria',
      'detalle_respuestas_encuesta',
      'respuestas_encuesta',
      'cronometrajes_revision',
      'diagnosticos',
      'detalles_valoracion',
      'valoraciones_inferencia',
      'tipos_detalle_valoracion',
      'probabilidades_inferencia',
      'inferencias_ia',
      'trabajos_inferencia',
      'respuestas_anamnesis_opcion',
      'respuestas_anamnesis',
      'anamnesis_caso',
      'sesiones_captura',
      'imagenes_caso',
      'consentimientos',
      'casos',
      'jornadas_trabajo',
      'pacientes',
      'usuarios',
      'opciones_pregunta',
      'preguntas_anamnesis',
      'ambitos_anamnesis',
      'tipos_pregunta',
      'secciones_anamnesis',
      'items_encuesta',
      'escala_likert',
      'hipotesis',
      'indicadores',
      'tomas_fotograficas',
      'fototipos_fitzpatrick',
      'sexos',
      'grados_gags',
      'clases_iga',
      'turnos',
      'estados_proceso',
      'transiciones_estado_caso',
      'estados_caso',
      'modos_estudio',
      'roles_permisos',
      'permisos',
      'roles',
      // Esquema anterior en inglés.
      'audit_logs',
      'hypothesis_runs',
      'indicator_snapshots',
      'survey_answers',
      'survey_responses',
      'review_timings',
      'diagnoses',
      'inference_jobs',
      'ai_inferences',
      'capture_sessions',
      'case_anamnesis',
      'case_images',
      'cases',
      'work_sessions',
      'consents',
      'patients',
      'users',
    ];
    for (const tabla of tablas) {
      await queryRunner.query(`DROP TABLE IF EXISTS "${tabla}" CASCADE`);
    }
  }

  /**
   * Puebla los catálogos.
   *
   * Va en la migración y no en un seeder porque estas filas no son datos de ejemplo: son el
   * dominio. Una base sin ellas no acepta un solo `INSERT` en `usuarios` ni en `casos`, de modo que
   * dejarlas fuera del esquema haría que una instalación limpia naciera rota.
   */
  private async seedCatalogs(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "roles" ("codigo","nombre","descripcion","orden") VALUES
        ('admin','Administrador','Mantiene el sistema y lee la evidencia del estudio: usuarios, indicadores, contrastes, auditoría y exportación. No diagnostica.',1),
        ('dermatologo','Dermatólogo','Emite el diagnóstico de referencia, ve la identidad del paciente y —solo en postest— la sugerencia del modelo. Es el sujeto que el estudio mide.',2),
        ('tecnico','Técnico/a','Recibe al paciente: lo registra, abre el caso, toma la anamnesis y entrega el QR de las fotografías. Nunca diagnostica.',3)`);

    await queryRunner.query(`
      INSERT INTO "permisos" ("codigo","descripcion") VALUES
        ('diagnosticar','Firmar el diagnóstico IGA de un caso (Anexo 5).'),
        ('ver_identidad_paciente','Descifrar y ver el nombre y documento del paciente (RF-TR-03).'),
        ('ver_sugerencia_ia','Ver la clase, la confianza y la lectura razonada del modelo (RF-TR-01).'),
        ('registrar_ingreso','Abrir el caso, tomar la anamnesis y emitir el QR de captura.'),
        ('gestionar_pacientes','Registrar y editar la ficha del paciente.'),
        ('registrar_jornada','Abrir y cerrar la jornada de trabajo (Anexo 7).'),
        ('responder_encuesta','Responder el cuestionario Likert de satisfacción (Anexo 6).'),
        ('leer_analisis','Leer los indicadores TRM, TPD, TSP y TCAD.'),
        ('ejecutar_contrastes','Ejecutar los contrastes de hipótesis HE₁–HE₄.'),
        ('exportar_datos_crudos','Descargar los datasets crudos del estudio (RF-TR-02).'),
        ('gestionar_usuarios','Crear, editar y desactivar cuentas del personal.'),
        ('leer_auditoria','Leer la traza de auditoría y el checklist de cobertura (RNF-02, RNF-04).')`);

    await queryRunner.query(`
      INSERT INTO "roles_permisos" ("rol_codigo","permiso_codigo") VALUES
        ('admin','gestionar_pacientes'),
        ('admin','registrar_ingreso'),
        ('admin','ver_identidad_paciente'),
        ('admin','leer_analisis'),
        ('admin','ejecutar_contrastes'),
        ('admin','exportar_datos_crudos'),
        ('admin','gestionar_usuarios'),
        ('admin','leer_auditoria'),
        ('dermatologo','diagnosticar'),
        ('dermatologo','ver_identidad_paciente'),
        ('dermatologo','ver_sugerencia_ia'),
        ('dermatologo','registrar_ingreso'),
        ('dermatologo','gestionar_pacientes'),
        ('dermatologo','registrar_jornada'),
        ('dermatologo','responder_encuesta'),
        ('dermatologo','leer_analisis'),
        ('dermatologo','leer_auditoria'),
        ('tecnico','registrar_ingreso'),
        ('tecnico','gestionar_pacientes'),
        ('tecnico','ver_identidad_paciente')`);

    await queryRunner.query(`
      INSERT INTO "modos_estudio" ("codigo","nombre","valor_iia","permite_ia","es_experimental","orden") VALUES
        ('pretest','Pretest (sin IA)',0,false,true,1),
        ('postest','Postest (con IA)',1,true,true,2),
        ('produccion','Producción',0,true,false,3)`);

    await queryRunner.query(`
      INSERT INTO "estados_caso" ("codigo","nombre","orden","es_final") VALUES
        ('borrador','Borrador',1,false),
        ('en_revision','En revisión',2,false),
        ('procesado_ia','Procesado por IA',3,false),
        ('diagnosticado','Diagnosticado',4,false),
        ('cerrado','Cerrado',5,true)`);

    await queryRunner.query(`
      INSERT INTO "transiciones_estado_caso" ("estado_origen","estado_destino") VALUES
        ('borrador','en_revision'),
        ('en_revision','procesado_ia'),
        ('en_revision','diagnosticado'),
        ('procesado_ia','diagnosticado'),
        ('diagnosticado','cerrado')`);

    await queryRunner.query(`
      INSERT INTO "estados_proceso" ("codigo","nombre","orden") VALUES
        ('pendiente','Pendiente',1),
        ('ejecutando','Ejecutando',2),
        ('exitoso','Exitoso',3),
        ('fallido','Fallido',4)`);

    await queryRunner.query(`
      INSERT INTO "turnos" ("codigo","nombre","orden") VALUES
        ('manana','Mañana',1),
        ('tarde','Tarde',2),
        ('noche','Noche',3)`);

    await queryRunner.query(`
      INSERT INTO "clases_iga" ("codigo","nombre","orden_ordinal") VALUES
        ('sin_lesiones','Sin lesiones',0),
        ('casi_sin_lesiones','Casi sin lesiones',1),
        ('leve','Leve',2),
        ('moderado','Moderado',3),
        ('severo','Severo',4)`);

    await queryRunner.query(`
      INSERT INTO "grados_gags" ("codigo","nombre","puntaje_min","puntaje_max","orden") VALUES
        ('sin_acne','Sin acné',0,0,0),
        ('leve','Leve',1,18,1),
        ('moderado','Moderado',19,30,2),
        ('severo','Severo',31,38,3),
        ('muy_severo','Muy severo',39,44,4)`);

    await queryRunner.query(`
      INSERT INTO "sexos" ("codigo","nombre","orden") VALUES
        ('femenino','Femenino',1),
        ('masculino','Masculino',2),
        ('otro','Otro',3)`);

    await queryRunner.query(`
      INSERT INTO "fototipos_fitzpatrick" ("codigo","descripcion","orden") VALUES
        ('I','Piel muy clara, siempre se quema, nunca broncea',1),
        ('II','Piel clara, se quema con facilidad, broncea poco',2),
        ('III','Piel clara a mate, se quema moderadamente, broncea gradualmente',3),
        ('IV','Piel mate, se quema poco, broncea con facilidad',4),
        ('V','Piel morena, rara vez se quema, broncea intensamente',5),
        ('VI','Piel oscura, nunca se quema, siempre pigmentada',6)`);

    await queryRunner.query(`
      INSERT INTO "tomas_fotograficas" ("codigo","nombre","instruccion","obligatoria","orden") VALUES
        ('general','Vista general','Encuadre toda la zona afectada, de frente y con luz natural.',true,1),
        ('acercamiento','Acercamiento','Acérquese a unos 20 cm de las lesiones, sin que salga borrosa.',true,2),
        ('borde','Borde con piel sana','Encuadre el límite entre la zona con lesiones y la piel sana.',true,3),
        ('perfil_derecho','Perfil derecho','Gire el rostro hacia la izquierda para fotografiar la mejilla derecha.',false,4),
        ('perfil_izquierdo','Perfil izquierdo','Gire el rostro hacia la derecha para fotografiar la mejilla izquierda.',false,5),
        ('pecho','Pecho','Solo si hay lesiones en el pecho.',false,6),
        ('espalda','Espalda','Solo si hay lesiones en la espalda. Pida ayuda para tomarla.',false,7),
        ('otra','Otra toma','Cualquier otra zona que el profesional le haya indicado.',false,8)`);

    await queryRunner.query(`
      INSERT INTO "indicadores" ("codigo","nombre","objetivo","formula","unidad","instrumento","direccion","meta") VALUES
        ('TRM','Tasa de revisión médica','OE1','TRM = (Σ TRᵢ) / n','min/caso','Anexo 4 — Ficha de registro de tiempo de revisión médica','menor','Reducción ≥ 30 % respecto al pretest'),
        ('TPD','Tasa de precisión diagnóstica','OE2','TPD = (DC / DT) × 100','%','Anexo 5 — Ficha de registro de precisión del diagnóstico','mayor','TPD ≥ 90 % en postest'),
        ('TSP','Tasa de satisfacción del personal','OE3','TSP = (Σ PO / PT) × 100','%','Anexo 6 — Cuestionario Likert de 8 ítems','mayor','TSP ≥ 80 % (Likert promedio ≥ 4/5)'),
        ('TCAD','Tasa de capacidad de atención','OE4','TCAD = NCR / TJ','casos/hora','Anexo 7 — Ficha de registro de capacidad de atención','mayor','Incremento significativo postest vs pretest')`);

    await queryRunner.query(`
      INSERT INTO "hipotesis" ("codigo","indicador_codigo","enunciado_alterna","enunciado_nula","diseno","alternativa") VALUES
        ('HE1','TRM','La implementación de IA reduce significativamente el tiempo de revisión médica del diagnóstico de acné.','La implementación de IA no reduce significativamente el tiempo de revisión médica.','paired','less'),
        ('HE2','TPD','La implementación de IA incrementa significativamente la precisión del diagnóstico preliminar de acné.','La implementación de IA no incrementa significativamente la precisión del diagnóstico preliminar.','paired','greater'),
        ('HE3','TSP','La implementación de IA incrementa significativamente la satisfacción del personal médico.','La implementación de IA no incrementa significativamente la satisfacción del personal médico.','one_sample','greater'),
        ('HE4','TCAD','La implementación de IA incrementa significativamente la cantidad de casos de acné revisados por el personal médico.','La implementación de IA no incrementa significativamente la cantidad de casos revisados.','paired','greater')`);

    await queryRunner.query(`
      INSERT INTO "escala_likert" ("puntaje","etiqueta") VALUES
        (1,'Muy bajo'),(2,'Bajo'),(3,'Normal'),(4,'Alto'),(5,'Muy alto')`);

    // Redacción VERBATIM del instrumento validado (Anexo 6). No se parafrasea nunca.
    await queryRunner.query(`
      INSERT INTO "items_encuesta" ("numero","enunciado","version") VALUES
        (1,'El sistema con IA es fácil de usar para apoyar el diagnóstico de acné.','1.0'),
        (2,'El tiempo que dedico a revisar y validar cada caso se ha reducido con el sistema.','1.0'),
        (3,'El diagnóstico preliminar generado por la IA es confiable y útil.','1.0'),
        (4,'La preclasificación automática de imágenes facilita mi decisión clínica.','1.0'),
        (5,'El sistema me permite atender un mayor número de casos por jornada.','1.0'),
        (6,'La información que entrega el sistema mejora la precisión del diagnóstico.','1.0'),
        (7,'Recomendaría el uso del sistema con IA a otros profesionales del centro.','1.0'),
        (8,'En general, estoy satisfecho con el sistema de diagnóstico asistido por IA.','1.0')`);

    await queryRunner.query(`
      INSERT INTO "secciones_anamnesis" ("codigo","nombre","orden") VALUES
        ('contexto','Datos básicos y antecedentes',1),
        ('lesion','Historia de la lesión',2),
        ('acne','Específico de acné',3),
        ('hormonal','Evaluación hormonal',4)`);

    await queryRunner.query(`
      INSERT INTO "tipos_pregunta" ("codigo","nombre") VALUES
        ('booleano','Sí / No'),
        ('texto','Texto libre'),
        ('numero','Número'),
        ('opcion_unica','Opción única'),
        ('opcion_multiple','Opción múltiple')`);

    await queryRunner.query(`
      INSERT INTO "ambitos_anamnesis" ("codigo","descripcion") VALUES
        ('siempre','Aplica a todo paciente.'),
        ('mujer_adulta','Solo mujeres desde los 18 años: el bloque hormonal solo es significativo en edad reproductiva.')`);

    await queryRunner.query(`
      INSERT INTO "tipos_detalle_valoracion" ("codigo","nombre","orden") VALUES
        ('lesion','Lesiones elementales observadas',1),
        ('zona','Zonas faciales comprometidas',2),
        ('diferencial','Diagnósticos diferenciales',3),
        ('consideracion','Consideraciones de manejo',4),
        ('bandera_anamnesis','Banderas levantadas por la anamnesis',5)`);

    // Las 21 preguntas y sus opciones. Se insertan aquí, y no desde el catálogo de TypeScript, para
    // que una base creada por la CLI de TypeORM sin arrancar la aplicación quede igual de completa.
    await queryRunner.query(`
      INSERT INTO "preguntas_anamnesis"
        ("clave","numero","seccion_codigo","enunciado","tipo_codigo","ambito_codigo","unidad","obligatoria","prompt_detalle","ayuda","version") VALUES
        ('peso_kg',1,'contexto','¿Cuál es su peso aproximado?','numero','siempre','kg',false,NULL,'La isotretinoína se dosifica por kilo de peso (mg/kg).','2.0'),
        ('enfermedad_cronica',2,'contexto','¿Tiene alguna enfermedad crónica? (diabetes, hipertensión, tiroides, etc.)','booleano','siempre',NULL,false,'¿Cuál?',NULL,'2.0'),
        ('medicacion_actual',3,'contexto','¿Toma algún medicamento actualmente?','booleano','siempre',NULL,false,'Nombre del medicamento',NULL,'2.0'),
        ('alergia_medicamentos',4,'contexto','¿Tiene alergia a algún medicamento?','booleano','siempre',NULL,false,'¿A cuál?',NULL,'2.0'),
        ('tiempo_evolucion',5,'lesion','¿Hace cuánto tiempo aparecieron las lesiones?','opcion_unica','siempre',NULL,false,NULL,NULL,'2.0'),
        ('episodio_previo',6,'lesion','¿Es la primera vez que aparecen o ya las tuvo antes?','opcion_unica','siempre',NULL,false,'Si ya las tuvo: ¿desaparecieron solas o usó algún tratamiento?',NULL,'2.0'),
        ('evaluacion_previa',7,'lesion','¿Algún médico lo evaluó antes por esto?','opcion_unica','siempre',NULL,false,NULL,NULL,'2.0'),
        ('tratamientos_previos',8,'lesion','¿Ya usó alguna crema o medicamento para esto?','booleano','siempre',NULL,false,'¿Cuál? ¿Por cuánto tiempo? ¿Cuándo fue la última vez?',NULL,'2.0'),
        ('sintomas',9,'lesion','¿Qué molestias le dan las lesiones?','opcion_multiple','siempre',NULL,false,NULL,NULL,'2.0'),
        ('zona_extrafacial',10,'acne','¿El acné también está en el pecho o la espalda?','opcion_multiple','siempre',NULL,false,NULL,'El compromiso del tronco pesa en la severidad y orienta al tratamiento sistémico.','2.0'),
        ('productos_acne',11,'acne','¿Qué productos usa para el acné?','texto','siempre',NULL,false,NULL,'Indique el nombre exacto del producto.','2.0'),
        ('fotoproteccion',12,'acne','¿Usa protector solar o crema hidratante?','booleano','siempre',NULL,false,'¿Cuál?',NULL,'2.0'),
        ('suplementos',13,'acne','¿Toma suplementos vitamínicos, proteínas en polvo, creatina o anabólicos?','booleano','siempre',NULL,false,'¿Cuáles?','Son desencadenantes frecuentes y a menudo el paciente no los relaciona.','2.0'),
        ('antecedente_familiar',14,'acne','¿Alguno de sus padres tuvo acné severo?','opcion_unica','siempre',NULL,false,NULL,NULL,'2.0'),
        ('maquillaje',15,'acne','¿Usa maquillaje con frecuencia? ¿Lo retira completamente antes de dormir?','opcion_unica','siempre',NULL,false,NULL,NULL,'2.0'),
        ('menstruacion_regular',16,'hormonal','¿Le viene la menstruación todos los meses y en fechas regulares?','opcion_unica','mujer_adulta',NULL,false,NULL,NULL,'2.0'),
        ('empeora_premenstrual',17,'hormonal','¿El acné empeora días o semanas antes de la menstruación?','booleano','mujer_adulta',NULL,false,NULL,NULL,'2.0'),
        ('embarazo_menopausia',18,'hormonal','¿Está embarazada, tuvo un embarazo reciente o está en menopausia?','opcion_unica','mujer_adulta',NULL,false,NULL,'Determinante para descartar retinoides orales.','2.0'),
        ('anticonceptivo',19,'hormonal','¿Usa algún método anticonceptivo?','booleano','mujer_adulta',NULL,false,'¿Cuál?',NULL,'2.0'),
        ('caida_cabello',20,'hormonal','¿Nota caída de cabello?','booleano','mujer_adulta',NULL,false,NULL,NULL,'2.0'),
        ('vello_inusual',21,'hormonal','¿Nota vello en zonas inusuales — mentón, abdomen o pecho?','booleano','mujer_adulta',NULL,false,NULL,'Junto con la caída de cabello, orienta a hiperandrogenismo.','2.0')`);

    await queryRunner.query(`
      INSERT INTO "opciones_pregunta" ("pregunta_id","valor","orden")
      SELECT p."id", o."valor", o."orden"
      FROM (VALUES
        ('tiempo_evolucion','menos de 1 mes',1),
        ('tiempo_evolucion','1 a 6 meses',2),
        ('tiempo_evolucion','6 a 12 meses',3),
        ('tiempo_evolucion','más de 1 año',4),
        ('episodio_previo','primera vez',1),
        ('episodio_previo','ya las tuvo antes',2),
        ('evaluacion_previa','no',1),
        ('evaluacion_previa','médico general',2),
        ('evaluacion_previa','dermatólogo',3),
        ('sintomas','pican',1),
        ('sintomas','arden',2),
        ('sintomas','duelen',3),
        ('sintomas','ninguna',4),
        ('zona_extrafacial','pecho',1),
        ('zona_extrafacial','espalda',2),
        ('zona_extrafacial','ninguna',3),
        ('antecedente_familiar','sí',1),
        ('antecedente_familiar','no',2),
        ('antecedente_familiar','no sabe',3),
        ('maquillaje','no usa',1),
        ('maquillaje','usa y lo retira',2),
        ('maquillaje','usa y no siempre lo retira',3),
        ('menstruacion_regular','sí',1),
        ('menstruacion_regular','no',2),
        ('menstruacion_regular','no aplica',3),
        ('embarazo_menopausia','ninguno',1),
        ('embarazo_menopausia','embarazo actual',2),
        ('embarazo_menopausia','embarazo reciente',3),
        ('embarazo_menopausia','menopausia',4)
      ) AS o("clave","valor","orden")
      JOIN "preguntas_anamnesis" p ON p."clave" = o."clave"`);
  }
}
