import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { ClinicalCase } from 'src/cases/case.entity';
import {
  LIKERT_ITEMS,
  LIKERT_MAX_SCORE,
  LIKERT_TOTAL_POINTS,
  evaluateTarget,
  type StudyMode,
} from 'src/common/domain';
import { mean, round, standardDeviation } from 'src/common/utils/descriptive';
import { APP_CONFIG, type AppConfig } from 'src/config/configuration';
import { Diagnosis } from 'src/diagnoses/diagnosis.entity';

import type {
  SubmitSurveyDto,
  SurveyResponseSummaryDto,
  SurveyStatusDto,
  SurveySummaryDto,
} from './dto/survey.dto';
import { SurveyAnswer } from './survey-answer.entity';
import { SurveyResponse } from './survey-response.entity';

/**
 * Anexo 6 — Likert questionnaire and TSP.
 *
 * Covers: OE3 (RF-OE3-01 .. RF-OE3-04). TSP = (Σ PO / PT) × 100.
 */
@Injectable()
export class SurveysService {
  constructor(
    @InjectRepository(SurveyResponse) private readonly responses: Repository<SurveyResponse>,
    @InjectRepository(SurveyAnswer) private readonly answers: Repository<SurveyAnswer>,
    @InjectRepository(Diagnosis) private readonly diagnoses: Repository<Diagnosis>,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * RF-OE3-02: the questionnaire fires once the professional has completed N postest cases
   * (N = `SURVEY_TRIGGER_CASES`, 10 by default). Asking before that would measure an opinion
   * formed on too little exposure to the system.
   */
  async status(userId: string): Promise<SurveyStatusDto> {
    const [completed, postestCases] = await Promise.all([
      this.responses.count({ where: { userId, studyMode: 'postest' } }),
      this.countPostestCases(userId),
    ]);
    const threshold = this.config.study.surveyTriggerCases;
    return {
      due: completed === 0 && postestCases >= threshold,
      completed: completed > 0,
      postestCasesCompleted: postestCases,
      triggerThreshold: threshold,
    };
  }

  async submit(
    userId: string,
    studyMode: StudyMode,
    dto: SubmitSurveyDto,
    isSynthetic = false,
  ): Promise<SurveyResponseSummaryDto> {
    this.validateAnswers(dto);

    const existing = await this.responses.count({ where: { userId, studyMode } });
    if (existing > 0) {
      throw new BadRequestException(
        'Ya registró el cuestionario de satisfacción. El instrumento del Anexo 6 se aplica una única vez por profesional.',
      );
    }

    const scores = dto.answers.map((a) => a.score);
    const pointsObtained = scores.reduce((acc, s) => acc + s, 0);
    const meanLikert = round(mean(scores), 4);
    const tspPct = round((pointsObtained / LIKERT_TOTAL_POINTS) * 100, 4);
    const postestCases = await this.countPostestCases(userId);

    const saved = await this.dataSource.transaction(async (manager) => {
      const response = await manager.getRepository(SurveyResponse).save(
        manager.getRepository(SurveyResponse).create({
          userId,
          studyMode,
          pointsObtained,
          totalPoints: LIKERT_TOTAL_POINTS,
          tspPct,
          meanLikert,
          postestCasesAtSubmission: postestCases,
          isSynthetic,
          comments: dto.comments ?? null,
        }),
      );

      await manager.getRepository(SurveyAnswer).insert(
        dto.answers.map((answer) => ({
          responseId: response.id,
          itemNumber: answer.itemNumber,
          score: answer.score,
        })),
      );
      return response;
    });

    return this.toResponseSummary(saved, '');
  }

  /** Per-item and global TSP. Covers: RF-OE3-03, RF-OE3-04. */
  async summary(includeSynthetic = false): Promise<SurveySummaryDto> {
    const query = this.responses
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.answers', 'a');
    if (!includeSynthetic) query.where('r.isSynthetic = false');
    const responses = await query.getMany();

    if (responses.length === 0) {
      return {
        respondents: 0,
        tspPct: 0,
        meanLikert: 0,
        items: LIKERT_ITEMS.map((item) => ({
          itemNumber: item.number,
          text: item.text,
          mean: 0,
          sd: 0,
          tspPct: 0,
          distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
        })),
        targetMet: null,
        alert: null,
      };
    }

    const totalObtained = responses.reduce((acc, r) => acc + r.pointsObtained, 0);
    const totalPossible = responses.reduce((acc, r) => acc + r.totalPoints, 0);
    const globalTsp = round((totalObtained / totalPossible) * 100, 2);
    const globalMean = round(mean(responses.map((r) => r.meanLikert)), 2);

    const items = LIKERT_ITEMS.map((item) => {
      const scores = responses
        .flatMap((r) => r.answers ?? [])
        .filter((a) => a.itemNumber === item.number)
        .map((a) => a.score);

      const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      for (const score of scores) distribution[score] = (distribution[score] ?? 0) + 1;

      return {
        itemNumber: item.number,
        text: item.text,
        mean: round(mean(scores), 2),
        sd: round(standardDeviation(scores), 2),
        tspPct:
          scores.length === 0
            ? 0
            : round(
                (scores.reduce((acc, s) => acc + s, 0) / (scores.length * LIKERT_MAX_SCORE)) * 100,
                2,
              ),
        distribution,
      };
    });

    const evaluation = evaluateTarget('TSP', {
      pretest: null,
      postest: globalTsp,
      meanLikert: globalMean,
    });

    return {
      respondents: responses.length,
      tspPct: globalTsp,
      meanLikert: globalMean,
      items,
      targetMet: evaluation.targetMet,
      alert: evaluation.alert,
    };
  }

  /** Per-respondent TSP values; the sample the one-sample contrast of HE3 consumes. */
  async tspValues(includeSynthetic = false): Promise<Array<{ userId: string; tspPct: number }>> {
    const query = this.responses.createQueryBuilder('r').select('r.userId', 'userId').addSelect('r.tspPct', 'tspPct');
    if (!includeSynthetic) query.where('r.isSynthetic = false');
    const rows = await query.getRawMany<{ userId: string; tspPct: string | number }>();
    return rows.map((row) => ({ userId: row.userId, tspPct: Number(row.tspPct) }));
  }

  async findAll(includeSynthetic = false): Promise<SurveyResponseSummaryDto[]> {
    const query = this.responses
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.user', 'user')
      .orderBy('r.submittedAt', 'DESC');
    if (!includeSynthetic) query.where('r.isSynthetic = false');
    const responses = await query.getMany();
    return responses.map((r) => this.toResponseSummary(r, r.user?.fullName ?? ''));
  }

  private async countPostestCases(userId: string): Promise<number> {
    return this.diagnoses.count({ where: { userId, studyMode: 'postest' } });
  }

  private validateAnswers(dto: SubmitSurveyDto): void {
    const seen = new Set<number>();
    for (const answer of dto.answers) {
      if (seen.has(answer.itemNumber)) {
        throw new BadRequestException(`El ítem ${answer.itemNumber} está repetido.`);
      }
      seen.add(answer.itemNumber);
    }
    const missing = LIKERT_ITEMS.filter((item) => !seen.has(item.number)).map((i) => i.number);
    if (missing.length > 0) {
      throw new BadRequestException(`Faltan respuestas para los ítems: ${missing.join(', ')}.`);
    }
  }

  private toResponseSummary(response: SurveyResponse, fullName: string): SurveyResponseSummaryDto {
    return {
      id: response.id,
      userId: response.userId,
      userFullName: response.user?.fullName ?? fullName,
      studyMode: response.studyMode,
      pointsObtained: response.pointsObtained,
      totalPoints: response.totalPoints,
      tspPct: response.tspPct,
      meanLikert: response.meanLikert,
      submittedAt: response.submittedAt.toISOString(),
      isSynthetic: response.isSynthetic,
    };
  }
}
