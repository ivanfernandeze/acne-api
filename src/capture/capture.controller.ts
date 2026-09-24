import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { AuditService } from 'src/audit/audit.service';
import { CurrentUser, Public, Roles } from 'src/common/decorators';
import { INTAKE_ROLES, SHOT_KEYS, isShotKey } from 'src/common/domain';
import type {
  AuthenticatedRequest,
  AuthenticatedUser,
} from 'src/common/interfaces/authenticated-user';
import type { UploadedImage } from 'src/images/images.service';

import { CaptureService } from './capture.service';
import {
  CaptureSessionContextDto,
  CaptureSessionCreatedDto,
  CaptureSessionStatusDto,
  CaptureUploadResultDto,
  CreateCaptureSessionDto,
} from './dto/capture.dto';

/**
 * Mobile photograph capture.
 *
 * Covers: section 9.3 of the specification ("captura de imagen … envío al centro"), whose binding
 * mechanism was never defined, and RNF-02 (short-lived capability, encrypted at rest, audited).
 *
 * Two of these routes are `@Public()` because the phone at the clinic has no account: they are
 * authorised by the QR token alone. Both are therefore deliberately narrow — one reads a case CODE
 * and the shot checklist, the other adds an image. Neither can read, list or delete anything.
 */
@ApiTags('capture')
@Controller()
export class CaptureController {
  constructor(
    private readonly captureService: CaptureService,
    private readonly auditService: AuditService,
  ) {}

  @Post('capture-sessions')
  @ApiBearerAuth()
  @Roles(...INTAKE_ROLES)
  @ApiOperation({
    summary: 'Abre una sesión de captura y devuelve el token del QR.',
    description:
      'El token en claro se devuelve UNA sola vez; la base guarda solo su SHA-256. Caduca a los ' +
      '15 minutos, admite un número acotado de fotografías y se revoca sola al abrir la ficha ' +
      'del caso, porque a partir de ahí corre el cronómetro que mide OE1.',
  })
  async create(
    @Body() dto: CreateCaptureSessionDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: AuthenticatedRequest,
  ): Promise<CaptureSessionCreatedDto> {
    const session = await this.captureService.create(dto.caseId, user.id, dto.maxUploads);
    await this.auditService.record(
      user,
      {
        action: 'capture.session.create',
        entityType: 'case',
        entityId: dto.caseId,
        // The token is never written to the audit trail: it is a live credential.
        metadata: { sessionId: session.id, maxUploads: session.maxUploads },
      },
      request,
    );
    return session;
  }

  @Get('cases/:caseId/capture-session')
  @ApiBearerAuth()
  @Roles(...INTAKE_ROLES)
  // Same reason as in the anamnesis controller: `Dto | null` needs to be declared, not inferred.
  @ApiOkResponse({ type: CaptureSessionStatusDto })
  @ApiOperation({
    summary: 'Sesión de captura viva del caso, si la hay.',
    description:
      'Permite al escritorio recuperar el estado tras recargar. No devuelve el token: si se ' +
      'perdió, hay que abrir una sesión nueva.',
  })
  async active(
    @Param('caseId', ParseUUIDPipe) caseId: string,
  ): Promise<CaptureSessionStatusDto | null> {
    return this.captureService.activeForCase(caseId);
  }

  @Post('capture-sessions/:id/revoke')
  @ApiBearerAuth()
  @Roles(...INTAKE_ROLES)
  @ApiOperation({ summary: 'Revoca la sesión de captura.' })
  async revoke(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: AuthenticatedRequest,
  ): Promise<CaptureSessionStatusDto> {
    const status = await this.captureService.revoke(id);
    await this.auditService.record(
      user,
      {
        action: 'capture.session.revoke',
        entityType: 'case',
        entityId: status.caseId,
        metadata: { sessionId: id, uploads: status.uploadCount },
      },
      request,
    );
    return status;
  }

  // --- Public surface, reached from the phone --------------------------------

  @Public()
  @Get('capture/:token')
  @ApiOperation({
    summary: 'Contexto de la sesión para la página móvil.',
    description:
      'Devuelve el CÓDIGO del caso y la lista de tomas pendientes. Nunca el nombre del paciente: ' +
      'la ruta es pública y quien tuviera el enlace obtendría de otro modo una identidad ' +
      '(RF-TR-03). Un token caducado, revocado o inexistente responde igual, para no revelar qué ' +
      'casos existen.',
  })
  async context(@Param('token') token: string): Promise<CaptureSessionContextDto> {
    return this.captureService.context(token);
  }

  @Public()
  @Post('capture/:token/images')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        shotKey: { type: 'string', enum: [...SHOT_KEYS] },
      },
    },
  })
  @ApiOperation({
    summary: 'Sube una fotografía desde el teléfono.',
    description:
      'El formato se determina leyendo los bytes del archivo, no la cabecera que declara el ' +
      'cliente: aquí no hay sesión que respalde esa declaración. La imagen se cifra en reposo ' +
      'igual que cualquier otra (RNF-02) y se atribuye a quien abrió la sesión, de modo que la ' +
      'traza de auditoría nunca se queda sin responsable.',
  })
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @Param('token') token: string,
    @UploadedFile() file: UploadedImage | undefined,
    @Body('shotKey') rawShotKey: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<CaptureUploadResultDto> {
    if (file === undefined) {
      throw new BadRequestException('No se recibió ninguna fotografía en el campo "file".');
    }
    if (rawShotKey !== undefined && rawShotKey !== '' && !isShotKey(rawShotKey)) {
      throw new BadRequestException(`"${rawShotKey}" no es una toma del protocolo fotográfico.`);
    }

    const shotKey = isShotKey(rawShotKey) ? rawShotKey : null;
    const { result, session } = await this.captureService.upload(token, file, shotKey);

    // The request carried no principal, so the entry is attributed to whoever opened the session:
    // an anonymous write to a clinical record is what RNF-02 exists to prevent.
    await this.auditService.record(
      null,
      {
        action: 'capture.session.upload',
        entityType: 'case_image',
        entityId: result.image.id,
        actorId: session.createdBy,
        metadata: {
          caseId: session.caseId,
          sessionId: session.id,
          shotKey,
          via: 'mobile-qr',
        },
      },
      request,
    );
    return result;
  }
}
