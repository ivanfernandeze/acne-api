import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';

import { EncryptionService } from 'src/common/crypto/encryption.service';
import { matchesSearch } from 'src/common/utils/search-text';
import { nextSequentialCode, withCodeRetry } from 'src/common/utils/sequential-code';
import { CONSENT_CURRENT_VERSION, type IgaClass } from 'src/common/domain';

import { Consent } from './consent.entity';
import type {
  CreatePatientDto,
  PatientIdentityDto,
  PatientResponseDto,
  UpdatePatientDto,
} from './dto/patient.dto';
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
    const patient = await withCodeRetry(async () =>
      this.dataSource.transaction(async (manager) => {
      const code = await nextSequentialCode(
        manager,
        'pacientes',
        'codigo_paciente',
        `PAC-${new Date().getFullYear()}-`,
      );
      const entity = manager.getRepository(Patient).create({
        patientCode: code,
        encryptedFullName: this.encryption.encryptString(dto.fullName),
        encryptedDocumentId: this.encryption.encryptOptional(dto.documentId),
        encryptedPhone: this.encryption.encryptOptional(dto.phone),
        encryptedEmail: this.encryption.encryptOptional(dto.email),
        birthDate: dto.birthDate ?? null,
        sex: dto.sex ?? null,
        fitzpatrickPhototype: dto.fitzpatrickPhototype ?? null,
        consentAcceptedAt: dto.consentAccepted ? new Date() : null,
        createdBy,
      });
      const saved = await manager.getRepository(Patient).save(entity);

      if (dto.consentAccepted) {
        await manager.getRepository(Consent).insert({
          patientId: saved.id,
          version: dto.consentVersion ?? CONSENT_CURRENT_VERSION,
          accepted: true,
          acceptedAt: new Date(),
          ipAddress,
        });
      }
      return saved;
      }),
    );

    return this.toResponse(patient);
  }

  /**
   * The patient list, in one method for every caller.
   *
   * `revealIdentity` decides whether the encrypted name is decrypted and returned; it does NOT
   * decide whether `search` works. Those two used to be the same branch, and the result was that
   * `admin` and `evaluador_estadistico` — the roles RF-TR-03 keeps away from the identity — got the
   * whole census back for any search term, silently. Two code paths for one question is how that
   * bug happened; there is one now.
   *
   * Search runs in memory after decryption because the name is ciphertext and no SQL `LIKE` can
   * reach it. Without identity it still matches the patient code, which is the only handle those
   * roles have. Fine for a census of this size; a production registry would need a blind index.
   */
  async findAll(options: {
    includeWithdrawn?: boolean;
    search?: string;
    revealIdentity?: boolean;
  } = {}): Promise<PatientResponseDto[]> {
    const reveal = options.revealIdentity === true;
    const query = this.repository
      .createQueryBuilder('patient')
      .orderBy('patient.patientCode', 'ASC');
    if (reveal) query.addSelect('patient.encryptedFullName');
    if (options.includeWithdrawn !== true) query.where('patient.withdrawnAt IS NULL');

    const [patients, summaries] = await Promise.all([query.getMany(), this.summaries(true)]);
    const term = options.search?.trim() ?? '';

    return patients
      .map((patient) => ({
        ...this.toResponse(patient),
        ...(summaries.get(patient.id) ?? {}),
        fullName: reveal ? this.encryption.decryptOptional(patient.encryptedFullName) : null,
      }))
      .filter(
        (patient) =>
          matchesSearch(patient.patientCode, term) || matchesSearch(patient.fullName, term),
      );
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
      .addSelect([
        'patient.encryptedFullName',
        'patient.encryptedDocumentId',
        'patient.encryptedPhone',
        'patient.encryptedEmail',
      ])
      .where('patient.id = :id', { id })
      .getOne();
    if (patient === null) throw new NotFoundException(`No existe el paciente ${id}.`);

    return {
      fullName: this.encryption.decryptOptional(patient.encryptedFullName),
      documentId: this.encryption.decryptOptional(patient.encryptedDocumentId),
      phone: this.encryption.decryptOptional(patient.encryptedPhone),
      email: this.encryption.decryptOptional(patient.encryptedEmail),
    };
  }

  /** RNF-07: right to withdraw. Withdrawn patients drop out of every study dataset. */
  async withdraw(id: string, ipAddress: string | null, notes?: string): Promise<PatientResponseDto> {
    const patient = await this.findById(id);
    patient.withdrawnAt = new Date();
    const saved = await this.repository.save(patient);

    await this.consents.insert({
      patientId: id,
      version: CONSENT_CURRENT_VERSION,
      accepted: false,
      acceptedAt: new Date(),
      ipAddress,
      notes: notes ?? 'Retiro del estudio solicitado por el paciente.',
    });

    return this.toResponse(saved);
  }

  /**
   * Corrects an existing record.
   *
   * Writes with `repository.update(id, patch)` and NOT `save(entity)`, on purpose. The two
   * encrypted columns are `select: false`, so an entity loaded by `findById` does not carry them;
   * saving that entity back is how a name silently becomes null. With `update` the write surface is
   * exactly the fields the caller sent.
   */
  async update(id: string, dto: UpdatePatientDto): Promise<PatientResponseDto> {
    const patient = await this.findById(id);

    if (patient.withdrawnAt !== null) {
      // Without this the withdrawal stops meaning anything: a record excluded from the study would
      // still be editable as if it were active.
      throw new BadRequestException(
        'El paciente está retirado del estudio. Reincorpórelo antes de corregir su ficha.',
      );
    }

    const patch: QueryDeepPartialEntity<Patient> = {};
    if (dto.fullName !== undefined) {
      patch.encryptedFullName = this.encryption.encryptString(dto.fullName);
    }
    if (dto.documentId !== undefined) {
      patch.encryptedDocumentId = this.encryption.encryptOptional(dto.documentId);
    }
    if (dto.phone !== undefined) {
      patch.encryptedPhone = this.encryption.encryptOptional(dto.phone);
    }
    if (dto.email !== undefined) {
      patch.encryptedEmail = this.encryption.encryptOptional(dto.email);
    }
    if (dto.birthDate !== undefined) patch.birthDate = dto.birthDate;
    if (dto.sex !== undefined) patch.sex = dto.sex;
    if (dto.fitzpatrickPhototype !== undefined) {
      patch.fitzpatrickPhototype = dto.fitzpatrickPhototype;
    }

    if (Object.keys(patch).length > 0) await this.repository.update({ id }, patch);
    return this.toResponse(await this.findById(id));
  }

  /**
   * Undoes a withdrawal recorded by mistake (RNF-07).
   *
   * Leaves a third row in `consents` rather than deleting the withdrawal one: the table is
   * append-only, and the sequence accepted → withdrew → reinstated, each with its reason, IS the
   * evidence the requirement asks for. Erasing the middle row would leave a record that looks like
   * the withdrawal never happened.
   */
  async reinstate(id: string, notes: string, ipAddress: string | null): Promise<PatientResponseDto> {
    const patient = await this.findById(id);
    if (patient.withdrawnAt === null) {
      throw new BadRequestException('El paciente no está retirado del estudio.');
    }

    patient.withdrawnAt = null;
    const saved = await this.repository.save(patient);

    await this.consents.insert({
      patientId: id,
      version: CONSENT_CURRENT_VERSION,
      accepted: true,
      acceptedAt: new Date(),
      ipAddress,
      notes,
    });

    return this.toResponse(saved);
  }

  async findConsents(patientId: string): Promise<Consent[]> {
    return this.consents.find({ where: { patientId }, order: { createdAt: 'DESC' } });
  }

  toResponse(patient: Patient): PatientResponseDto {
    return {
      id: patient.id,
      patientCode: patient.patientCode,
      // Withheld by default; `findAll({revealIdentity:true})` fills it in for authorised roles.
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
      `SELECT c."paciente_id"        AS "patientId",
              COUNT(*)              AS "caseCount",
              MAX(c."creado_en")   AS "lastVisitAt",
              (SELECT d."clase_iga_codigo"
                 FROM "diagnosticos" d
                 JOIN "casos" c2 ON c2."id" = d."caso_id"
                WHERE c2."paciente_id" = c."paciente_id"
                ORDER BY d."creado_en" DESC
                LIMIT 1)            AS "lastSeverity"
         FROM "casos" c
        WHERE ($1::boolean OR c."es_sintetico" = false)
        GROUP BY c."paciente_id"`,
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

}
