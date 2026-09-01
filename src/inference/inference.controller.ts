import { Controller, Get, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuditService } from 'src/audit/audit.service';
import { CurrentUser, RequiresAiEnabled, Roles } from 'src/common/decorators';
import type {
  AuthenticatedRequest,
  AuthenticatedUser,
} from 'src/common/interfaces/authenticated-user';

import type { AiInferenceDto } from './inference.service';
import { InferenceService } from './inference.service';

/**
 * Covers: OE2 and RF-TR-01.
 *
 * Every route here is annotated with `@RequiresAiEnabled()`, so `StudyModeGuard` returns 403 to a
 * user whose `study_mode` is `pretest`. This is the enforceable half of the independent-variable
 * lock: the pretest observation stays uncontaminated even if a client tries to call the endpoint.
 */
@ApiTags('inference')
@ApiBearerAuth()
@Controller('inference')
export class InferenceController {
  constructor(
    private readonly inferenceService: InferenceService,
    private readonly auditService: AuditService,
  ) {}

  @Post('case/:caseId/image/:imageId')
  @RequiresAiEnabled()
  @Roles('dermatologo', 'residente', 'admin')
  @ApiOperation({
    summary: 'Encola la inferencia CNN de una imagen (bloqueado en pretest).',
    description:
      'Devuelve 403 cuando el usuario opera en modo pretest (IIA = 0), por RF-TR-01. ' +
      'La inferencia es asíncrona para que la latencia del modelo no se sume al tiempo de ' +
      'revisión médica que mide OE1.',
  })
  async request(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: AuthenticatedRequest,
  ): Promise<AiInferenceDto> {
    const inference = await this.inferenceService.request(caseId, imageId, user.id);
    await this.auditService.record(
      user,
      {
        action: 'inference.request',
        entityType: 'ai_inference',
        entityId: inference.id,
        metadata: { caseId, imageId },
      },
      request,
    );
    return this.inferenceService.toDto(inference);
  }

  @Get('case/:caseId')
  @RequiresAiEnabled()
  @ApiOperation({ summary: 'Devuelve la última inferencia de un caso (bloqueado en pretest).' })
  async findByCase(
    @Param('caseId', ParseUUIDPipe) caseId: string,
  ): Promise<AiInferenceDto | null> {
    const inference = await this.inferenceService.findByCase(caseId);
    return inference === null ? null : this.inferenceService.toDto(inference);
  }

  @Get('queue/status')
  @Roles('admin', 'evaluador_estadistico')
  @ApiOperation({ summary: 'Estado de la cola de inferencia por estado de trabajo.' })
  async queueStatus(): Promise<Record<string, number>> {
    return this.inferenceService.queueStatus();
  }
}
