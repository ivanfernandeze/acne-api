import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

import {
  ANALYSIS_RULES,
  GAGS_GRADES,
  IGA_CLASSES,
  PROCESS_STATUSES,
  SHOT_KEYS,
  type ClinicalAssessment,
  type GagsGrade,
  type IgaClass,
  type ProcessStatus,
  type ShotKey,
} from 'src/common/domain';

/**
 * The reasoned reading behind a grade, as returned to the portal.
 *
 * Declared as a class and not as a loose object so the shape reaches `acne-web` through the
 * generated OpenAPI client, which is the contract rule of section 4: the frontend never
 * redeclares another service's schema.
 */
export class AiAssessmentDto implements ClinicalAssessment {
  @ApiProperty({ description: 'La lectura del caso en prosa, como la dictaría un dermatólogo.' })
  summary: string;
  @ApiProperty({ type: [String], description: 'Lesiones elementales distinguidas.' })
  lesionTypes: string[];
  @ApiProperty({ type: [String], description: 'Zonas faciales comprometidas.' })
  affectedZones: string[];
  @ApiProperty({ description: 'Por qué esa clase IGA y no la contigua.' })
  severityRationale: string;
  @ApiProperty({ type: [String], description: 'Otros cuadros que podrían explicar lo observado.' })
  differentials: string[];
  @ApiProperty({
    type: [String],
    description: 'Aspectos de manejo a valorar. Nunca una prescripción ni una dosis.',
  })
  considerations: string[];
  @ApiProperty({
    type: [String],
    description: 'Lo que la anamnesis cambia: embarazo, medicación, alergias, cicatrices.',
  })
  anamnesisFlags: string[];
}

/** One model's vote inside an ensemble inference (section 8.1, revision 17/09/2026). */
export class AiInferenceMemberDto {
  @ApiProperty({ description: 'Etiqueta del miembro, p. ej. yolov8s-cls.' }) tag: string;
  @ApiProperty() modelName: string;
  @ApiProperty() modelVersion: string;
  @ApiProperty() weightsChecksum: string;
  @ApiProperty({ description: 'Peso en la votación: F1 macro en el test congelado.' })
  weight: number;
  @ApiProperty({ enum: IGA_CLASSES }) igaClass: IgaClass;
  @ApiProperty() confidence: number;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'number' } })
  classProbs: Record<string, number>;
  @ApiProperty({ nullable: true, type: String, description: 'Grad-CAM de este modelo.' })
  heatmapImageId: string | null;
  @ApiProperty() latencyMs: number;
}

export const ENSEMBLE_AGREEMENTS = ['unanime', 'mayoria', 'discrepancia'] as const;

/** One CNN prediction, as returned to the portal. Covers: OE2 (RF-OE2-01). */
export class AiInferenceDto {
  @ApiProperty() id: string;
  @ApiProperty() caseId: string;
  @ApiProperty() imageId: string;
  @ApiProperty({ enum: PROCESS_STATUSES })
  status: ProcessStatus;
  @ApiProperty({ nullable: true, enum: IGA_CLASSES }) igaClass: IgaClass | null;
  @ApiProperty({ nullable: true, type: Number }) confidence: number | null;
  @ApiProperty({
    nullable: true,
    type: 'object',
    additionalProperties: { type: 'number' },
    description: 'Vector de probabilidades sobre las cinco clases IGA.',
  })
  classProbs: Record<string, number> | null;
  @ApiProperty({ nullable: true, enum: GAGS_GRADES }) gagsGrade: GagsGrade | null;
  @ApiProperty({ nullable: true, type: Number }) gagsScore: number | null;
  @ApiProperty({ nullable: true, type: String }) heatmapImageId: string | null;
  @ApiProperty({ nullable: true, type: Number }) latencyMs: number | null;
  @ApiProperty() modelVersion: string;
  @ApiProperty({
    description: '`stub` indica que la predicción NO proviene de una CNN entrenada.',
  })
  modelBackend: string;
  @ApiProperty({ nullable: true, type: String }) weightsChecksum: string | null;
  @ApiProperty() seed: number;
  @ApiProperty({
    nullable: true,
    type: AiAssessmentDto,
    description:
      'Lectura clínica razonada del modelo. Nula cuando el backend solo mira píxeles: una CNN ' +
      'emite cinco números y no puede fundamentarlos en prosa.',
  })
  assessment: ClinicalAssessment | null;
  @ApiProperty({
    nullable: true,
    enum: ENSEMBLE_AGREEMENTS,
    description:
      'Acuerdo entre los modelos del ensemble sobre la clase: unanime, mayoria o discrepancia. ' +
      'Nulo cuando sirvió un solo modelo.',
  })
  agreement: 'unanime' | 'mayoria' | 'discrepancia' | null;
  @ApiProperty({
    type: [AiInferenceMemberDto],
    description:
      'Lectura de cada modelo cuando el motor sirve un ensemble. `igaClass`/`classProbs` de la ' +
      'cabecera es la lectura íntegra del modelo más seguro sobre esa toma (empate → mayor F1).',
  })
  members: AiInferenceMemberDto[];
  @ApiProperty({ nullable: true, type: String }) errorMessage: string | null;
  @ApiProperty() createdAt: string;
}

/**
 * The analysis of a whole case: one inference per required shot, combined.
 *
 * IGA grades the face, not a photograph; the protocol takes three views precisely because one
 * cheek can carry the lesions the other lacks. The case-level suggestion is the mean of the
 * per-view probability vectors (each already the ensemble's), and `views` keeps every reading so
 * the specialist sees where the models agreed and where they did not.
 */
export class CaseAnalysisViewDto {
  @ApiProperty() imageId: string;
  @ApiProperty({ enum: SHOT_KEYS, nullable: true }) shotKey: ShotKey | null;
  @ApiProperty({ type: () => AiInferenceDto, description: 'La inferencia completa de esta toma.' })
  inference: AiInferenceDto;
}

/**
 * What the clinician chose as the case reading, echoed back with what it currently means.
 *
 * `active` is false when the chosen inference is no longer the latest for its image (the case
 * was re-analysed): the choice is kept for the record but the automatic rule applies until
 * someone chooses again.
 */
export class CaseReadingSelectionDto {
  @ApiProperty() inferenceId: string;
  @ApiProperty() imageId: string;
  @ApiProperty({ enum: SHOT_KEYS, nullable: true }) shotKey: ShotKey | null;
  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Modelo elegido dentro de la toma; nulo = la lectura del ensemble de esa toma.',
  })
  memberTag: string | null;
  @ApiProperty({ enum: IGA_CLASSES, nullable: true }) igaClass: IgaClass | null;
  @ApiProperty({ nullable: true, type: Number }) confidence: number | null;
  @ApiProperty({ nullable: true, type: String }) reason: string | null;
  @ApiProperty({ nullable: true, type: String }) chosenByName: string | null;
  @ApiProperty() chosenAt: string;
  @ApiProperty({
    description: 'False si la inferencia elegida ya no es la vigente de su imagen (caso reanalizado).',
  })
  active: boolean;
}

/** Body of `PUT /inference/case/:caseId/selection`. */
export class ChooseReadingDto {
  @ApiProperty({ description: 'Inferencia (toma) elegida; debe ser la vigente de su imagen.' })
  @IsUUID()
  inferenceId: string;
  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: 'Etiqueta del modelo elegido dentro de la toma; omitir o nulo = lectura del ensemble.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  memberTag?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, description: 'Por qué esa lectura (queda auditado).' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string | null;
}

export class CaseAnalysisDto {
  @ApiProperty({
    enum: IGA_CLASSES,
    nullable: true,
    description:
      'Clase sugerida para el caso: la mayoría de las tomas analizadas o, si todas difieren, la ' +
      'toma en la que el ensemble estuvo más seguro (ver `rule`).',
  })
  igaClass: IgaClass | null;
  @ApiProperty({ nullable: true, type: Number }) confidence: number | null;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'number' }, nullable: true })
  classProbs: Record<string, number> | null;
  @ApiProperty({
    nullable: true,
    enum: ENSEMBLE_AGREEMENTS,
    description: 'Acuerdo entre las tomas sobre la clase sugerida.',
  })
  agreement: 'unanime' | 'mayoria' | 'discrepancia' | null;
  @ApiProperty({
    nullable: true,
    enum: ANALYSIS_RULES,
    description:
      'Regla que produjo la sugerencia: mayoría de tomas; la toma en la que el ensemble estuvo ' +
      'más seguro cuando todas difieren; o la lectura elegida por el técnico o el dermatólogo ' +
      '(`selection`).',
  })
  rule: 'mayoria' | 'toma_mas_confiable' | 'seleccion_manual' | null;
  @ApiProperty({
    nullable: true,
    type: () => CaseReadingSelectionDto,
    description:
      'Lectura elegida a mano para el caso, si la hay. Cuando `active` es true, `igaClass`, ' +
      '`confidence` y `classProbs` son los de esa lectura y `rule` es `seleccion_manual`.',
  })
  selection: CaseReadingSelectionDto | null;
  @ApiProperty({ description: 'La regla en una frase, para mostrar.' }) ruleDescription: string;
  @ApiProperty({
    type: [String],
    description: 'imageId de las tomas que decidieron la sugerencia.',
  })
  decidedBy: string[];
  @ApiProperty({
    nullable: true,
    type: 'object',
    properties: { min: { type: 'string' }, max: { type: 'string' } },
    description: 'Grado mínimo y máximo entre las tomas analizadas.',
  })
  range: { min: IgaClass; max: IgaClass } | null;
  @ApiProperty({ description: 'Tomas con inferencia terminada con éxito.' }) completed: number;
  @ApiProperty({ description: 'Tomas con inferencia pendiente o en ejecución.' }) pending: number;
  @ApiProperty({ description: 'Tomas cuya inferencia falló.' }) failed: number;
  @ApiProperty({ type: [CaseAnalysisViewDto] }) views: CaseAnalysisViewDto[];
  @ApiProperty({
    type: () => AiAssessmentDto,
    nullable: true,
    description:
      'Lectura estructurada del caso, escrita por el sistema a partir de las tomas, los modelos, ' +
      'el acuerdo, la escala IGA y la anamnesis. No es prosa del modelo: la CNN no la produce.',
  })
  reading: AiAssessmentDto | null;
}
