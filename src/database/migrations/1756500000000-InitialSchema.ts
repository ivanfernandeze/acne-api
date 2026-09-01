import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Initial clinical schema for the thesis prototype.
 *
 * Every table declares, in a COMMENT, the thesis objective it serves, so the database itself is
 * self-documenting for an external evaluator (RNF-04, RNF-05).
 *
 * Enumerations are CHECK constraints over varchar rather than native PostgreSQL enums: adding an
 * IGA class or a role later is then a one-line constraint swap instead of a type migration, which
 * matters because section 8.1 leaves the final class count to the committee.
 */
export class InitialSchema1756500000000 implements MigrationInterface {
  name = 'InitialSchema1756500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // -- users ---------------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "email"               varchar(180) NOT NULL,
        "password_hash"       varchar(255) NOT NULL,
        "full_name"           varchar(160) NOT NULL,
        "role"                varchar(40)  NOT NULL,
        "study_mode"          varchar(20)  NOT NULL DEFAULT 'produccion',
        "specialty"           varchar(120),
        "active"              boolean      NOT NULL DEFAULT true,
        "consent_accepted_at" timestamptz,
        "created_at"          timestamptz  NOT NULL DEFAULT now(),
        "updated_at"          timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_users_email" UNIQUE ("email"),
        CONSTRAINT "CHK_users_role" CHECK ("role" IN ('dermatologo','residente','admin','evaluador_estadistico')),
        CONSTRAINT "CHK_users_study_mode" CHECK ("study_mode" IN ('pretest','postest','produccion'))
      )`);
    await queryRunner.query(
      `COMMENT ON TABLE "users" IS 'Personal del estudio. Cubre RF-TR-01 (study_mode = variable independiente) y RF-TR-02 (roles).'`,
    );

    // -- patients ------------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "patients" (
        "id"                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "patient_code"          varchar(32) NOT NULL,
        "encrypted_full_name"   text,
        "encrypted_document_id" text,
        "birth_date"            date,
        "sex"                   varchar(16),
        "fitzpatrick_phototype" varchar(4),
        "consent_accepted_at"   timestamptz,
        "withdrawn_at"          timestamptz,
        "created_by"            uuid,
        "created_at"            timestamptz NOT NULL DEFAULT now(),
        "updated_at"            timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_patients_code" UNIQUE ("patient_code"),
        CONSTRAINT "CHK_patients_sex" CHECK ("sex" IS NULL OR "sex" IN ('femenino','masculino','otro')),
        CONSTRAINT "CHK_patients_fitzpatrick" CHECK ("fitzpatrick_phototype" IS NULL OR "fitzpatrick_phototype" IN ('I','II','III','IV','V','VI')),
        CONSTRAINT "FK_patients_created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL
      )`);
    await queryRunner.query(
      `COMMENT ON TABLE "patients" IS 'Paciente anonimizado. Cubre RF-TR-03 (identidad cifrada AES-256-GCM) y RNF-07 (consentimiento, derecho a retiro).'`,
    );

    // -- consents ------------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "consents" (
        "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "subject_type" varchar(24) NOT NULL,
        "subject_id"   uuid        NOT NULL,
        "version"      varchar(16) NOT NULL,
        "accepted"     boolean     NOT NULL DEFAULT true,
        "accepted_at"  timestamptz NOT NULL,
        "ip_address"   varchar(64),
        "notes"        text,
        "created_at"   timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_consents_subject" CHECK ("subject_type" IN ('paciente','personal_medico'))
      )`);
    await queryRunner.query(`CREATE INDEX "IDX_consents_subject" ON "consents" ("subject_type","subject_id")`);
    await queryRunner.query(
      `COMMENT ON TABLE "consents" IS 'Consentimiento informado electronico. Cubre RNF-07. Append-only: un retiro es una fila nueva.'`,
    );

    // -- work_sessions (OE4 / Anexo 7) --------------------------------------
    await queryRunner.query(`
      CREATE TABLE "work_sessions" (
        "id"                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id"                 uuid        NOT NULL,
        "study_mode"              varchar(20) NOT NULL,
        "shift"                   varchar(16) NOT NULL,
        "started_at"              timestamptz NOT NULL,
        "ended_at"                timestamptz,
        "declared_duration_hours" double precision,
        "cases_reviewed"          integer     NOT NULL DEFAULT 0,
        "tcad"                    double precision,
        "is_synthetic"            boolean     NOT NULL DEFAULT false,
        "notes"                   text,
        "created_at"              timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_work_sessions_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_work_sessions_mode" CHECK ("study_mode" IN ('pretest','postest','produccion')),
        CONSTRAINT "CHK_work_sessions_shift" CHECK ("shift" IN ('manana','tarde','noche')),
        CONSTRAINT "CHK_work_sessions_tj" CHECK ("declared_duration_hours" IS NULL OR "declared_duration_hours" > 0)
      )`);
    await queryRunner.query(`CREATE INDEX "IDX_work_sessions_user" ON "work_sessions" ("user_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_work_sessions_mode" ON "work_sessions" ("study_mode")`);
    await queryRunner.query(
      `COMMENT ON TABLE "work_sessions" IS 'Jornada de trabajo (Anexo 7 digital). Cubre OE4: TCAD = NCR / TJ.'`,
    );

    // -- cases ---------------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "cases" (
        "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "case_code"        varchar(32) NOT NULL,
        "patient_id"       uuid        NOT NULL,
        "assigned_user_id" uuid,
        "study_mode"       varchar(20) NOT NULL,
        "status"           varchar(20) NOT NULL DEFAULT 'draft',
        "ground_truth_iga" varchar(24),
        "is_synthetic"     boolean     NOT NULL DEFAULT false,
        "work_session_id"  uuid,
        "notes"            text,
        "created_at"       timestamptz NOT NULL DEFAULT now(),
        "updated_at"       timestamptz NOT NULL DEFAULT now(),
        "closed_at"        timestamptz,
        CONSTRAINT "UQ_cases_code" UNIQUE ("case_code"),
        CONSTRAINT "FK_cases_patient" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_cases_user" FOREIGN KEY ("assigned_user_id") REFERENCES "users"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_cases_session" FOREIGN KEY ("work_session_id") REFERENCES "work_sessions"("id") ON DELETE SET NULL,
        CONSTRAINT "CHK_cases_mode" CHECK ("study_mode" IN ('pretest','postest','produccion')),
        CONSTRAINT "CHK_cases_status" CHECK ("status" IN ('draft','in_review','ai_processed','diagnosed','closed')),
        CONSTRAINT "CHK_cases_ground_truth" CHECK ("ground_truth_iga" IS NULL OR "ground_truth_iga" IN ('sin_lesiones','casi_sin_lesiones','leve','moderado','severo'))
      )`);
    await queryRunner.query(`CREATE INDEX "IDX_cases_patient" ON "cases" ("patient_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_cases_user" ON "cases" ("assigned_user_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_cases_mode" ON "cases" ("study_mode")`);
    await queryRunner.query(`CREATE INDEX "IDX_cases_status" ON "cases" ("status")`);
    await queryRunner.query(`CREATE INDEX "IDX_cases_synthetic" ON "cases" ("is_synthetic")`);
    await queryRunner.query(`CREATE INDEX "IDX_cases_session" ON "cases" ("work_session_id")`);
    await queryRunner.query(
      `COMMENT ON COLUMN "cases"."ground_truth_iga" IS 'Patron de referencia comun (gold standard). Es el pivote de RF-OE2-05: TPD pretest compara el juicio manual contra esta etiqueta y TPD postest compara la prediccion de la IA contra la misma.'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "cases"."is_synthetic" IS 'Datos de demostracion generados por seed:study. Excluidos por defecto de indicadores, contrastes y exportaciones.'`,
    );

    // -- case_images ---------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "case_images" (
        "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "case_id"        uuid         NOT NULL,
        "storage_key"    varchar(255) NOT NULL,
        "storage_driver" varchar(16)  NOT NULL,
        "mime_type"      varchar(80)  NOT NULL,
        "width"          integer,
        "height"         integer,
        "size_bytes"     bigint       NOT NULL,
        "sha256"         varchar(64)  NOT NULL,
        "encrypted"      boolean      NOT NULL DEFAULT true,
        "is_heatmap"     boolean      NOT NULL DEFAULT false,
        "uploaded_by"    uuid,
        "created_at"     timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT "FK_case_images_case" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_case_images_user" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL
      )`);
    await queryRunner.query(`CREATE INDEX "IDX_case_images_case" ON "case_images" ("case_id")`);
    await queryRunner.query(
      `COMMENT ON TABLE "case_images" IS 'Imagen clinica facial. Cubre RNF-02: los bytes en el almacenamiento son ciphertext AES-256-GCM; sha256 es el digest del plaintext.'`,
    );

    // -- ai_inferences (OE2) -------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "ai_inferences" (
        "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "case_id"          uuid        NOT NULL,
        "image_id"         uuid        NOT NULL,
        "status"           varchar(20) NOT NULL DEFAULT 'pending',
        "iga_class"        varchar(24),
        "confidence"       double precision,
        "class_probs"      jsonb,
        "gags_grade"       varchar(24),
        "gags_score"       integer,
        "heatmap_image_id" uuid,
        "latency_ms"       integer,
        "model_version"    varchar(80) NOT NULL,
        "model_backend"    varchar(16) NOT NULL DEFAULT 'stub',
        "weights_checksum" varchar(64),
        "seed"             integer     NOT NULL DEFAULT 42,
        "error_message"    text,
        "created_at"       timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_ai_inferences_case" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_ai_inferences_image" FOREIGN KEY ("image_id") REFERENCES "case_images"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_ai_inferences_heatmap" FOREIGN KEY ("heatmap_image_id") REFERENCES "case_images"("id") ON DELETE SET NULL,
        CONSTRAINT "CHK_ai_inferences_status" CHECK ("status" IN ('pending','running','succeeded','failed')),
        CONSTRAINT "CHK_ai_inferences_iga" CHECK ("iga_class" IS NULL OR "iga_class" IN ('sin_lesiones','casi_sin_lesiones','leve','moderado','severo')),
        CONSTRAINT "CHK_ai_inferences_gags_grade" CHECK ("gags_grade" IS NULL OR "gags_grade" IN ('none','mild','moderate','severe','very_severe')),
        CONSTRAINT "CHK_ai_inferences_gags_score" CHECK ("gags_score" IS NULL OR ("gags_score" >= 0 AND "gags_score" <= 44)),
        CONSTRAINT "CHK_ai_inferences_confidence" CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1))
      )`);
    await queryRunner.query(`CREATE INDEX "IDX_ai_inferences_case" ON "ai_inferences" ("case_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_ai_inferences_status" ON "ai_inferences" ("status")`);
    await queryRunner.query(`CREATE INDEX "IDX_ai_inferences_created" ON "ai_inferences" ("created_at")`);
    await queryRunner.query(
      `COMMENT ON TABLE "ai_inferences" IS 'Prediccion de la CNN. Cubre OE2 (RF-OE2-01) y alimenta el checklist IIA de RF-TR-04.'`,
    );

    // -- inference_jobs ------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "inference_jobs" (
        "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "case_id"      uuid        NOT NULL,
        "image_id"     uuid        NOT NULL,
        "requested_by" uuid        NOT NULL,
        "status"       varchar(20) NOT NULL DEFAULT 'pending',
        "attempts"     integer     NOT NULL DEFAULT 0,
        "max_attempts" integer     NOT NULL DEFAULT 3,
        "locked_at"    timestamptz,
        "inference_id" uuid,
        "last_error"   text,
        "created_at"   timestamptz NOT NULL DEFAULT now(),
        "updated_at"   timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_inference_jobs_case" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_inference_jobs_status" CHECK ("status" IN ('pending','running','succeeded','failed'))
      )`);
    await queryRunner.query(`CREATE INDEX "IDX_inference_jobs_status" ON "inference_jobs" ("status")`);
    await queryRunner.query(`CREATE INDEX "IDX_inference_jobs_case" ON "inference_jobs" ("case_id")`);
    await queryRunner.query(
      `COMMENT ON TABLE "inference_jobs" IS 'Cola de inferencia respaldada por PostgreSQL. Sustituye a BullMQ/Redis mientras no haya Redis; ver TRACEABILITY.md seccion 4.'`,
    );

    // -- diagnoses (OE2 / Anexo 5) ------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "diagnoses" (
        "id"                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "case_id"                uuid        NOT NULL,
        "user_id"                uuid        NOT NULL,
        "study_mode"             varchar(20) NOT NULL,
        "iga_class"              varchar(24) NOT NULL,
        "gags_score"             integer,
        "agreement"              varchar(16),
        "ai_suggestion_accepted" boolean,
        "ai_inference_id"        uuid,
        "notes"                  text,
        "created_at"             timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_diagnoses_case" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_diagnoses_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_diagnoses_inference" FOREIGN KEY ("ai_inference_id") REFERENCES "ai_inferences"("id") ON DELETE SET NULL,
        CONSTRAINT "CHK_diagnoses_mode" CHECK ("study_mode" IN ('pretest','postest','produccion')),
        CONSTRAINT "CHK_diagnoses_iga" CHECK ("iga_class" IN ('sin_lesiones','casi_sin_lesiones','leve','moderado','severo')),
        CONSTRAINT "CHK_diagnoses_agreement" CHECK ("agreement" IS NULL OR "agreement" IN ('correcto','incorrecto')),
        CONSTRAINT "CHK_diagnoses_gags" CHECK ("gags_score" IS NULL OR ("gags_score" >= 0 AND "gags_score" <= 44))
      )`);
    await queryRunner.query(`CREATE INDEX "IDX_diagnoses_case" ON "diagnoses" ("case_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_diagnoses_user" ON "diagnoses" ("user_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_diagnoses_mode" ON "diagnoses" ("study_mode")`);
    await queryRunner.query(
      `COMMENT ON TABLE "diagnoses" IS 'Juicio del especialista (Anexo 5 digital). Cubre OE2: agreement se congela contra cases.ground_truth_iga al enviar.'`,
    );

    // -- review_timings (OE1 / Anexo 4) -------------------------------------
    await queryRunner.query(`
      CREATE TABLE "review_timings" (
        "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "case_id"          uuid        NOT NULL,
        "user_id"          uuid        NOT NULL,
        "study_mode"       varchar(20) NOT NULL,
        "t0"               timestamptz NOT NULL,
        "t1"               timestamptz,
        "duration_seconds" integer,
        "valid"            boolean     NOT NULL DEFAULT true,
        "notes"            text,
        "created_at"       timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_review_timings_case" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_review_timings_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "UQ_review_timings_case_mode" UNIQUE ("case_id","study_mode"),
        CONSTRAINT "CHK_review_timings_mode" CHECK ("study_mode" IN ('pretest','postest','produccion')),
        CONSTRAINT "CHK_review_timings_order" CHECK ("t1" IS NULL OR "t1" >= "t0")
      )`);
    await queryRunner.query(`CREATE INDEX "IDX_review_timings_mode" ON "review_timings" ("study_mode")`);
    await queryRunner.query(`CREATE INDEX "IDX_review_timings_user" ON "review_timings" ("user_id")`);
    await queryRunner.query(
      `COMMENT ON TABLE "review_timings" IS 'Cronometraje de la revision medica (Anexo 4 digital). Cubre OE1: TRi = t1 - t0, sellado por el servidor.'`,
    );

    // -- surveys (OE3 / Anexo 6) --------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "survey_responses" (
        "id"                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id"                     uuid        NOT NULL,
        "study_mode"                  varchar(20) NOT NULL,
        "points_obtained"             integer     NOT NULL,
        "total_points"                integer     NOT NULL,
        "tsp_pct"                     double precision NOT NULL,
        "mean_likert"                 double precision NOT NULL,
        "postest_cases_at_submission" integer     NOT NULL DEFAULT 0,
        "is_synthetic"                boolean     NOT NULL DEFAULT false,
        "comments"                    text,
        "submitted_at"                timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_survey_responses_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_survey_responses_mode" CHECK ("study_mode" IN ('pretest','postest','produccion')),
        CONSTRAINT "CHK_survey_responses_tsp" CHECK ("tsp_pct" >= 0 AND "tsp_pct" <= 100)
      )`);
    await queryRunner.query(`CREATE INDEX "IDX_survey_responses_user" ON "survey_responses" ("user_id")`);

    await queryRunner.query(`
      CREATE TABLE "survey_answers" (
        "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "response_id" uuid    NOT NULL,
        "item_number" integer NOT NULL,
        "score"       integer NOT NULL,
        CONSTRAINT "FK_survey_answers_response" FOREIGN KEY ("response_id") REFERENCES "survey_responses"("id") ON DELETE CASCADE,
        CONSTRAINT "UQ_survey_answers_item" UNIQUE ("response_id","item_number"),
        CONSTRAINT "CHK_survey_answers_item" CHECK ("item_number" BETWEEN 1 AND 8),
        CONSTRAINT "CHK_survey_answers_score" CHECK ("score" BETWEEN 1 AND 5)
      )`);
    await queryRunner.query(
      `COMMENT ON TABLE "survey_answers" IS 'Respuestas Likert del Anexo 6. El texto del item NO se almacena aqui: vive una sola vez en common/domain/survey.ts.'`,
    );

    // -- indicator_snapshots (RNF-05) ---------------------------------------
    await queryRunner.query(`
      CREATE TABLE "indicator_snapshots" (
        "id"                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "indicator"          varchar(8)  NOT NULL,
        "study_mode"         varchar(20) NOT NULL,
        "scope"              varchar(64) NOT NULL DEFAULT 'global',
        "value"              double precision NOT NULL,
        "unit"               varchar(16) NOT NULL,
        "n"                  integer     NOT NULL,
        "observations"       jsonb       NOT NULL,
        "descriptive"        jsonb       NOT NULL,
        "input_hash"         varchar(64) NOT NULL,
        "function_version"   varchar(40) NOT NULL,
        "includes_synthetic" boolean     NOT NULL DEFAULT false,
        "computed_by"        uuid,
        "computed_at"        timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_indicator_snapshots_key" CHECK ("indicator" IN ('TRM','TPD','TSP','TCAD')),
        CONSTRAINT "CHK_indicator_snapshots_mode" CHECK ("study_mode" IN ('pretest','postest','produccion'))
      )`);
    await queryRunner.query(`CREATE INDEX "IDX_indicator_snapshots_key" ON "indicator_snapshots" ("indicator")`);
    await queryRunner.query(`CREATE INDEX "IDX_indicator_snapshots_mode" ON "indicator_snapshots" ("study_mode")`);
    await queryRunner.query(
      `COMMENT ON TABLE "indicator_snapshots" IS 'Log inmutable de calculos de indicadores (RNF-05). Solo INSERT: nunca se actualiza ni se borra.'`,
    );

    // -- hypothesis_runs (RNF-05) -------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "hypothesis_runs" (
        "id"                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "hypothesis"         varchar(8)  NOT NULL,
        "indicator"          varchar(8)  NOT NULL,
        "design"             varchar(16) NOT NULL,
        "alpha"              double precision NOT NULL,
        "alternative"        varchar(16) NOT NULL,
        "n_pairs"            integer     NOT NULL,
        "pretest_mean"       double precision NOT NULL,
        "postest_mean"       double precision NOT NULL,
        "mean_difference"    double precision NOT NULL,
        "normality"          jsonb       NOT NULL,
        "test_applied"       varchar(24) NOT NULL,
        "statistic"          double precision NOT NULL,
        "p_value"            double precision NOT NULL,
        "effect_size"        jsonb,
        "rejects_null"       boolean     NOT NULL,
        "conclusion"         text        NOT NULL,
        "pairs"              jsonb       NOT NULL,
        "seed"               integer     NOT NULL DEFAULT 42,
        "function_version"   varchar(40) NOT NULL,
        "input_hash"         varchar(64) NOT NULL,
        "includes_synthetic" boolean     NOT NULL DEFAULT false,
        "executed_by"        uuid,
        "executed_at"        timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_hypothesis_runs_key" CHECK ("hypothesis" IN ('HE1','HE2','HE3','HE4')),
        CONSTRAINT "CHK_hypothesis_runs_design" CHECK ("design" IN ('paired','one_sample')),
        CONSTRAINT "CHK_hypothesis_runs_test" CHECK ("test_applied" IN ('ttest_rel','wilcoxon','ttest_1samp','wilcoxon_1samp')),
        CONSTRAINT "CHK_hypothesis_runs_alternative" CHECK ("alternative" IN ('two-sided','less','greater')),
        CONSTRAINT "CHK_hypothesis_runs_p" CHECK ("p_value" >= 0 AND "p_value" <= 1)
      )`);
    await queryRunner.query(`CREATE INDEX "IDX_hypothesis_runs_key" ON "hypothesis_runs" ("hypothesis")`);
    await queryRunner.query(
      `COMMENT ON TABLE "hypothesis_runs" IS 'Log inmutable de contrastes de hipotesis (RNF-05). Guarda datos pareados, semilla, alpha, normalidad, prueba aplicada y version de la funcion: reejecutable identicamente.'`,
    );

    // -- audit_logs (RNF-02) -------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "audit_logs" (
        "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id"     uuid,
        "user_email"  varchar(180),
        "action"      varchar(64)  NOT NULL,
        "entity_type" varchar(40)  NOT NULL,
        "entity_id"   uuid,
        "ip_address"  varchar(64),
        "user_agent"  varchar(255),
        "metadata"    jsonb,
        "created_at"  timestamptz  NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(`CREATE INDEX "IDX_audit_logs_user" ON "audit_logs" ("user_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_audit_logs_action" ON "audit_logs" ("action")`);
    await queryRunner.query(`CREATE INDEX "IDX_audit_logs_entity" ON "audit_logs" ("entity_type")`);
    await queryRunner.query(`CREATE INDEX "IDX_audit_logs_created" ON "audit_logs" ("created_at")`);
    await queryRunner.query(
      `COMMENT ON TABLE "audit_logs" IS 'Traza de auditoria append-only. Cubre RNF-02: cada acceso a imagen, cada descifrado de identidad y cada exportacion de dataset.'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "audit_logs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "hypothesis_runs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "indicator_snapshots"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "survey_answers"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "survey_responses"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "review_timings"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "diagnoses"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "inference_jobs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "ai_inferences"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "case_images"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "cases"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "work_sessions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "consents"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "patients"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "users"`);
  }
}
