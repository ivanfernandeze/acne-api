import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import {
  DELIVERY_CHANNELS,
  MAX_PRESCRIPTION_ITEMS,
  PRESCRIPTION_ITEM_LIMITS,
  PRESCRIPTION_STATUSES,
  type DeliveryChannel,
  type PrescriptionStatus,
} from 'src/common/domain';

/** Un renglón tal como llega del formulario del especialista. */
export class PrescriptionItemInputDto {
  @ApiPropertyOptional({
    description: 'Trazabilidad al vademécum. Nulo cuando el especialista escribe el fármaco a mano.',
    nullable: true,
    type: String,
  })
  @IsOptional()
  @IsUUID()
  medicationId?: string | null;

  @ApiProperty({ maxLength: PRESCRIPTION_ITEM_LIMITS.name })
  @IsString()
  @IsNotEmpty()
  @MaxLength(PRESCRIPTION_ITEM_LIMITS.name)
  name: string;

  @ApiProperty({ maxLength: PRESCRIPTION_ITEM_LIMITS.dose })
  @IsString()
  @IsNotEmpty()
  @MaxLength(PRESCRIPTION_ITEM_LIMITS.dose)
  dose: string;

  @ApiProperty({ maxLength: PRESCRIPTION_ITEM_LIMITS.frequency })
  @IsString()
  @IsNotEmpty()
  @MaxLength(PRESCRIPTION_ITEM_LIMITS.frequency)
  frequency: string;

  @ApiProperty({ maxLength: PRESCRIPTION_ITEM_LIMITS.duration })
  @IsString()
  @IsNotEmpty()
  @MaxLength(PRESCRIPTION_ITEM_LIMITS.duration)
  duration: string;

  @ApiProperty({ minimum: 1, maximum: PRESCRIPTION_ITEM_LIMITS.maxQuantity })
  @IsInt()
  @Min(1)
  @Max(PRESCRIPTION_ITEM_LIMITS.maxQuantity)
  quantity: number;

  @ApiPropertyOptional({ maxLength: PRESCRIPTION_ITEM_LIMITS.indication, nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(PRESCRIPTION_ITEM_LIMITS.indication)
  indication?: string | null;
}

export class CreatePrescriptionDto {
  @ApiProperty({ description: 'Caso al que pertenece la receta.' })
  @IsUUID()
  caseId: string;
  @ApiPropertyOptional({
    description:
      'Diagnóstico que la fundamenta. Si se omite, la API toma el más reciente del caso en la ' +
      'condición del solicitante: una receta sin el juicio que la motiva no es auditable.',
    nullable: true,
    type: String,
  })
  @IsOptional()
  @IsUUID()
  diagnosisId?: string | null;

  @ApiPropertyOptional({
    description: 'Indicaciones generales del tratamiento.',
    nullable: true,
    type: String,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  instructions?: string | null;

  @ApiProperty({
    type: [PrescriptionItemInputDto],
    description: `Al menos uno, como máximo ${MAX_PRESCRIPTION_ITEMS}.`,
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'Una receta necesita al menos un medicamento.' })
  @ArrayMaxSize(MAX_PRESCRIPTION_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => PrescriptionItemInputDto)
  items: PrescriptionItemInputDto[];
}

export class PrescriptionItemDto {
  @ApiProperty() id: string;
  @ApiProperty({ nullable: true, type: String }) medicationId: string | null;
  @ApiProperty() name: string;
  @ApiProperty() dose: string;
  @ApiProperty() frequency: string;
  @ApiProperty() duration: string;
  @ApiProperty() quantity: number;
  @ApiProperty({ nullable: true, type: String }) indication: string | null;
  @ApiProperty() order: number;
}

export class PrescriptionDeliveryDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: DELIVERY_CHANNELS }) channel: DeliveryChannel;
  @ApiProperty() channelLabel: string;
  @ApiProperty({
    description:
      'Destino enmascarado salvo para quien puede ver la identidad del paciente (RF-TR-03).',
  })
  destination: string;
  @ApiProperty({ description: 'true cuando el prototipo registró el envío sin ejecutarlo.' })
  simulated: boolean;
  @ApiProperty() successful: boolean;
  @ApiProperty({ nullable: true, type: String }) detail: string | null;
  @ApiProperty() sentAt: string;
}

export class PrescriptionDto {
  @ApiProperty() id: string;
  @ApiProperty() prescriptionCode: string;
  @ApiProperty() caseId: string;
  @ApiProperty() caseCode: string;
  @ApiProperty({ nullable: true, type: String }) diagnosisId: string | null;
  @ApiProperty() patientId: string;
  @ApiProperty() patientCode: string;
  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Nombre descifrado; nulo para quien no puede ver la identidad (RF-TR-03).',
  })
  patientName: string | null;
  @ApiProperty() physicianId: string;
  @ApiProperty() physicianName: string;
  @ApiProperty({ nullable: true, type: String }) instructions: string | null;
  @ApiProperty({ enum: PRESCRIPTION_STATUSES }) status: PrescriptionStatus;
  @ApiProperty() statusLabel: string;
  @ApiProperty({ nullable: true, type: String }) digitalSignature: string | null;
  @ApiProperty({ nullable: true, type: String }) signedAt: string | null;
  @ApiProperty() isSynthetic: boolean;
  @ApiProperty() createdAt: string;
  @ApiProperty({ type: [PrescriptionItemDto] }) items: PrescriptionItemDto[];
  @ApiProperty({ type: [PrescriptionDeliveryDto] }) deliveries: PrescriptionDeliveryDto[];
}

export class SendPrescriptionDto {
  @ApiProperty({ enum: DELIVERY_CHANNELS })
  @IsIn(DELIVERY_CHANNELS, {
    message: `El canal debe ser uno de: ${DELIVERY_CHANNELS.join(', ')}.`,
  })
  channel: DeliveryChannel;

  @ApiPropertyOptional({
    description:
      'Teléfono o correo. Si se omite, la API usa el que tenga registrado el paciente. No se ' +
      'guarda en el paciente: un envío puntual a otro número no cambia su ficha.',
    nullable: true,
    type: String,
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  destination?: string | null;
}

export class MedicationIndicationDto {
  @ApiProperty() id: string;
  @ApiProperty() indication: string;
  @ApiProperty({ nullable: true, type: String }) suggestedDose: string | null;
  @ApiProperty({ nullable: true, type: String }) suggestedFrequency: string | null;
  @ApiProperty({ nullable: true, type: String }) suggestedDuration: string | null;
}

export class MedicationDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty({ nullable: true, type: String }) activeIngredient: string | null;
  @ApiProperty({ nullable: true, type: String }) description: string | null;
  @ApiProperty() active: boolean;
  @ApiProperty({ type: [MedicationIndicationDto] }) indications: MedicationIndicationDto[];
}

/** Alta o edición de un fármaco del vademécum, con sus indicaciones. */
export class MedicationIndicationInputDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  indication: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  suggestedDose?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  suggestedFrequency?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  suggestedDuration?: string | null;
}

export class SaveMedicationDto {
  @ApiProperty({ maxLength: 160 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  name: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  activeIngredient?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @ApiPropertyOptional({
    description:
      'Una lápida, no un borrado: un fármaco retirado deja de ofrecerse pero las recetas que ya ' +
      'lo citan siguen siendo legibles.',
  })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ type: [MedicationIndicationInputDto], description: 'Reemplaza la lista completa.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => MedicationIndicationInputDto)
  indications?: MedicationIndicationInputDto[];
}
