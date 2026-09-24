import {
  Res,
  ForbiddenException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import type { Response } from 'express';

import { AuditService } from 'src/audit/audit.service';
import { CurrentUser, Public, Roles } from 'src/common/decorators';
import {
  CASE_ACCESS_ROLES,
  DELIVERY_ROLES,
  DRUG_ADMIN_ROLES,
  PRESCRIBING_ROLES,
} from 'src/common/domain';
import type {
  AuthenticatedRequest,
  AuthenticatedUser,
} from 'src/common/interfaces/authenticated-user';

import {
  CreatePrescriptionDto,
  MedicationDto,
  PrescriptionDto,
  SaveMedicationDto,
  SendPrescriptionDto,
} from './dto/prescription.dto';
import { MedicationsService } from './medications.service';
import { PrescriptionPdfService } from './prescription-pdf.service';
import { PrescriptionsService } from './prescriptions.service';

/**
 * La receta y el vademécum del que se arma.
 *
 * Cubre el proceso clínico, no la medición: ningún indicador de la tesis lee estas rutas. Se
 * auditan igual, porque una prescripción es un acto médico y RNF-02 pide traza de cada escritura.
 */
@ApiTags('prescriptions')
@ApiBearerAuth()
@Controller('prescriptions')
export class PrescriptionsController {
  constructor(
    private readonly prescriptions: PrescriptionsService,
    private readonly medications: MedicationsService,
    private readonly auditService: AuditService,
    private readonly pdfService: PrescriptionPdfService,
  ) {}

  @Get('medications')
  @Roles(...CASE_ACCESS_ROLES)
  @ApiQuery({ name: 'search', required: false })
  @ApiOperation({
    summary: 'Vademécum con las indicaciones sugeridas por fármaco.',
    description:
      'La dosis sugerida cuelga de la INDICACIÓN y no del medicamento: la isotretinoína no se ' +
      'pauta igual en un acné moderado que en uno conglobata.',
  })
  async listMedications(@Query('search') search?: string): Promise<MedicationDto[]> {
    return this.medications.search(search);
  }

  @Get('case/:caseId')
  @Roles(...CASE_ACCESS_ROLES)
  @ApiOperation({
    summary: 'Recetas emitidas sobre un caso, de la más reciente a la más antigua.',
  })
  async byCase(
    @Param('caseId') caseId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PrescriptionDto[]> {
    return this.prescriptions.findByCase(caseId, user);
  }

  @Get(':id')
  @Roles(...CASE_ACCESS_ROLES)
  @ApiOperation({ summary: 'Una receta con sus renglones y sus entregas.' })
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PrescriptionDto> {
    return this.prescriptions.findOne(id, user);
  }

  @Post()
  @Roles(...PRESCRIBING_ROLES)
  @ApiOperation({
    summary: 'Emite la receta que cierra la consulta.',
    description:
      'Queda firmada con un SHA-256 del contenido. NO es una firma electrónica reconocida ' +
      'legalmente: sirve para detectar que un PDF descargado no coincide con lo registrado.',
  })
  async create(
    @Body() dto: CreatePrescriptionDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: AuthenticatedRequest,
  ): Promise<PrescriptionDto> {
    const prescription = await this.prescriptions.create(dto, user);
    await this.auditService.record(
      user,
      {
        action: 'prescription.create',
        entityType: 'prescription',
        entityId: prescription.id,
        // Los nombres de los fármacos NO viajan al metadato: `registros_auditoria.metadatos` se
        // guarda en claro y el tratamiento de un paciente es dato de salud.
        metadata: { caseId: dto.caseId, items: prescription.items.length },
      },
      request,
    );
    return prescription;
  }

  @Get(':id/pdf')
  @Roles(...CASE_ACCESS_ROLES)
  @ApiOperation({
    summary: 'La receta como PDF: membrete, paciente, diagnóstico, prescripción, firma y huella.',
  })
  async pdf(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
  ): Promise<void> {
    const { pdf, filename } = await this.pdfService.render(id);
    await this.auditService.record(
      user,
      {
        action: 'prescription.download',
        entityType: 'prescription',
        entityId: id,
        metadata: {},
      },
      request,
    );
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    response.setHeader('Content-Length', pdf.length);
    response.setHeader('Cache-Control', 'private, no-store');
    response.end(pdf);
  }

  /**
   * Ruta pública por diseño: la pasarela de WhatsApp (Infobip) descarga el PDF de aquí para
   * adjuntarlo, y no tiene sesión. Autoriza el token firmado que emitió `send` para esta receta,
   * ligado a quien envió y caduco a los 15 minutos (mismo mecanismo que las imágenes, RNF-02).
   */
  @Public()
  @Get(':id/document')
  @ApiOperation({
    summary: 'PDF de la receta para la pasarela de mensajería, con token firmado.',
  })
  async document(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('token') token: string | undefined,
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
  ): Promise<void> {
    if (token === undefined || !this.prescriptions.verifyDocumentToken(id, token)) {
      throw new ForbiddenException('El enlace del documento no es válido o ha caducado.');
    }
    const { pdf, filename } = await this.pdfService.render(id);
    await this.auditService.record(
      null,
      {
        action: 'prescription.fetch',
        entityType: 'prescription',
        entityId: id,
        metadata: {},
      },
      request,
    );
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    response.setHeader('Content-Length', pdf.length);
    response.setHeader('Cache-Control', 'private, no-store');
    response.end(pdf);
  }

  @Post(':id/send')
  @Roles(...DELIVERY_ROLES)
  @ApiOperation({
    summary: 'Hace llegar la receta al paciente.',
    description:
      'WhatsApp se envía por Infobip cuando hay credenciales: como documento PDF si el API tiene ' +
      'URL pública (`PUBLIC_BASE_URL`), si no como texto, y como plantilla si Meta rechaza el ' +
      'texto. El correo se SIMULA (`simulado = true`) y la pantalla lo declara.',
  })
  async send(
    @Param('id') id: string,
    @Body() dto: SendPrescriptionDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: AuthenticatedRequest,
  ): Promise<PrescriptionDto> {
    const prescription = await this.prescriptions.send(id, dto, user);
    await this.auditService.record(
      user,
      {
        action: 'prescription.send',
        entityType: 'prescription',
        entityId: id,
        // El destino es identidad del paciente: se registra el canal, nunca el número.
        metadata: { channel: dto.channel },
      },
      request,
    );
    return prescription;
  }

  @Post(':id/annul')
  @Roles(...PRESCRIBING_ROLES)
  @ApiOperation({
    summary: 'Anula una receta.',
    description:
      'Una receta emitida NUNCA se edita ni se borra: el paciente ya se llevó la suya. Se anula y ' +
      'se emite otra.',
  })
  async annul(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: AuthenticatedRequest,
  ): Promise<PrescriptionDto> {
    const prescription = await this.prescriptions.annul(id, user);
    await this.auditService.record(
      user,
      {
        action: 'prescription.annul',
        entityType: 'prescription',
        entityId: id,
      },
      request,
    );
    return prescription;
  }

  @Get('medications/all')
  @Roles(...DRUG_ADMIN_ROLES)
  @ApiQuery({ name: 'search', required: false })
  @ApiOperation({
    summary: 'El almacén completo, activos y retirados.',
    description:
      'A diferencia de `GET /prescriptions/medications`, que alimenta el buscador de la receta y ' +
      'solo ofrece los activos, esta ruta muestra también los retirados: es lo que permite ' +
      'reactivar uno.',
  })
  async listAll(@Query('search') search?: string): Promise<MedicationDto[]> {
    return this.medications.findAll(search);
  }

  @Post('medications')
  @Roles(...DRUG_ADMIN_ROLES)
  @ApiOperation({ summary: 'Da de alta un fármaco en el almacén.' })
  async createMedication(
    @Body() dto: SaveMedicationDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: AuthenticatedRequest,
  ): Promise<MedicationDto> {
    const created = await this.medications.create(dto);
    await this.auditService.record(
      user,
      {
        action: 'medication.create',
        entityType: 'medication',
        entityId: created.id,
        metadata: {
          name: created.name,
          indications: created.indications.length,
        },
      },
      request,
    );
    return created;
  }

  @Patch('medications/:id')
  @Roles(...DRUG_ADMIN_ROLES)
  @ApiOperation({
    summary: 'Edita un fármaco y reemplaza sus indicaciones.',
    description:
      'Desactivarlo es una lápida, no un borrado: deja de ofrecerse en el buscador pero las ' +
      'recetas que ya lo citan siguen siendo legibles.',
  })
  async updateMedication(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveMedicationDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: AuthenticatedRequest,
  ): Promise<MedicationDto> {
    const updated = await this.medications.update(id, dto);
    await this.auditService.record(
      user,
      {
        action: 'medication.update',
        entityType: 'medication',
        entityId: updated.id,
        metadata: { name: updated.name, active: updated.active },
      },
      request,
    );
    return updated;
  }

  @Post('medications/seed-defaults')
  @Roles(...DRUG_ADMIN_ROLES)
  @ApiOperation({
    summary: 'Carga el vademécum base de acné si está vacío.',
    description:
      'Idempotente: no toca los fármacos que ya existen. Existe para que una instalación nueva ' +
      'pueda recetar sin capturar el catálogo a mano.',
  })
  async seedDefaults(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ created: number }> {
    const created = await this.medications.seedDefaults();
    await this.auditService.record(
      user,
      {
        action: 'medication.seed',
        entityType: 'medication',
        metadata: { created },
      },
      request,
    );
    return { created };
  }
}
