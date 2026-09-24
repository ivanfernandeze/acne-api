import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { AuditService } from 'src/audit/audit.service';
import { CurrentUser, Roles } from 'src/common/decorators';
import { CASE_ACCESS_ROLES, QUESTION_ADMIN_ROLES } from 'src/common/domain';
import type { AuthenticatedRequest, AuthenticatedUser } from 'src/common/interfaces/authenticated-user';

import { CreateQuestionDto, UpdateQuestionDto } from './dto/question.dto';
import type { QuestionDto } from './dto/question.dto';
import { QuestionsService } from './questions.service';

/** Cuestionario de ingreso: se edita la redacción, nunca el contrato. */
@ApiTags('questions')
@ApiBearerAuth()
@Controller('questions')
export class QuestionsController {
  constructor(
    private readonly questionsService: QuestionsService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  // Quien toma la anamnesis necesita leerlas; solo quien las gestiona puede reescribirlas.
  @Roles(...CASE_ACCESS_ROLES)
  @ApiQuery({ name: 'includeInactive', required: false, type: Boolean })
  @ApiOperation({
    summary: 'Las preguntas del ingreso, con su redacción actual.',
    description:
      'La clave, el tipo, el ámbito y las opciones vienen del dominio y no se editan: son el ' +
      'contrato que valida las respuestas ya guardadas.',
  })
  async findAll(@Query('includeInactive') includeInactive?: string): Promise<QuestionDto[]> {
    return this.questionsService.findAll(includeInactive !== 'false');
  }

  @Post()
  @Roles(...QUESTION_ADMIN_ROLES)
  @ApiOperation({
    summary: 'Crea una pregunta nueva.',
    description:
      'La clave se normaliza a minúsculas sin tildes ni espacios y debe ser única: es el nombre ' +
      'bajo el que se archiva cada respuesta. La pregunta se añade al final del cuestionario.',
  })
  async create(
    @Body() dto: CreateQuestionDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: AuthenticatedRequest,
  ): Promise<QuestionDto> {
    const created = await this.questionsService.create(dto, user);
    await this.auditService.record(
      user,
      {
        action: 'question.create',
        entityType: 'anamnesis_question',
        entityId: created.id,
        metadata: { key: created.key, section: created.section, type: created.type },
      },
      request,
    );
    return created;
  }

  // POST y no DELETE: es la convención del proyecto, y aquí además el borrado está condicionado a
  // que nadie la haya respondido nunca.
  @Post(':id/remove')
  @Roles(...QUESTION_ADMIN_ROLES)
  @ApiOperation({
    summary: 'Elimina una pregunta que nunca se respondió.',
    description:
      'Con respuestas detrás devuelve 400: borrarla dejaría esas anamnesis sin enunciado. La ' +
      'salida en ese caso es desactivarla, que la retira del ingreso sin tocar el historial.',
  })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ removed: boolean }> {
    const result = await this.questionsService.remove(id);
    await this.auditService.record(
      user,
      { action: 'question.remove', entityType: 'anamnesis_question', entityId: id, metadata: {} },
      request,
    );
    return result;
  }

  @Patch(':id')
  @Roles(...QUESTION_ADMIN_ROLES)
  @ApiOperation({ summary: 'Reescribe la redacción de una pregunta.' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateQuestionDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: AuthenticatedRequest,
  ): Promise<QuestionDto> {
    const updated = await this.questionsService.update(id, dto, user);
    await this.auditService.record(
      user,
      {
        action: 'question.update',
        entityType: 'anamnesis_question',
        entityId: updated.id,
        // Solo los NOMBRES de campo, nunca los textos: la traza se guarda en claro.
        metadata: { key: updated.key, fields: Object.keys(dto) },
      },
      request,
    );
    return updated;
  }
}
