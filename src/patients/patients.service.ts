import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { EncryptionService } from 'src/common/crypto/encryption.service';
import { CONSENT_CURRENT_VERSION, type IgaClass } from 'src/common/domain';

import { Consent } from './consent.entity';
import type { CreatePatientDto, PatientIdentityDto, PatientResponseDto } from './dto/patient.dto';
import { Patient } from './patient.entity';

interface PatientSummaryFields {
  caseCount: number;
  lastVisitAt: string | null;
  lastSeverity: IgaClass | null;
}

/** Covers: RF-TR-03 (anonymisation) and RNF-07 (consent, right to withdraw). */
@Injectable()
export class PatientsService {
  constructor(
    @InjectRepository(Patient) private readonly repository: Repository<Patient>,
    @InjectRepository(Consent) private readonly consents: Repository<Consent>,
    private readonly encryption: EncryptionService,
    private readonly dataSource: DataSource,
  ) {}

  async create(
    dto: CreatePatientDto,
    createdBy: string,
    ipAddress: string | null,
  ): Promise<PatientResponseDto> {
    const patient = await this.dataSource.transaction(async (manager) => {
      const code = await this.nextPatientCode(manager.getRepository(Patient));
      const entity = manager.getRepository(Patient).create({
        patientCode: code,
        encryptedFullName: this.encryption.encryptString(dto.fullName),
        encryptedDocumentId: this.encryption.encryptOptional(dto.documentId),
        birthDate: dto.birthDate ?? null,
        sex: dto.sex ?? null,
        fitzpatrickPhototype: dto.fitzpatrickPhototype ?? null,
        consentAcceptedAt: dto.consentAccepted ? new Date() : null,
        createdBy,
      });
      const saved = await manager.getRepository(Patient).save(entity);

      if (dto.consentAccepted) {
        await manager.getRepository(Consent).insert({
          subjectType: 'paciente',
          subjectId: saved.id,
          version: dto.consentVersion ?? CONSENT_CURRENT_VERSION,
          accepted: true,
          acceptedAt: new Date(),
          ipAddress,
        });
      }
      return saved;
    });

    return this.toResponse(patient);
  }

  async findAll(includeWithdrawn = false): Promise<PatientResponseDto[]> {
    const query = this.repository.createQueryBuilder('patient').orderBy('patient.patientCode', 'ASC');
    if (!includeWithdrawn) query.where('patient.withdrawnAt IS NULL');

    const [patients, summaries] = await Promise.all([query.getMany(), this.summaries(true)]);
    return patients.map((p) => ({ ...this.toResponse(p), ...(summaries.get(p.id) ?? {}) }));
  }

  /** Single patient as a response DTO, optionally with the decrypted name and the summary. */
  async findResponseById(id: string, revealIdentity: boolean): Promise<PatientResponseDto> {
    const query = this.repository.createQueryBuilder('patient').where('patient.id = :id', { id });
    if (revealIdentity) query.addSelect('patient.encryptedFullName');

    const patient = await query.getOne();
    if (patient === null) throw new NotFoundException(`No existe el paciente ${id}.`);

    const summaries = await this.summaries(true);
    return {
      ...this.toResponse(patient),
      ...(summaries.get(patient.id) ?? {}),
      fullName: revealIdentity ? this.encryption.decryptOptional(patient.encryptedFullName) : null,
    };
  }

  /**
   * Patient list including the decrypted name, for the professionals who are allowed to see it.
   *
   * RF-TR-03 keeps the identity encrypted and reserves it for the treating clinician; it does not
   * ask the clinician to work blind. Choosing a patient from a list of `PAC-2026-0007` codes is
   * how the wrong case gets opened, so the name is shown to `dermatologo`/`residente` only, and
   * the CALLER must audit the access.
   *
   * Search happens in memory after decryption: the name is ciphertext in the database, so no SQL
   * `LIKE` can reach it. That is fine for the census of 30 patients this study works with; a
   * production registry would need a blind index instead.
   */
  async findAllWithIdentity(options: {
    includeWithdrawn?: boolean;
    search?: string;
  }): Promise<PatientResponseDto[]> {
    const query = this.repository
      .createQueryBuilder('patient')
      .addSelect('patient.encryptedFullName')
      .orderBy('patient.patientCode', 'ASC');
    if (options.includeWithdrawn !== true) query.where('patient.withdrawnAt IS NULL');

    const [patients, summaries] = await Promise.all([
      query.getMany(),
      this.summaries(true),
    ]);
    const term = options.search?.trim().toLowerCase() ?? '';

    return patients
      .map((patient) => ({
        ...this.toResponse(patient),
        ...(summaries.get(patient.id) ?? {}),
        fullName: this.encryption.decryptOptional(patient.encryptedFullName),
      }))
      .filter((patient) => {
        if (term === '') return true;
        return (
          patient.patientCode.toLowerCase().includes(term) ||
          (patient.fullName ?? '').toLowerCase().includes(term)
        );
      });
  }

  async findById(id: string): Promise<Patient> {
    const patient = await this.repository.findOne({ where: { id } });
    if (patient === null) throw new NotFoundException(`No existe el paciente ${id}.`);
    return patient;
  }

  /**
   * Decrypts the patient's real identity. The caller MUST write an audit entry: this is the one
   * operation in the system that undoes the anonymisation of RF-TR-03.
   */
  async revealIdentity(id: string): Promise<PatientIdentityDto> {
    const patient = await this.repository
      .createQueryBuilder('patient')
      .addSelect(['patient.encryptedFullName', 'patient.encryptedDocumentId'])
      .where('patient.id = :id', { id })
      .getOne();
    if (patient === null) throw new NotFoundException(`No existe el paciente ${id}.`);

    return {
      fullName: this.encryption.decryptOptional(patient.encryptedFullName),
      documentId: this.encryption.decryptOptional(patient.encryptedDocumentId),
    };
  }

  /** RNF-07: right to withdraw. Withdrawn patients drop out of every study dataset. */
  async withdraw(id: string, ipAddress: string | null, notes?: string): Promise<PatientResponseDto> {
    const patient = await this.findById(id);
    patient.withdrawnAt = new Date();
    const saved = await this.repository.save(patient);

    await this.consents.insert({
      subjectType: 'paciente',
      subjectId: id,
      version: CONSENT_CURRENT_VERSION,
      accepted: false,
      acceptedAt: new Date(),
      ipAddress,
      notes: notes ?? 'Retiro del estudio solicitado por el paciente.',
    });

    return this.toResponse(saved);
  }

  async findConsents(subjectId: string): Promise<Consent[]> {
    return this.consents.find({ where: { subjectId }, order: { createdAt: 'DESC' } });
  }

  toResponse(patient: Patient): PatientResponseDto {
    return {
      id: patient.id,
      patientCode: patient.patientCode,
      // Withheld by default; `findAllWithIdentity` fills it in for authorised roles.
      fullName: null,
      birthDate: patient.birthDate,
      ageYears: this.ageFromBirthDate(patient.birthDate),
      sex: patient.sex,
      fitzpatrickPhototype: patient.fitzpatrickPhototype,
      consentAcceptedAt: patient.consentAcceptedAt?.toISOString() ?? null,
      withdrawnAt: patient.withdrawnAt?.toISOString() ?? null,
      createdAt: patient.createdAt.toISOString(),
      // Filled in by the list endpoints; a single patient fetch leaves the summary empty.
      caseCount: 0,
      lastVisitAt: null,
      lastSeverity: null,
    };
  }

  /**
   * Per-patient longitudinal summary for the patient list: how many cases, when the last visit
   * was, and the severity recorded at it. Answers "who needs a follow-up" at a glance, which a
   * list of codes and dates cannot.
   */
  private async summaries(
    includeSynthetic: boolean,
  ): Promise<Map<string, PatientSummaryFields>> {
    const rows = await this.dataSource.query<
      Array<{ patientId: string; caseCount: string; lastVisitAt: string | null; lastSeverity: string | null }>
    >(
      `SELECT c."patient_id"        AS "patientId",
              COUNT(*)              AS "caseCount",
              MAX(c."created_at")   AS "lastVisitAt",
              (SELECT d."iga_class"
                 FROM "diagnoses" d
                 JOIN "cases" c2 ON c2."id" = d."case_id"
                WHERE c2."patient_id" = c."patient_id"
                ORDER BY d."created_at" DESC
                LIMIT 1)            AS "lastSeverity"
         FROM "cases" c
        WHERE ($1::boolean OR c."is_synthetic" = false)
        GROUP BY c."patient_id"`,
      [includeSynthetic],
    );

    return new Map(
      rows.map((row) => [
        row.patientId,
        {
          caseCount: Number(row.caseCount),
          lastVisitAt: row.lastVisitAt === null ? null : new Date(row.lastVisitAt).toISOString(),
          // The column is a varchar guarded by a CHECK constraint, so any value it can hold is
          // a valid IGA class; the cast records that the guarantee lives in the schema.
          lastSeverity: (row.lastSeverity as IgaClass | null) ?? null,
        },
      ]),
    );
  }

  private ageFromBirthDate(birthDate: string | null): number | null {
    if (birthDate === null) return null;
    const born = new Date(birthDate);
    if (Number.isNaN(born.getTime())) return null;
    const now = new Date();
    let age = now.getFullYear() - born.getFullYear();
    const monthDiff = now.getMonth() - born.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < born.getDate())) age--;
    return age;
  }

  /** Sequential anonymised code scoped to the current year: `PAC-2026-0001`. */
  private async nextPatientCode(repository: Repository<Patient>): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `PAC-${year}-`;
    const last = await repository
      .createQueryBuilder('patient')
      .select('patient.patientCode', 'code')
      .where('patient.patientCode LIKE :prefix', { prefix: `${prefix}%` })
      .orderBy('patient.patientCode', 'DESC')
      .limit(1)
      .getRawOne<{ code: string }>();

    const lastSequence = last === undefined ? 0 : Number(last.code.slice(prefix.length));
    const next = (Number.isFinite(lastSequence) ? lastSequence : 0) + 1;
    return `${prefix}${String(next).padStart(4, '0')}`;
  }
}
