import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import type { StudyMode } from 'src/common/domain';
import { round } from 'src/common/utils/descriptive';

import type { Anexo7RowDto } from './dto/anexo7.dto';
import type { CloseSessionDto, OpenSessionDto, WorkSessionDto } from './dto/session.dto';
import { WorkSession } from './work-session.entity';

/**
 * Work journeys (jornadas) — the digital Anexo 7 and the source of TCAD.
 *
 * Covers: OE4 (RF-OE4-01, RF-OE4-02). The split of responsibilities follows the instrument:
 * NCR is COUNTED by the system (it knows which cases were closed inside the journey) and TJ is
 * DECLARED by the professional at closing time.
 */
@Injectable()
export class SessionsService {
  constructor(
    @InjectRepository(WorkSession)
    private readonly repository: Repository<WorkSession>,
  ) {}

  async open(userId: string, studyMode: StudyMode, dto: OpenSessionDto): Promise<WorkSession> {
    const active = await this.findActive(userId);
    if (active !== null) {
      throw new BadRequestException(
        `Ya tiene una jornada abierta desde ${active.startedAt.toISOString()}. Ciérrela antes de abrir otra.`,
      );
    }
    const session = this.repository.create({
      userId,
      studyMode,
      shift: dto.shift,
      startedAt: new Date(),
      endedAt: null,
      casesReviewed: 0,
      notes: dto.notes ?? null,
    });
    return this.repository.save(session);
  }

  async close(userId: string, dto: CloseSessionDto): Promise<WorkSession> {
    const session = await this.findActive(userId);
    if (session === null) throw new NotFoundException('No tiene ninguna jornada abierta.');

    session.endedAt = new Date();
    session.declaredDurationHours = dto.declaredDurationHours;
    // TCAD = NCR / TJ, frozen here so the Anexo 7 row is immutable evidence (RF-OE4-02).
    session.tcad = round(session.casesReviewed / dto.declaredDurationHours, 4);
    if (dto.notes !== undefined) session.notes = dto.notes;

    return this.repository.save(session);
  }

  async findActive(userId: string): Promise<WorkSession | null> {
    return this.repository.findOne({
      where: { userId, endedAt: IsNull() },
      order: { startedAt: 'DESC' },
    });
  }

  /**
   * Increments NCR for the professional's open journey, if any.
   * Returns the journey id so the case can be linked to it, or `null` when no journey is open —
   * reviewing without an open journey is allowed, it simply contributes nothing to TCAD.
   */
  async countReviewedCase(userId: string): Promise<string | null> {
    const session = await this.findActive(userId);
    if (session === null) return null;
    await this.repository.increment({ id: session.id }, 'casesReviewed', 1);
    return session.id;
  }

  async findAll(userId?: string, studyMode?: StudyMode): Promise<WorkSession[]> {
    const query = this.repository
      .createQueryBuilder('session')
      .leftJoinAndSelect('session.user', 'user')
      .orderBy('session.startedAt', 'DESC');
    if (userId !== undefined) query.andWhere('session.userId = :userId', { userId });
    if (studyMode !== undefined) query.andWhere('session.studyMode = :studyMode', { studyMode });
    return query.getMany();
  }

  /**
   * Rows of the digital Anexo 7: N.º, fecha, jornada/turno, NCR, TJ.
   * Covers: RF-OE4-01.
   */
  async anexo7Rows(studyMode: StudyMode | null, includeSynthetic: boolean): Promise<Anexo7RowDto[]> {
    const query = this.repository
      .createQueryBuilder('session')
      .leftJoinAndSelect('session.user', 'user')
      .where('session.endedAt IS NOT NULL')
      .orderBy('session.startedAt', 'ASC');
    if (studyMode !== null) query.andWhere('session.studyMode = :studyMode', { studyMode });
    if (!includeSynthetic) query.andWhere('session.isSynthetic = false');

    const sessions = await query.getMany();
    return sessions.map((session, index) => ({
      number: index + 1,
      id: session.id,
      date: session.startedAt.toISOString().slice(0, 10),
      professional: session.user?.fullName ?? '—',
      shift: session.shift,
      studyMode: session.studyMode,
      casesReviewed: session.casesReviewed,
      durationHours: session.declaredDurationHours,
      tcad: session.tcad,
      isSynthetic: session.isSynthetic,
    }));
  }

  toResponse(session: WorkSession): WorkSessionDto {
    return {
      id: session.id,
      userId: session.userId,
      userFullName: session.user?.fullName ?? '',
      studyMode: session.studyMode,
      shift: session.shift,
      startedAt: session.startedAt.toISOString(),
      endedAt: session.endedAt?.toISOString() ?? null,
      declaredDurationHours: session.declaredDurationHours,
      casesReviewed: session.casesReviewed,
      tcad: session.tcad,
      isSynthetic: session.isSynthetic,
      notes: session.notes,
    };
  }
}

