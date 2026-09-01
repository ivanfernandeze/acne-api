import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { AuditService } from 'src/audit/audit.service';
import { CurrentUser, Roles } from 'src/common/decorators';
import type {
  AuthenticatedRequest,
  AuthenticatedUser,
} from 'src/common/interfaces/authenticated-user';

import type { Consent } from './consent.entity';
import { CreatePatientDto, PatientIdentityDto, PatientResponseDto } from './dto/patient.dto';
import { PatientsService } from './patients.service';

/** Covers: RF-TR-03, RNF-02, RNF-07. */
@ApiTags('patients')
@ApiBearerAuth()
@Controller('patients')
export class PatientsController {
  constructor(
    private readonly patientsService: PatientsService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  @ApiQuery({ name: 'includeWithdrawn', required: false, type: Boolean })
  @ApiQuery({
    name: 'search',
    required: false,
    description: 'Filtra por nombre o por código. Solo surte efecto para roles asistenciales.',
  })
  @ApiOperation({
    summary: 'Lista pacientes.',
    description:
      'Para `dermatologo` y `residente` incluye el nombre descifrado, porque elegir un paciente ' +
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
    const maySeeIdentity = user.role === 'dermatologo' || user.role === 'residente';
    if (!maySeeIdentity) {
      return this.patientsService.findAll(includeWithdrawn === 'true');
    }

    const patients = await this.patientsService.findAllWithIdentity({
      includeWithdrawn: includeWithdrawn === 'true',
      search,
    });

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
  @Roles('dermatologo', 'residente', 'admin')
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
  @ApiOperation({ summary: 'Devuelve un paciente anonimizado.' })
  async findOne(@Param('id', ParseUUIDPipe) id: string): Promise<PatientResponseDto> {
    return this.patientsService.toResponse(await this.patientsService.findById(id));
  }

  @Get(':id/identity')
  @Roles('dermatologo', 'residente')
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
  @Roles('dermatologo', 'admin')
  @ApiOperation({ summary: 'Registra el retiro del paciente del estudio (RNF-07).' })
  async withdraw(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: AuthenticatedRequest,
    @Body('notes') notes?: string,
  ): Promise<PatientResponseDto> {
    const patient = await this.patientsService.withdraw(id, this.resolveIp(request), notes);
    await this.auditService.record(
      user,
      { action: 'patient.withdraw', entityType: 'patient', entityId: id },
      request,
    );
    return patient;
  }

  @Get(':id/consents')
  @ApiOperation({ summary: 'Historial de consentimientos del paciente (RNF-07).' })
  async consents(@Param('id', ParseUUIDPipe) id: string): Promise<Consent[]> {
    return this.patientsService.findConsents(id);
  }

  private resolveIp(request: AuthenticatedRequest): string | null {
    const forwarded = request.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
      return forwarded.split(',')[0]?.trim() ?? null;
    }
    return request.ip ?? null;
  }
}
