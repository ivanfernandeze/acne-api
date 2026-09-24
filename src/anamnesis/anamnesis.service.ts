import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import {
  ANAMNESIS_ADULT_AGE,
  ANAMNESIS_VERSION,
  hasPregnancyFlag,
  validateAnamnesisAnswer,
  type AnamnesisAnswer,
  type AnamnesisQuestion,
} from 'src/common/domain';
import { QuestionsService } from 'src/questions/questions.service';

import { AnamnesisAnswerRepository, type AnswerMap } from './anamnesis-answer.repository';
import { CaseAnamnesis } from './case-anamnesis.entity';
import type {
  AnamnesisPrefillDto,
  AnamnesisResponseDto,
  SaveAnamnesisDto,
} from './dto/anamnesis.dto';

interface PatientProfile {
  patientId: string;
  sex: string | null;
  birthDate: string | null;
}

/**
 * Acne anamnesis of a case.
 *
 * EXTENSION requested by the research team — no numbered requirement of `requisitos.md` backs it
 * (see TRACEABILITY.md). It informs the specialist's reference judgement of RF-OE2-01 and, since
 * 03/09/2026, is also handed to a backend able to reason over text — anonymised, and without ever
 * deciding the grade, which the image fixes. See `inference/clinical-context.ts`.
 *
 * The questionnaire is NOT gated by study mode: it must look identical in pretest and postest. If
 * it appeared only with the AI, the paired contrast of HE₁ and HE₂ would be measuring
 * "anamnesis + IA" against "nothing", and the experiment would no longer isolate the intervention.
 */
/** Una pregunta tal como la sirve `QuestionsService.catalogue()`. */
type CatalogueQuestion = Awaited<ReturnType<QuestionsService['catalogue']>>[number];

/**
 * Las preguntas que aplican a un paciente.
 *
 * Réplica de `anamnesisQuestionsFor` del dominio, pero sobre el catálogo SERVIDO. La regla es la
 * misma —el bloque hormonal solo para mujeres desde los 18— y vive aquí porque ahora el conjunto de
 * preguntas lo decide la base y no una constante.
 */
function applicableQuestions(
  catalogue: CatalogueQuestion[],
  sex: string | null | undefined,
  ageYears: number | null | undefined,
): CatalogueQuestion[] {
  const hormonal =
    sex === 'femenino' && ageYears !== null && ageYears !== undefined
      ? ageYears >= ANAMNESIS_ADULT_AGE
      : false;
  return catalogue.filter((question) => question.scope === 'siempre' || hormonal);
}

/** Adapta la fila servida a la forma que espera `validateAnamnesisAnswer`. */
function toDomainShape(question: CatalogueQuestion): AnamnesisQuestion {
  return {
    key: question.key,
    number: question.number,
    section: question.section as AnamnesisQuestion['section'],
    text: question.text,
    type: question.type as AnamnesisQuestion['type'],
    scope: question.scope as AnamnesisQuestion['scope'],
    required: question.required,
    ...(question.options !== undefined ? { options: question.options } : {}),
    ...(question.unit !== undefined ? { unit: question.unit } : {}),
    ...(question.detail !== undefined ? { detail: question.detail } : {}),
    ...(question.hint !== undefined ? { hint: question.hint } : {}),
  };
}

@Injectable()
export class AnamnesisService {
  constructor(
    @InjectRepository(CaseAnamnesis) private readonly repository: Repository<CaseAnamnesis>,
    private readonly answers: AnamnesisAnswerRepository,
    private readonly dataSource: DataSource,
    private readonly questions: QuestionsService,
  ) {}

  /**
   * The raw answers of a case, or an empty record when the questionnaire was never saved.
   *
   * For callers that derive a flag from the history and must not fail when there is none — the
   * case file is readable with or without anamnesis.
   */
  /** Sex and age of the case's patient, for rules that depend on them (never identity). */
  async profileForCase(caseId: string): Promise<{ sex: string | null; ageYears: number | null }> {
    const profile = await this.patientProfile(caseId);
    return { sex: profile.sex, ageYears: ageFrom(profile.birthDate) ?? null };
  }

  async answersForCase(caseId: string): Promise<Record<string, AnamnesisAnswer>> {
    const record = await this.repository.findOne({ where: { caseId } });
    return record === null ? {} : this.answers.read(record.id);
  }

  async findByCase(caseId: string): Promise<AnamnesisResponseDto> {
    const record = await this.repository.findOne({ where: { caseId } });
    if (record === null) {
      throw new NotFoundException(`El caso ${caseId} todavía no tiene anamnesis registrada.`);
    }
    const profile = await this.patientProfile(caseId);
    return await this.toResponse(record, profile, await this.answers.read(record.id));
  }

  /** Upsert: the intake screen saves as the technician fills it in, and a later edit overwrites. */
  async save(
    caseId: string,
    dto: SaveAnamnesisDto,
    userId: string,
  ): Promise<AnamnesisResponseDto> {
    const profile = await this.patientProfile(caseId);
    const catalogue = await this.questions.catalogue();
    const applicable = applicableQuestions(catalogue, profile.sex, ageFrom(profile.birthDate));
    const applicableKeys = new Set(applicable.map((question) => question.key));

    this.validate(dto.answers, applicableKeys, catalogue);

    // Header and answers move together: a saved header whose rows failed to write would claim an
    // anamnesis that is not there, and the intake screen would show it as taken.
    const saved = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(CaseAnamnesis);
      const existing = await repository.findOne({ where: { caseId } });
      const entity =
        existing ??
        repository.create({ caseId, version: ANAMNESIS_VERSION, complete: false });

      entity.complete = dto.complete ?? false;
      entity.completedBy = userId;
      entity.prefilledFromCaseId = dto.prefilledFromCaseId ?? entity.prefilledFromCaseId ?? null;
      // Stamped on every save, not only on insert: an edit re-answers against today's catalogue.
      entity.version = ANAMNESIS_VERSION;

      const row = await repository.save(entity);
      await this.answers.write(manager, row.id, dto.answers);
      return row;
    });

    return await this.toResponse(saved, profile, dto.answers);
  }

  /**
   * The most recent anamnesis of the same patient, to offer as a starting point.
   *
   * Returns `null` rather than throwing: a first-time patient having no previous visit is the normal
   * case, not an error.
   */
  async latestForPatient(
    patientId: string,
    excludeCaseId?: string,
  ): Promise<AnamnesisPrefillDto | null> {
    const rows = await this.dataSource.query<
      Array<{
        id: string;
        caseId: string;
        caseCode: string;
        visitedAt: string;
        version: string;
      }>
    >(
      `SELECT a."id", a."caso_id" AS "caseId", c."codigo_caso" AS "caseCode",
              c."creado_en" AS "visitedAt", a."version_cuestionario" AS "version"
         FROM "anamnesis_caso" a
         JOIN "casos" c ON c."id" = a."caso_id"
        WHERE c."paciente_id" = $1
          AND ($2::uuid IS NULL OR a."caso_id" <> $2::uuid)
        ORDER BY c."creado_en" DESC
        LIMIT 1`,
      [patientId, excludeCaseId ?? null],
    );

    const row = rows[0];
    if (row === undefined) return null;
    return {
      caseId: row.caseId,
      caseCode: row.caseCode,
      visitedAt: new Date(row.visitedAt).toISOString(),
      version: row.version,
      answers: await this.answers.read(row.id),
    };
  }

  /**
   * Compact view for the longitudinal history, where dumping 21 answers per visit would drown the
   * timeline. Returns `null` when the case has no anamnesis.
   */
  async summariesForCases(
    caseIds: readonly string[],
  ): Promise<Map<string, { complete: boolean; version: string; pregnancyFlag: boolean; answeredCount: number }>> {
    if (caseIds.length === 0) return new Map();

    const rows = await this.dataSource.query<
      Array<{ id: string; caseId: string; complete: boolean; version: string }>
    >(
      `SELECT "id", "caso_id" AS "caseId", "completa" AS "complete",
              "version_cuestionario" AS "version"
         FROM "anamnesis_caso"
        WHERE "caso_id" = ANY($1)`,
      [caseIds],
    );

    // One batched read for every visit in the timeline. Reading the answers per row would be an
    // N+1 over exactly the screen that shows the most cases at once.
    const answersById = await this.answers.readMany(rows.map((row) => row.id));

    return new Map(
      rows.map((row) => {
        const answers = answersById.get(row.id) ?? {};
        return [
          row.caseId,
          {
            complete: row.complete,
            version: row.version,
            pregnancyFlag: hasPregnancyFlag(answers),
            answeredCount: countAnswered(answers),
          },
        ];
      }),
    );
  }

  /**
   * Checks the submitted map against the catalogue.
   *
   * Two separate reasons to reject, and they mean different things to the caller: an unknown key is
   * a client out of step with the catalogue, while an out-of-range value is a bad answer.
   */
  private validate(
    answers: Record<string, AnamnesisAnswer>,
    applicableKeys: Set<string>,
    catalogue: CatalogueQuestion[],
  ): void {
    const problems: string[] = [];
    // Del CATÁLOGO SERVIDO, no de la constante: una pregunta creada desde el portal tiene que
    // poder responderse de inmediato, y contra la constante sería «una pregunta que no existe».
    const byKey = new Map(catalogue.map((question) => [question.key, question]));

    for (const [key, answer] of Object.entries(answers)) {
      const question = byKey.get(key);
      if (question === undefined) {
        problems.push(`"${key}" no es una pregunta del cuestionario de acné.`);
        continue;
      }
      if (!applicableKeys.has(key)) {
        problems.push(`"${key}" no aplica al sexo y la edad de este paciente.`);
        continue;
      }
      if (answer === null || typeof answer !== 'object' || !('value' in answer)) {
        problems.push(`La respuesta de "${key}" debe ser un objeto con la clave "value".`);
        continue;
      }
      const problem = validateAnamnesisAnswer(toDomainShape(question), answer);
      if (problem !== null) problems.push(problem);
    }

    if (problems.length > 0) throw new BadRequestException(problems);
  }

  private async patientProfile(caseId: string): Promise<PatientProfile> {
    const rows = await this.dataSource.query<
      Array<{ patientId: string; sex: string | null; birthDate: string | null }>
    >(
      `SELECT p."id" AS "patientId", p."sexo_codigo" AS "sex",
              p."fecha_nacimiento" AS "birthDate"
         FROM "casos" c
         JOIN "pacientes" p ON p."id" = c."paciente_id"
        WHERE c."id" = $1`,
      [caseId],
    );

    const profile = rows[0];
    if (profile === undefined) throw new NotFoundException(`No existe el caso ${caseId}.`);
    return profile;
  }

  private async toResponse(
    record: CaseAnamnesis,
    profile: PatientProfile,
    answers: AnswerMap,
  ): Promise<AnamnesisResponseDto> {
    const applicable = applicableQuestions(
      await this.questions.catalogue(),
      profile.sex,
      ageFrom(profile.birthDate),
    );
    return {
      caseId: record.caseId,
      version: record.version,
      answers,
      complete: record.complete,
      answeredCount: countAnswered(answers),
      applicableCount: applicable.length,
      pregnancyFlag: hasPregnancyFlag(answers),
      prefilledFromCaseId: record.prefilledFromCaseId,
      completedBy: record.completedBy,
      updatedAt: record.updatedAt.toISOString(),
    };
  }
}

/** An answer counts as given when it carries a value or a free-text detail. */
function countAnswered(answers: Record<string, AnamnesisAnswer>): number {
  return Object.values(answers).filter((answer) => {
    if (answer === null || typeof answer !== 'object') return false;
    if (Array.isArray(answer.value)) return answer.value.length > 0;
    if (answer.value !== null && answer.value !== undefined && answer.value !== '') return true;
    return typeof answer.detail === 'string' && answer.detail.trim() !== '';
  }).length;
}

function ageFrom(birthDate: string | null): number | null {
  if (birthDate === null) return null;
  const born = new Date(birthDate);
  if (Number.isNaN(born.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - born.getFullYear();
  const monthDiff = now.getMonth() - born.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < born.getDate())) age--;
  return age;
}
