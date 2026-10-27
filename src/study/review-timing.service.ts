import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import { ClinicalCase } from 'src/cases/case.entity';
import type { StudyMode } from 'src/common/domain';
import { Patient } from 'src/patients/patient.entity';
import { User } from 'src/users/user.entity';

import type { Anexo4RowDto } from './dto/anexo4.dto';
import { ReviewTiming } from './review-timing.entity';
import { peruDate } from 'src/common/peru-date';

/**
 * Chronometry of the medical review — the engine behind OE1 and the digital Anexo 4.
 *
 * Covers: RF-OE1-01. Both timestamps are stamped server-side with the database clock's timezone
 * semantics (`timestamptz`), never with a value sent by the browser: a client-supplied duration
 * would be unusable as thesis evidence.
 */
@Injectable()
export class ReviewTimingService {
  private readonly logger = new Logger(ReviewTimingService.name);

  constructor(
    @InjectRepository(ReviewTiming)
    private readonly repository: Repository<ReviewTiming>,
  ) {}

  /**
   * Stamps `t0` when the physician opens the case file.
   *
   * Idempotent per (case, study mode): re-opening the same case does not restart the clock, so a
   * page refresh cannot shrink the measured review time. The uniqueness is also enforced by
   * `UQ_review_timings_case_mode` at the database level.
   */
  async start(caseId: string, userId: string, studyMode: StudyMode): Promise<ReviewTiming> {
    const existing = await this.repository.findOne({ where: { caseId, studyMode } });
    if (existing !== null) return existing;

    const timing = this.repository.create({
      caseId,
      userId,
      studyMode,
      t0: new Date(),
      t1: null,
      durationSeconds: null,
      valid: true,
    });
    return this.repository.save(timing);
  }

  /**
   * Stamps `t1` when the definitive diagnosis is submitted and freezes TRi = t1 - t0.
   *
   * Returns `null` when there is no open measurement, which happens if a case is diagnosed
   * without having been opened through the portal (for example via a seeded record).
   */
  async stop(caseId: string, studyMode: StudyMode): Promise<ReviewTiming | null> {
    const timing = await this.repository.findOne({ where: { caseId, studyMode } });
    if (timing === null) {
      this.logger.warn(
        `No hay cronometraje abierto para el caso ${caseId} en modo ${studyMode}: no se registrará TR.`,
      );
      return null;
    }
    if (timing.t1 !== null) return timing;

    const t1 = new Date();
    timing.t1 = t1;
    timing.durationSeconds = Math.max(0, Math.round((t1.getTime() - timing.t0.getTime()) / 1000));
    return this.repository.save(timing);
  }

  async findForCase(caseId: string, studyMode: StudyMode): Promise<ReviewTiming | null> {
    return this.repository.findOne({ where: { caseId, studyMode } });
  }

  /**
   * La medición abierta de este caso en esta condición, si la hay.
   *
   * Abierta significa con `t0` sellado y `t1` todavía nulo: una revisión en curso. La necesita
   * quien tiene que invalidarla sin haberla iniciado él mismo, como la devolución al mostrador.
   */
  async findOpen(caseId: string, studyMode: StudyMode): Promise<ReviewTiming | null> {
    return this.repository.findOne({
      where: { caseId, studyMode, t1: IsNull(), valid: true },
    });
  }

  /** Marks a measurement as invalid so it drops out of TRM (abandoned or interrupted review). */
  async invalidate(id: string, notes: string): Promise<ReviewTiming> {
    await this.repository.update({ id }, { valid: false, notes });
    const timing = await this.repository.findOneOrFail({ where: { id } });
    return timing;
  }

  /**
   * Rows of the digital Anexo 4, in the exact shape of the paper instrument:
   * N.º, fecha, N.º de caso / ID paciente, hora de inicio de revisión, tiempo de revisión (min).
   *
   * Covers: RF-OE1-02.
   */
  async anexo4Rows(
    studyMode: StudyMode | null,
    includeSynthetic: boolean,
  ): Promise<Anexo4RowDto[]> {
    const query = this.repository
      .createQueryBuilder('timing')
      .innerJoin(ClinicalCase, 'c', 'c.id = timing.caseId')
      .innerJoin(Patient, 'p', 'p.id = c.patientId')
      .innerJoin(User, 'u', 'u.id = timing.userId')
      .select('timing.id', 'id')
      .addSelect('timing.t0', 't0')
      .addSelect('timing.t1', 't1')
      .addSelect('timing.durationSeconds', 'durationSeconds')
      .addSelect('timing.valid', 'valid')
      .addSelect('timing.studyMode', 'studyMode')
      .addSelect('c.caseCode', 'caseCode')
      .addSelect('p.patientCode', 'patientCode')
      .addSelect('u.fullName', 'professional')
      .addSelect('c.isSynthetic', 'isSynthetic')
      .orderBy('timing.t0', 'ASC');

    if (studyMode !== null) query.andWhere('timing.studyMode = :studyMode', { studyMode });
    if (!includeSynthetic) query.andWhere('c.isSynthetic = false');
    query.andWhere('c.voidedAt IS NULL');

    const raw = await query.getRawMany<RawAnexo4Row>();
    return raw.map((row, index) => ({
      number: index + 1,
      id: row.id,
      date: peruDate(row.t0),
      caseCode: row.caseCode,
      patientCode: row.patientCode,
      professional: row.professional,
      studyMode: row.studyMode,
      startTime: new Date(row.t0).toISOString(),
      endTime: row.t1 === null ? null : new Date(row.t1).toISOString(),
      reviewMinutes: row.durationSeconds === null ? null : row.durationSeconds / 60,
      valid: row.valid,
      isSynthetic: row.isSynthetic,
    }));
  }
}

interface RawAnexo4Row {
  id: string;
  t0: string;
  t1: string | null;
  durationSeconds: number | null;
  valid: boolean;
  studyMode: StudyMode;
  caseCode: string;
  patientCode: string;
  professional: string;
  isSynthetic: boolean;
}

