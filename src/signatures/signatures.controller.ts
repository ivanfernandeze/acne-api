import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UnauthorizedException,
  Post,
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
import { SIGNATURE_ROLES } from 'src/common/domain';
import { sniffImageType } from 'src/common/utils/image-sniffer';
import type { AuthenticatedRequest, AuthenticatedUser } from 'src/common/interfaces/authenticated-user';

import type { SignatureDto } from './dto/signature.dto';
import { MAX_SIGNATURE_BYTES, SignaturesService } from './signatures.service';

/**
 * La rúbrica del especialista.
 *
 * Cada quien administra la SUYA y solo la suya: no hay ruta para subir la firma de otro, porque
 * una firma que un tercero puede reemplazar no sirve para lo único que existe.
 */
@ApiTags('signatures')
@ApiBearerAuth()
@Controller('signatures')
export class SignaturesController {
  constructor(
    private readonly signaturesService: SignaturesService,
    private readonly auditService: AuditService,
  ) {}

  @Get('me')
  @Roles(...SIGNATURE_ROLES)
  @ApiOperation({ summary: 'Indica si el profesional tiene firma registrada.' })
  async find(@CurrentUser() user: AuthenticatedUser): Promise<SignatureDto> {
    return this.signaturesService.find(user.id);
  }

  /**
   * La imagen, autorizada por una URL firmada y no por la sesión.
   *
   * `@Public()` porque una etiqueta `<img>` no puede adjuntar la cabecera Authorization: con
   * `@Roles` el navegador recibía 401 y pintaba una imagen rota. Es el mismo mecanismo con el que
   * se sirven las fotografías clínicas — token de vida corta, atado a este profesional.
   */
  @Public()
  @Get(':userId/image')
  @ApiOperation({ summary: 'Devuelve la imagen de la firma, descifrada, con URL firmada.' })
  async image(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query('token') token: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    if (token === undefined || !this.signaturesService.verifyToken(token, userId)) {
      throw new UnauthorizedException('El enlace de la firma no es válido o ha caducado.');
    }
    const bytes = await this.signaturesService.read(userId);
    // El tipo se deduce de los BYTES: declarar siempre PNG haría que un navegador se negara a
    // pintar una JPEG. El sniffer ya devuelve el MIME, así que se usa tal cual.
    response.setHeader('Content-Type', sniffImageType(bytes) ?? 'image/png');
    // Nunca en caché compartida: es un rasgo identificador del profesional.
    response.setHeader('Cache-Control', 'private, max-age=60');
    response.send(bytes);
  }

  @Post('me')
  @Roles(...SIGNATURE_ROLES)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_SIGNATURE_BYTES } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiOperation({
    summary: 'Registra o reemplaza la firma.',
    description:
      'PNG o JPEG, hasta 512 kB. Se guarda cifrada. NO es una firma electrónica reconocida ' +
      'legalmente: es la rúbrica que se imprime en la receta.',
  })
  async upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: AuthenticatedRequest,
  ): Promise<SignatureDto> {
    const result = await this.signaturesService.upload(user.id, file?.buffer ?? Buffer.alloc(0));
    await this.auditService.record(
      user,
      { action: 'signature.update', entityType: 'user', entityId: user.id, metadata: {} },
      request,
    );
    return result;
  }

  // POST y no DELETE, siguiendo la convención del proyecto: retirar la firma no borra ninguna
  // fila, pone a nulo dos columnas de `usuarios`. Igual que `POST /patients/:id/withdraw`.
  @Post('me/remove')
  @Roles(...SIGNATURE_ROLES)
  @ApiOperation({ summary: 'Retira la firma registrada.' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: AuthenticatedRequest,
  ): Promise<SignatureDto> {
    const result = await this.signaturesService.remove(user.id);
    await this.auditService.record(
      user,
      { action: 'signature.remove', entityType: 'user', entityId: user.id, metadata: {} },
      request,
    );
    return result;
  }
}
