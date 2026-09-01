import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { EncryptionService } from 'src/common/crypto/encryption.service';
import { CONSENT_CURRENT_VERSION } from 'src/common/domain';

import { Consent } from './consent.entity';
import type { CreatePatientDto, PatientIdentityDto, PatientResponseDto } from './dto/patient.dto';
import { Patient } from './patient.entity';

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
    const patients = await query.getMany();
    return patients.map((p) => this.toResponse(p));
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
      birthDate: patient.birthDate,
      ageYears: this.ageFromBirthDate(patient.birthDate),
      sex: patient.sex,
      fitzpatrickPhototype: patient.fitzpatrickPhototype,
      consentAcceptedAt: patient.consentAcceptedAt?.toISOString() ?? null,
      withdrawnAt: patient.withdrawnAt?.toISOString() ?? null,
      createdAt: patient.createdAt.toISOString(),
    };
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
