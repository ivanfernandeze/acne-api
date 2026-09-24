import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Not, Repository } from 'typeorm';

import {
  ANAMNESIS_ANSWER_TYPES,
  ANAMNESIS_SCOPES,
  ANAMNESIS_SECTIONS,
  ANAMNESIS_SECTION_LABELS,
  type AnamnesisAnswerType,
} from 'src/common/domain';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user';

import type { CreateQuestionDto, QuestionDto, UpdateQuestionDto } from './dto/question.dto';
import { AnamnesisQuestionRow } from './question.entity';

/** Los tipos cuyo valor se elige de una lista cerrada, y que por tanto exigen opciones. */
const CHOICE_TYPES: readonly AnamnesisAnswerType[] = ['opcion_unica', 'opcion_multiple'];

/**
 * El cuestionario de ingreso, administrable de principio a fin.
 *
 * **La base de datos es la fuente de verdad**, no `common/domain/anamnesis.ts`. Esa constante pasó a
 * ser únicamente la semilla: las 21 preguntas con que arranca una instalación nueva. Quien decide
 * qué se pregunta hoy es esta tabla, y por eso el arranque del servidor ya no compara ambas.
 *
 * Lo que SÍ se sigue protegiendo es lo ya respondido, con dos reglas que no son burocracia:
 *
 *  - **Una pregunta con respuestas no cambia de clave, tipo, ámbito ni opciones.** Los valores
 *    guardados se interpretan según el tipo: convertir en numérica una pregunta que se respondió
 *    con «sí» dejaría esas anamnesis ilegibles, y nadie se enteraría hasta intentar leerlas.
 *  - **Una pregunta con respuestas no se borra.** La clave ajena lo impide en la base y aquí se
 *    explica por qué, con la salida real: desactivarla la retira del ingreso sin tocar el pasado.
 *
 * Una pregunta que nunca se respondió es otra cosa: se edita entera y se borra de verdad, porque
 * dejar basura en el catálogo tiene su propio coste.
 */
@Injectable()
export class QuestionsService {
  constructor(
    @InjectRepository(AnamnesisQuestionRow)
    private readonly repository: Repository<AnamnesisQuestionRow>,
    private readonly dataSource: DataSource,
  ) {}

  async findAll(includeInactive = true): Promise<QuestionDto[]> {
    const rows = await this.repository.find({ order: { number: 'ASC' } });
    const counts = await this.answerCounts();
    return rows
      .filter((row) => includeInactive || row.active)
      .map((row) => this.toDto(row, counts.get(row.id) ?? 0));
  }

  /**
   * Las preguntas que se muestran en el ingreso, en la forma que espera el portal.
   *
   * Es también lo que valida el servidor: `anamnesis.service` compara contra ESTO y no contra la
   * constante, de modo que una pregunta creada aquí se puede responder de inmediato.
   */
  async catalogue(): Promise<
    Array<{
      key: string;
      number: number;
      section: string;
      text: string;
      type: string;
      options?: string[];
      unit?: string;
      scope: string;
      required: boolean;
      detail?: string;
      hint?: string;
    }>
  > {
    const rows = await this.repository.find({ where: { active: true }, order: { number: 'ASC' } });
    return rows.map((row) => ({
      key: row.key,
      number: row.number,
      section: row.section,
      text: row.text,
      type: row.type,
      ...(row.options !== null && row.options.length > 0 ? { options: row.options } : {}),
      ...(row.unit !== null ? { unit: row.unit } : {}),
      scope: row.scope,
      required: row.required,
      ...(row.detailPrompt !== null ? { detail: row.detailPrompt } : {}),
      ...(row.hint !== null ? { hint: row.hint } : {}),
    }));
  }

  async create(dto: CreateQuestionDto, user: AuthenticatedUser): Promise<QuestionDto> {
    const key = this.cleanKey(dto.key);
    if (await this.repository.findOne({ where: { key } })) {
      throw new BadRequestException(
        `Ya existe una pregunta con la clave «${key}». Las claves son únicas porque son el nombre ` +
          'bajo el que se archiva cada respuesta.',
      );
    }

    this.assertDefinition(dto.type, dto.options ?? null);
    this.assertCatalogued(dto.section, dto.scope, dto.type);

    const row = this.repository.create({
      key,
      // Al final de la lista: renumerar el resto movería preguntas que el técnico ya tiene
      // memorizadas por su posición.
      number: (await this.maxNumber()) + 1,
      section: dto.section,
      text: dto.text.trim(),
      type: dto.type,
      scope: dto.scope,
      unit: dto.unit?.trim() ?? null,
      required: dto.required ?? false,
      detailPrompt: dto.detailPrompt?.trim() ?? null,
      hint: dto.hint?.trim() ?? null,
      options: this.cleanOptions(dto.options),
      version: dto.version?.trim() ?? '2.0',
      active: dto.active ?? true,
      updatedBy: user.id,
    });
    return this.toDto(await this.repository.save(row), 0);
  }

  async update(id: string, dto: UpdateQuestionDto, user: AuthenticatedUser): Promise<QuestionDto> {
    const row = await this.repository.findOne({ where: { id } });
    if (row === null) throw new NotFoundException(`No existe la pregunta ${id}.`);

    const answers = await this.answerCount(id);
    const structural =
      dto.key !== undefined ||
      dto.type !== undefined ||
      dto.scope !== undefined ||
      dto.options !== undefined;

    if (answers > 0 && structural) {
      throw new BadRequestException(
        `«${row.key}» ya tiene ${answers} respuesta(s) registrada(s), así que su clave, su tipo, su ` +
          'ámbito y sus opciones quedan fijos: los valores guardados se interpretan según ellos, y ' +
          'cambiarlos dejaría esas anamnesis ilegibles. La redacción sí se puede corregir.',
      );
    }

    if (dto.key !== undefined) {
      const key = this.cleanKey(dto.key);
      if (key !== row.key) {
        const clash = await this.repository.findOne({ where: { key, id: Not(id) } });
        if (clash !== null) throw new BadRequestException(`Ya existe una pregunta con la clave «${key}».`);
        row.key = key;
      }
    }
    if (dto.section !== undefined) row.section = dto.section;
    if (dto.type !== undefined) row.type = dto.type;
    if (dto.scope !== undefined) row.scope = dto.scope;
    if (dto.options !== undefined) row.options = this.cleanOptions(dto.options);
    if (dto.unit !== undefined) row.unit = dto.unit.trim() === '' ? null : dto.unit.trim();

    if (dto.text !== undefined) {
      const text = dto.text.trim();
      if (text === '') throw new BadRequestException('El enunciado no puede quedar vacío.');
      row.text = text;
    }
    if (dto.hint !== undefined) row.hint = dto.hint.trim() === '' ? null : dto.hint.trim();
    if (dto.detailPrompt !== undefined) {
      row.detailPrompt = dto.detailPrompt.trim() === '' ? null : dto.detailPrompt.trim();
    }
    if (dto.required !== undefined) row.required = dto.required;
    if (dto.active !== undefined) row.active = dto.active;

    this.assertDefinition(row.type, row.options);
    this.assertCatalogued(row.section, row.scope, row.type);

    row.updatedBy = user.id;
    return this.toDto(await this.repository.save(row), answers);
  }

  /**
   * Retira una pregunta del catálogo.
   *
   * Solo si nunca se respondió. Con respuestas detrás, la clave ajena de `respuestas_anamnesis` lo
   * impide en la base; el error que devolvería PostgreSQL no le dice nada a quien pulsó el botón,
   * así que se comprueba antes y se explica la salida: desactivarla.
   */
  async remove(id: string): Promise<{ removed: boolean }> {
    const row = await this.repository.findOne({ where: { id } });
    if (row === null) throw new NotFoundException(`No existe la pregunta ${id}.`);

    const answers = await this.answerCount(id);
    if (answers > 0) {
      throw new BadRequestException(
        `«${row.key}» no se puede eliminar: ${answers} anamnesis ya la respondieron y borrarla ` +
          'dejaría esas respuestas sin enunciado. Desactívela para retirarla del ingreso sin tocar ' +
          'el historial.',
      );
    }

    await this.repository.delete({ id });
    return { removed: true };
  }

  // ── Ayudas ────────────────────────────────────────────────────────────────

  private async maxNumber(): Promise<number> {
    const [row] = await this.dataSource.query<Array<{ max: number | null }>>(
      `SELECT MAX("numero") AS "max" FROM "preguntas_anamnesis"`,
    );
    return row?.max ?? 0;
  }

  private async answerCount(questionId: string): Promise<number> {
    const [row] = await this.dataSource.query<Array<{ n: string }>>(
      `SELECT COUNT(*) AS "n" FROM "respuestas_anamnesis" WHERE "pregunta_id" = $1`,
      [questionId],
    );
    return Number(row?.n ?? 0);
  }

  /** Cuántas respuestas tiene cada pregunta, en una sola consulta para no hacer N+1. */
  private async answerCounts(): Promise<Map<string, number>> {
    const rows = await this.dataSource.query<Array<{ pregunta_id: string; n: string }>>(
      `SELECT "pregunta_id", COUNT(*) AS "n" FROM "respuestas_anamnesis" GROUP BY "pregunta_id"`,
    );
    return new Map(rows.map((row) => [row.pregunta_id, Number(row.n)]));
  }

  private cleanKey(raw: string): string {
    const key = raw
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
    if (key === '') throw new BadRequestException('La clave no puede quedar vacía.');
    if (key.length > 40) throw new BadRequestException('La clave supera 40 caracteres.');
    return key;
  }

  private cleanOptions(options: string[] | null | undefined): string[] | null {
    if (options === undefined || options === null) return null;
    const cleaned = [...new Set(options.map((option) => option.trim()).filter((o) => o !== ''))];
    return cleaned.length === 0 ? null : cleaned;
  }

  /** Una pregunta de elección sin opciones es un control vacío en pantalla. */
  private assertDefinition(type: AnamnesisAnswerType, options: string[] | null): void {
    if (CHOICE_TYPES.includes(type) && (options === null || options.length < 2)) {
      throw new BadRequestException(
        'Una pregunta de elección necesita al menos dos opciones; si no, no hay nada que elegir.',
      );
    }
    if (!CHOICE_TYPES.includes(type) && options !== null) {
      throw new BadRequestException(
        `Las opciones solo aplican a preguntas de elección, y «${type}» no lo es.`,
      );
    }
  }

  /** Sección, ámbito y tipo son catálogos con clave ajena: se validan antes de llegar a la base. */
  private assertCatalogued(section: string, scope: string, type: string): void {
    if (!(ANAMNESIS_SECTIONS as readonly string[]).includes(section)) {
      throw new BadRequestException(`«${section}» no es una sección del cuestionario.`);
    }
    if (!(ANAMNESIS_SCOPES as readonly string[]).includes(scope)) {
      throw new BadRequestException(`«${scope}» no es un ámbito válido.`);
    }
    if (!(ANAMNESIS_ANSWER_TYPES as readonly string[]).includes(type)) {
      throw new BadRequestException(`«${type}» no es un tipo de respuesta válido.`);
    }
  }

  private toDto(row: AnamnesisQuestionRow, answerCount: number): QuestionDto {
    return {
      id: row.id,
      key: row.key,
      number: row.number,
      section: row.section,
      sectionLabel: ANAMNESIS_SECTION_LABELS[row.section] ?? row.section,
      text: row.text,
      type: row.type,
      scope: row.scope,
      unit: row.unit,
      required: row.required,
      detailPrompt: row.detailPrompt,
      hint: row.hint,
      options: row.options,
      active: row.active,
      answerCount,
      // Con respuestas detrás, la definición queda congelada y solo se corrige la redacción.
      locked: answerCount > 0,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
