import {
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { AuditService } from 'src/audit/audit.service';
import { CurrentUser, Public, Roles } from 'src/common/decorators';
import type {
  AuthenticatedRequest,
  AuthenticatedUser,
} from 'src/common/interfaces/authenticated-user';
import { APP_CONFIG, type AppConfig } from 'src/config/configuration';

import type { CaseImageDto, UploadedImage } from './images.service';
import { ImagesService } from './images.service';

/** Covers: RNF-02. */
@ApiTags('images')
@Controller('images')
export class ImagesController {
  constructor(
    private readonly imagesService: ImagesService,
    private readonly auditService: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Post('case/:caseId')
  @ApiBearerAuth()
  @Roles('dermatologo', 'residente', 'admin')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
  })
  @ApiOperation({
    summary: 'Sube una imagen clínica facial y la cifra en reposo.',
    description:
      'Los bytes se cifran con AES-256-GCM antes de llegar al almacenamiento, de modo que la ' +
      'garantía de confidencialidad no depende de si el backend es disco local o MinIO (RNF-02).',
  })
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @UploadedFile() file: UploadedImage | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: AuthenticatedRequest,
  ): Promise<CaseImageDto> {
    if (file === undefined) {
      throw new Error('No se recibió ningún archivo en el campo "file".');
    }
    const image = await this.imagesService.upload(caseId, file, user.id);
    await this.auditService.record(
      user,
      {
        action: 'image.upload',
        entityType: 'case_image',
        entityId: image.id,
        metadata: { caseId, sizeBytes: image.sizeBytes, sha256: image.sha256 },
      },
      request,
    );
    return this.imagesService.toDto(image, this.apiPrefix(), user.id);
  }

  @Get('case/:caseId')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Lista las imágenes de un caso con enlaces firmados.' })
  async findByCase(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CaseImageDto[]> {
    const images = await this.imagesService.findByCase(caseId);
    return images.map((image) => this.imagesService.toDto(image, this.apiPrefix(), user.id));
  }

  /**
   * Public route by design: authorisation travels in the signed token, not in a bearer header,
   * so the URL can be used directly as the `src` of an <img> tag. The token is bound to one image
   * and one user and expires in 15 minutes (RNF-02).
   */
  @Public()
  @Get(':id/content')
  @ApiOperation({
    summary: 'Devuelve la imagen descifrada, previa verificación del token firmado.',
    description:
      'No se usan URLs presignadas de MinIO porque el objeto almacenado es ciphertext y el ' +
      'navegador no podría renderizarlo. Cada lectura queda registrada en `audit_logs`.',
  })
  async content(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('token') token: string,
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
  ): Promise<void> {
    const { data, mimeType } = await this.imagesService.readContent(id, token ?? '');
    await this.auditService.record(
      null,
      { action: 'image.read', entityType: 'case_image', entityId: id },
      request,
    );
    response.setHeader('Content-Type', mimeType);
    response.setHeader('Content-Length', data.length);
    response.setHeader('Cache-Control', 'private, max-age=900, no-store');
    response.send(data);
  }

  private apiPrefix(): string {
    return `/${this.config.globalPrefix}`;
  }
}
