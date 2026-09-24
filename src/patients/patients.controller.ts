import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { AuditService } from 'src/audit/audit.service';
import { CurrentUser, Roles } from 'src/common/decorators';
import { CASE_ACCESS_ROLES, DIAGNOSING_ROLES, IDENTITY_ROLES, INTAKE_ROLES, STUDY_ROLES } from 'src/common/domain';
import type {
  AuthenticatedRequest,
  AuthenticatedUser,
} from 'src/common/interfaces/authenticated-user';

import type { Consent } from './consent.entity';
import { PatientHistoryDto } from './dto/patient-history.dto';
import {
  CreatePatientDto,
  PatientIdentityDto,
  PatientResponseDto,
  ReinstatePatientDto,
  UpdatePatientDto,
  WithdrawPatientDto,
} from './dto/patient.dto';
import { PatientHistoryService } from './patient-history.service';
import { PatientsService } from './patients.service';

/**
 * Roles allowed to correct the identity document.
 *
 * Narrower than `IDENTITY_ROLES` for the same reason `GET /patients/:id/identity` is: that route is
 * the only one that returns the document, and it is closed to `tecnico`. Someone who cannot read
 * the current value cannot correct it — they can only overwrite it blind.
 */
const DOCUMENT_EDIT_ROLES: readonly string[] = DIAGNOSING_ROLES;

/** Covers: RF-TR-03, RNF-02, RNF-07. */
@ApiTags('patients')
@ApiBearerAuth()
@Controller('patients')
export class PatientsController {
  constructor(
    private readonly patientsService: PatientsService,
    private readonly patientHistoryService: PatientHistoryService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  @Roles(...CASE_ACCESS_ROLES)
  @ApiQuery({ name: 'includeWithdrawn', required: false, type: Boolean })
  @ApiQuery({
    name: 'search',
    required: false,
    description: 'Filtra por nombre o por código. Solo surte efecto para roles asistenciales.',
  })
  @ApiOperation({
    summary: 'Lista pacientes.',
    description:
      'Para los roles que pueden ver la identidad incluye el nombre descifrado, porque elegir un paciente ' +
      'de una lista de códigos es como se abre el caso equivocado (RF-TR-03 reserva la identidad ' +
      'al profesional tratante, no le pide trabajar a ciegas). Para los demás roles `fullName` ' +
      'llega en `null`. El acceso en bloque queda registrado en la traza de auditoría (RNF-02).',
  })
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: AuthenticatedRequest,
    @Query('includeWithdrawn') includeWithdrawn?: string,
    @Query('search') search?: string,
  ): Promise<PatientResponseDto[]> {
    const maySeeIdentity = this.maySeeIdentity(user);
    // `search` is passed in BOTH cases. It used to be dropped for the roles without identity, so
    // `admin` and `evaluador_estadistico` silently got the whole census back for any term.
    const patients = await this.patientsService.findAll({
      includeWithdrawn: includeWithdrawn === 'true',
      search,
      revealIdentity: maySeeIdentity,
    });

    if (!maySeeIdentity) return patients;

    // One entry for the whole listing rather than one per patient: a per-row log would bury the
    // targeted `patient.identity.read` events that actually matter under hundreds of list hits.
    await this.auditService.record(
      user,
      {
        action: 'patient.list.identity',
        entityType: 'patient',
        metadata: { count: patients.length, search: search ?? null },
      },
      request,
    );
    return patients;
  }

  @Post()
  @Roles(...INTAKE_ROLES)
  @ApiOperation({
    summary: 'Registra un paciente con consentimiento informado.',
    description:
      'El nombre y el documento se cifran con AES-256-GCM antes de tocar la base de datos ' +
      '(RF-TR-03). A partir de aquí el paciente circula por el sistema solo como `patientCode`.',
  })
  async create(
    @Body() dto: CreatePatientDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: AuthenticatedRequest,
  ): Promise<PatientResponseDto> {
    const ip = this.resolveIp(request);
    const patient = await this.patientsService.create(dto, user.id, ip);
    await this.auditService.record(
      user,
      {
        action: 'patient.create',
        entityType: 'patient',
        entityId: patient.id,
        metadata: { patientCode: patient.patientCode, consent: dto.consentAccepted },
      },
      request,
    );
    return patient;
  }

  @Get(':id')
  @Roles(...CASE_ACCESS_ROLES)
  @ApiOperation({ summary: 'Devuelve un paciente.' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PatientResponseDto> {
    return this.patientsService.findResponseById(id, this.maySeeIdentity(user));
  }

  @Get(':id/history')
  @Roles(...CASE_ACCESS_ROLES)
  @ApiQuery({ name: 'includeSynthetic', required: false, type: Boolean })
  @ApiOperation({
    summary: 'Historia clínica longitudinal del paciente.',
    description:
      'Cronología de visitas con la severidad IGA de cada una, los diagnósticos emitidos, los ' +
      'tiempos de revisión y las imágenes, más un resumen de evolución. Es la vista CLÍNICA: la ' +
      'bandeja de casos se organiza en torno al experimento, esta responde a lo que el ' +
      'dermatólogo pregunta en un control — cómo ha evolucionado este paciente. El bloque de IA ' +
      'llega en `null` cuando el solicitante opera en pretest (RF-TR-01).',
  })
  async history(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: AuthenticatedRequest,
    @Query('includeSynthetic') includeSynthetic?: string,
  ): Promise<PatientHistoryDto> {
    const reveal = this.maySeeIdentity(user);
    const patient = await this.patientsService.findResponseById(id, reveal);
    const history = await this.patientHistoryService.build(
      patient,
      user,
      includeSynthetic === 'true',
    );

    await this.auditService.record(
      user,
      {
        action: 'patient.history.read',
        entityType: 'patient',
        entityId: id,
        metadata: { cases: history.summary.totalCases, withIdentity: reveal },
      },
      request,
    );
    return history;
  }

  @Get(':id/identity')
  // Narrower than IDENTITY_ROLES on purpose: the technician sees the NAME in the listing, which is
  // what they need to pick the right record, but this route also returns the identity document and
  // that has no place in the intake desk's workflow (RF-TR-03).
  @Roles(...DIAGNOSING_ROLES)
  @ApiOperation({
    summary: 'Descifra la identidad real del paciente (solo el profesional tratante).',
    description:
      'Es la única operación que revierte la anonimización de RF-TR-03, por lo que queda ' +
      'registrada en `audit_logs` con usuario, IP y momento exacto (RNF-02).',
  })
  async revealIdentity(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: AuthenticatedRequest,
  ): Promise<PatientIdentityDto> {
    const identity = await this.patientsService.revealIdentity(id);
    await this.auditService.record(
      user,
      { action: 'patient.identity.read', entityType: 'patient', entityId: id },
      request,
    );
    return identity;
  }

  @Post(':id/withdraw')
  @Roles(...DIAGNOSING_ROLES, 'admin')
  @ApiOperation({ summary: 'Registra el retiro del paciente del estudio (RNF-07).' })
  async withdraw(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: WithdrawPatientDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: AuthenticatedRequest,
  ): Promise<PatientResponseDto> {
    const patient = await this.patientsService.withdraw(id, this.resolveIp(request), dto.notes);
    await this.auditService.record(
      user,
      { action: 'patient.withdraw', entityType: 'patient', entityId: id },
      request,
    );
    return patient;
  }

  @Patch(':id')
  @Roles(...INTAKE_ROLES)
  @ApiOperation({
    summary: 'Corrige la ficha de un paciente.',
    description:
      'Los campos de identidad están restringidos por rol además de por esta ruta: el nombre solo ' +
      'lo edita quien puede verlo (RF-TR-03) y el documento solo quien diagnostica. ' +
      'Los datos clínicos —fecha de nacimiento, sexo, fototipo— los corrige toda la mesa de ' +
      'admisión, y son el caso de «añadir el fototipo que se omitió en el alta».',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePatientDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: AuthenticatedRequest,
  ): Promise<PatientResponseDto> {
    // Writing identity blind was already granted at intake — `admin` types the name into
    // `POST /patients` and can never read it back. OVERWRITING it blind is a different act: there
    // the mistake destroys a correct value instead of creating a new one. Hence the two gates.
    if (dto.fullName !== undefined && !this.maySeeIdentity(user)) {
      throw new ForbiddenException(
        'Su rol no accede a la identidad del paciente, así que no puede corregirla (RF-TR-03).',
      );
    }
    if (dto.documentId !== undefined && !DOCUMENT_EDIT_ROLES.includes(user.role)) {
      throw new ForbiddenException(
        'Solo quien diagnostica puede corregir el documento de identidad.',
      );
    }

    const patient = await this.patientsService.update(id, dto);
    await this.auditService.record(
      user,
      {
        action: 'patient.update',
        entityType: 'patient',
        entityId: id,
        // Field NAMES only. `audit_logs.metadata` is plain jsonb: writing the new name there would
        // put the very text RF-TR-03 encrypts into the one table nobody thinks to encrypt.
        metadata: { fields: Object.keys(dto) },
      },
      request,
    );
    return patient;
  }

  @Post(':id/reinstate')
  // Mirrors `withdraw`: whoever can take a patient out of the study can put them back.
  @Roles(...DIAGNOSING_ROLES, 'admin')
  @ApiOperation({
    summary: 'Revierte un retiro registrado por error (RNF-07).',
    description:
      'Exige motivo, a diferencia del retiro: los casos del paciente vuelven a los datasets, de ' +
      'modo que un `indicator_snapshot` anterior dejará de coincidir con un recálculo posterior. ' +
      'Queda una tercera fila en el historial de consentimientos.',
  })
  async reinstate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReinstatePatientDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: AuthenticatedRequest,
  ): Promise<PatientResponseDto> {
    const patient = await this.patientsService.reinstate(id, dto.notes, this.resolveIp(request));
    await this.auditService.record(
      user,
      {
        action: 'patient.reinstate',
        entityType: 'patient',
        entityId: id,
        metadata: { reason: dto.notes },
      },
      request,
    );
    return patient;
  }

  @Get(':id/consents')
  @Roles(...STUDY_ROLES)
  @ApiOperation({ summary: 'Historial de consentimientos del paciente (RNF-07).' })
  async consents(@Param('id', ParseUUIDPipe) id: string): Promise<Consent[]> {
    return this.patientsService.findConsents(id);
  }

  /** RF-TR-03: only the clinicians who treat the patient may see the decrypted identity. */
  private maySeeIdentity(user: AuthenticatedUser): boolean {
    return IDENTITY_ROLES.includes(user.role);
  }

  private resolveIp(request: AuthenticatedRequest): string | null {
    const forwarded = request.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
      return forwarded.split(',')[0]?.trim() ?? null;
    }
    return request.ip ?? null;
  }
}
