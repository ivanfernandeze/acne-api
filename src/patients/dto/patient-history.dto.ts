import { ApiProperty } from '@nestjs/swagger';

import {
  CASE_STATUSES,
  IGA_CLASSES,
  STUDY_MODES,
  type CaseStatus,
  type IgaClass,
  type StudyMode,
} from 'src/common/domain';
import { CaseImageDto } from 'src/images/dto/image.dto';
import { AiAssessmentDto } from 'src/inference/dto/inference.dto';

import { PatientResponseDto } from './patient.dto';

/**
 * Longitudinal record of one patient.
 *
 * This is the CLINICAL view, deliberately different from the case tray: the tray is organised
 * around the experiment (one row per case, filtered by condition), while this answers the question
 * a dermatologist actually asks in a follow-up consultation — how has this person's acne evolved
 * since the first visit, and what was done at each step.
 */

export class HistoryDiagnosisDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: STUDY_MODES }) studyMode: StudyMode;
  @ApiProperty({ enum: IGA_CLASSES }) igaClass: IgaClass;
  @ApiProperty({ nullable: true, type: Number }) gagsScore: number | null;
  @ApiProperty({ nullable: true, type: String }) notes: string | null;
  @ApiProperty() professional: string;
  @ApiProperty() createdAt: string;
}

export class HistoryTimingDto {
  @ApiProperty({ enum: STUDY_MODES }) studyMode: StudyMode;
  @ApiProperty({ description: 'Instante de apertura de la ficha (t₀).' }) t0: string;
  @ApiProperty({ nullable: true, type: Number, description: 'TRᵢ en minutos.' })
  reviewMinutes: number | null;
  @ApiProperty() valid: boolean;
}

export class HistoryInferenceDto {
  @ApiProperty({ nullable: true, enum: IGA_CLASSES }) igaClass: IgaClass | null;
  @ApiProperty({ nullable: true, type: Number }) confidence: number | null;
  @ApiProperty() modelVersion: string;
  @ApiProperty({ description: '`stub` indica que no proviene de una CNN entrenada.' })
  modelBackend: string;
  @ApiProperty() createdAt: string;
  @ApiProperty({
    nullable: true,
    type: AiAssessmentDto,
    description:
      'La lectura razonada de esa visita: por qué esa clase, qué lesiones distinguió, qué zonas, ' +
      'qué diferenciales y qué cambia la anamnesis. Se guardaba desde el principio y no se ' +
      'mostraba en ningún sitio salvo la ficha del caso abierto; en una consulta de control lo ' +
      'que se necesita es justamente poder releer el razonamiento de la visita anterior. Nula ' +
      'cuando el backend solo mira píxeles: una CNN emite cinco números y no los funda en prosa.',
  })
  assessment: AiAssessmentDto | null;
}

/**
 * Compact view of the visit's anamnesis.
 *
 * The timeline shows whether a history was taken and the one flag that changes what may be
 * prescribed; the 21 answers themselves live on the case file, where there is room to read them.
 */
export class HistoryAnamnesisDto {
  @ApiProperty() complete: boolean;
  @ApiProperty({ description: 'Versión del catálogo con que se respondió (RNF-03).' })
  version: string;
  @ApiProperty({ description: 'Preguntas con respuesta.' }) answeredCount: number;
  @ApiProperty({
    description:
      'Embarazo actual declarado. Los retinoides orales son teratógenos, de modo que la ficha lo ' +
      'muestra de forma permanente. Es una etiqueta para el profesional, no una decisión ' +
      'automatizada (RNF-06).',
  })
  pregnancyFlag: boolean;
}

export class HistoryEntryDto {
  @ApiProperty() caseId: string;
  @ApiProperty() caseCode: string;
  @ApiProperty({ enum: CASE_STATUSES }) status: CaseStatus;
  @ApiProperty({ enum: STUDY_MODES, description: 'Condición en que se registró el caso.' })
  studyMode: StudyMode;
  @ApiProperty({ nullable: true, enum: IGA_CLASSES }) groundTruthIga: IgaClass | null;
  @ApiProperty() isSynthetic: boolean;
  @ApiProperty() createdAt: string;
  @ApiProperty({ nullable: true, type: String }) closedAt: string | null;
  @ApiProperty({
    nullable: true,
    enum: IGA_CLASSES,
    description:
      'Severidad clínicamente vinculante de esta visita: el juicio del especialista más reciente. ' +
      'Es lo que traza la curva de evolución.',
  })
  severity: IgaClass | null;
  @ApiProperty({ type: [HistoryDiagnosisDto] }) diagnoses: HistoryDiagnosisDto[];
  @ApiProperty({ type: [HistoryTimingDto] }) timings: HistoryTimingDto[];
  @ApiProperty({
    type: HistoryInferenceDto,
    nullable: true,
    description: 'Siempre null cuando el solicitante opera en pretest (RF-TR-01).',
  })
  inference: HistoryInferenceDto | null;
  @ApiProperty({ type: [CaseImageDto] }) images: CaseImageDto[];
  @ApiProperty({
    type: HistoryAnamnesisDto,
    nullable: true,
    description: 'Null cuando la visita no registró anamnesis.',
  })
  anamnesis: HistoryAnamnesisDto | null;
}

export class PatientHistorySummaryDto {
  @ApiProperty() totalCases: number;
  @ApiProperty() closedCases: number;
  @ApiProperty({ nullable: true, type: String }) firstVisitAt: string | null;
  @ApiProperty({ nullable: true, type: String }) lastVisitAt: string | null;
  @ApiProperty({ nullable: true, enum: IGA_CLASSES }) firstSeverity: IgaClass | null;
  @ApiProperty({ nullable: true, enum: IGA_CLASSES }) lastSeverity: IgaClass | null;
  @ApiProperty({
    enum: ['mejora', 'estable', 'empeora', 'sin_datos'],
    description:
      'Comparación ordinal entre la primera y la última severidad. IGA es ordinal y un valor ' +
      'menor es mejor, de modo que una bajada es una mejoría.',
  })
  trend: string;
  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Escalones IGA entre la primera y la última visita; negativo indica mejoría.',
  })
  severityDelta: number | null;
  @ApiProperty() totalReviews: number;
  @ApiProperty({ nullable: true, type: Number }) averageReviewMinutes: number | null;
}

export class PatientHistoryDto {
  @ApiProperty({ type: PatientResponseDto }) patient: PatientResponseDto;
  @ApiProperty({ type: PatientHistorySummaryDto }) summary: PatientHistorySummaryDto;
  @ApiProperty({
    type: [HistoryEntryDto],
    description: 'Visitas en orden cronológico ascendente.',
  })
  timeline: HistoryEntryDto[];
}
