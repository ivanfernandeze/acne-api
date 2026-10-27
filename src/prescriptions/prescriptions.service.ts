import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { DataSource, Repository } from 'typeorm';
import { assertCaseActive } from 'src/cases/case-guards';

import { ClinicalCase } from 'src/cases/case.entity';
import { EncryptionService } from 'src/common/crypto/encryption.service';
import {
  DELIVERY_CHANNELS,
  DELIVERY_CHANNEL_LABELS,
  IDENTITY_ROLES,
  MAX_PRESCRIPTION_ITEMS,
  PRESCRIPTION_ITEM_LIMITS,
  PRESCRIPTION_STATUS_LABELS,
  canTransitionPrescription,
  isDeliveryChannel,
  isSimulatedChannel,
  type DeliveryChannel,
  SYSTEM_MEASUREMENT_MODE,
} from 'src/common/domain';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user';
import { nextSequentialCode, withCodeRetry } from 'src/common/utils/sequential-code';
import { Diagnosis } from 'src/diagnoses/diagnosis.entity';
import { Patient } from 'src/patients/patient.entity';

import type {
  CreatePrescriptionDto,
  PrescriptionDto,
  SendPrescriptionDto,
} from './dto/prescription.dto';
import { PrescriptionDelivery } from './prescription-delivery.entity';
import { WhatsAppService } from 'src/messaging/whatsapp.service';
import { SignedUrlService } from 'src/common/crypto/signed-url.service';
import { APP_CONFIG, type AppConfig } from 'src/config/configuration';
import { PrescriptionItem } from './prescription-item.entity';
import { Prescription } from './prescription.entity';

/**
 * La receta que cierra la consulta.
 *
 * Replica el proceso que DermAsist opera: el especialista arma el tratamiento desde el vademécum y
 * lo hace llegar al paciente. Dos reglas lo separan de un CRUD:
 *
 *  - **Una receta emitida no se edita.** Se anula y se emite otra. El paciente ya se llevó la
 *    primera, y reescribirla dejaría en el sistema un documento distinto del que está en su mano —
 *    que es el que va a presentar en la farmacia.
 *  - **Cuelga del diagnóstico que la justifica.** El mismo caso se diagnostica dos veces, en
 *    pretest y en postest, y el registro tiene que poder decir cuál de las dos lecturas motivó el
 *    tratamiento.
 */
@Injectable()
export class PrescriptionsService {
  constructor(
    @InjectRepository(Prescription)
    private readonly repository: Repository<Prescription>,
    private readonly dataSource: DataSource,
    private readonly encryption: EncryptionService,
    private readonly whatsapp: WhatsAppService,
    private readonly signedUrls: SignedUrlService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async create(dto: CreatePrescriptionDto, user: AuthenticatedUser): Promise<PrescriptionDto> {
    await assertCaseActive(this.dataSource.manager, dto.caseId);
    const items = dto.items ?? [];
    if (items.length === 0) {
      throw new BadRequestException('Una receta necesita al menos un medicamento.');
    }
    if (items.length > MAX_PRESCRIPTION_ITEMS) {
      throw new BadRequestException(
        `Una receta admite como máximo ${MAX_PRESCRIPTION_ITEMS} medicamentos; llegaron ${items.length}.`,
      );
    }
    for (const [index, item] of items.entries()) {
      this.validateItem(item, index);
    }

    const clinicalCase = await this.dataSource
      .getRepository(ClinicalCase)
      .findOne({ where: { id: dto.caseId } });
    if (clinicalCase === null) throw new NotFoundException(`No existe el caso ${dto.caseId}.`);

    // El diagnóstico que la fundamenta. Sin uno, la receta no sería auditable: no habría forma de
    // decir sobre qué juicio se prescribió, ni si ese juicio se emitió con la IA a la vista.
    const diagnosis = await this.resolveDiagnosis(dto, user);

    const saved = await withCodeRetry(async () =>
      this.dataSource.transaction(async (manager) => {
        const prescription = manager.create(Prescription, {
          prescriptionCode: await nextSequentialCode(
            manager,
            'recetas',
            'codigo_receta',
            `REC-${new Date().getFullYear()}-`,
          ),
          caseId: clinicalCase.id,
          diagnosisId: diagnosis?.id ?? null,
          patientId: clinicalCase.patientId,
          physicianId: user.id,
          instructions: dto.instructions?.trim() ?? null,
          status: 'generada',
          isSynthetic: clinicalCase.isSynthetic,
        });
        const stored = await manager.save(Prescription, prescription);

        await manager.save(
          PrescriptionItem,
          items.map((item, order) =>
            manager.create(PrescriptionItem, {
              prescriptionId: stored.id,
              medicationId: item.medicationId ?? null,
              name: item.name.trim(),
              dose: item.dose.trim(),
              frequency: item.frequency.trim(),
              duration: item.duration.trim(),
              quantity: item.quantity,
              indication: item.indication?.trim() ?? null,
              order,
            }),
          ),
        );

        // La firma se calcula sobre lo que quedó guardado, no sobre lo que llegó: si algo se
        // normalizó al escribir, la firma tiene que describir el documento real.
        const signature = this.sign(stored.prescriptionCode, items, user.id);
        await manager.update(Prescription, stored.id, {
          digitalSignature: signature,
          signedAt: new Date(),
        });
        return stored.id;
      }),
    );

    return this.findOne(saved, user);
  }

  async findOne(id: string, user: AuthenticatedUser): Promise<PrescriptionDto> {
    const prescription = await this.repository.findOne({
      where: { id },
      relations: { items: true, case: true, physician: true },
    });
    if (prescription === null) throw new NotFoundException(`No existe la receta ${id}.`);
    return this.toDto(prescription, user);
  }

  async findByCase(caseId: string, user: AuthenticatedUser): Promise<PrescriptionDto[]> {
    const rows = await this.repository.find({
      where: { caseId },
      relations: { items: true, case: true, physician: true },
      order: { createdAt: 'DESC' },
    });
    return Promise.all(rows.map((row) => this.toDto(row, user)));
  }

  /**
   * Registra la entrega de la receta al paciente.
   *
   * WhatsApp se envía de verdad por Infobip cuando hay credenciales (`INFOBIP_*`, revisión
   * 21/09/2026); la fila guarda el resultado real (`exitoso`, `detalle` con la respuesta de la
   * pasarela). Sin credenciales, y siempre para el correo, el envío se SIMULA: la fila queda con
   * `simulado = true` y la pantalla lo dice, porque presentar un envío inexistente como realizado
   * sería falsear la evidencia de la tesis.
   */
  async send(
    id: string,
    dto: SendPrescriptionDto,
    user: AuthenticatedUser,
  ): Promise<PrescriptionDto> {
    if (!isDeliveryChannel(dto.channel)) {
      throw new BadRequestException(`"${String(dto.channel)}" no es un canal de envío válido.`);
    }

    const prescription = await this.repository.findOne({
      where: { id },
      relations: { items: true, physician: true },
    });
    if (prescription === null) throw new NotFoundException(`No existe la receta ${id}.`);
    if (prescription.status === 'anulada') {
      throw new BadRequestException('Una receta anulada no se puede enviar.');
    }

    const destination = await this.resolveDestination(prescription.patientId, dto);
    const simulated = this.isSimulated(dto.channel);

    let successful = true;
    let detail: string | null = simulated
      ? `Envío simulado por ${DELIVERY_CHANNEL_LABELS[dto.channel]}. El prototipo no tiene ` +
        'pasarela contratada: la entrega queda registrada, no ejecutada.'
      : null;

    if (!simulated && dto.channel === 'whatsapp') {
      const patient = await this.dataSource
        .getRepository(Patient)
        .createQueryBuilder('p')
        .addSelect('p.encryptedFullName')
        .where('p.id = :id', { id: prescription.patientId })
        .getOne();
      // Con URL pública, Infobip recoge el PDF de aquí (token firmado de 15 min, ligado a esta
      // receta y a quien envía). Sin ella, la receta viaja como texto.
      const document =
        this.config.publicBaseUrl === ''
          ? null
          : {
              url:
                `${this.config.publicBaseUrl}/${this.config.globalPrefix}/prescriptions/${prescription.id}/document` +
                `?token=${encodeURIComponent(this.signedUrls.sign(prescription.id, user.id))}`,
              filename: `${prescription.prescriptionCode}.pdf`,
            };
      const outcome = await this.whatsapp.sendPrescription(
        destination,
        {
          prescriptionCode: prescription.prescriptionCode,
          patientName: this.encryption.decryptOptional(patient?.encryptedFullName ?? null),
          physicianName: prescription.physician?.fullName ?? '',
          issuedAt: prescription.createdAt,
          instructions: prescription.instructions,
          items: (prescription.items ?? [])
            .sort((a, b) => a.order - b.order)
            .map((item) => ({
              name: item.name,
              dose: item.dose,
              frequency: item.frequency,
              duration: item.duration,
              quantity: item.quantity,
              indication: item.indication,
            })),
          verificationCode: prescription.digitalSignature?.slice(0, 12).toUpperCase() ?? null,
        },
        document,
      );
      successful = outcome.successful;
      detail = outcome.detail;
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.save(
        PrescriptionDelivery,
        manager.create(PrescriptionDelivery, {
          prescriptionId: prescription.id,
          channel: dto.channel,
          destination,
          simulated,
          successful,
          detail,
          sentBy: user.id,
        }),
      );

      // Un envío que la pasarela rechazó no cambia el estado: la receta sigue «generada» y el
      // médico ve el motivo en la fila de entregas para reintentar.
      if (successful && canTransitionPrescription(prescription.status, 'enviada')) {
        await manager.update(Prescription, prescription.id, {
          status: 'enviada',
        });
      }
    });

    return this.findOne(id, user);
  }

  async annul(id: string, user: AuthenticatedUser): Promise<PrescriptionDto> {
    const prescription = await this.repository.findOne({ where: { id } });
    if (prescription === null) throw new NotFoundException(`No existe la receta ${id}.`);
    if (!canTransitionPrescription(prescription.status, 'anulada')) {
      throw new BadRequestException(
        `Una receta en estado "${PRESCRIPTION_STATUS_LABELS[prescription.status]}" ya no se puede anular.`,
      );
    }
    await this.repository.update(id, { status: 'anulada' });
    return this.findOne(id, user);
  }

  /** Comprueba el token firmado con el que una pasarela recoge el PDF (`GET …/document`). */
  verifyDocumentToken(prescriptionId: string, token: string): boolean {
    return this.signedUrls.verify(token, prescriptionId) !== null;
  }

  /** Canales que hoy se simulan: WhatsApp deja de serlo en cuanto hay credenciales de Infobip. */
  simulatedChannels(): DeliveryChannel[] {
    return DELIVERY_CHANNELS.filter((channel) => this.isSimulated(channel));
  }

  private isSimulated(channel: DeliveryChannel): boolean {
    if (channel === 'whatsapp') return !this.whatsapp.isConfigured;
    return isSimulatedChannel(channel);
  }

  // ── internos ─────────────────────────────────────────────────────────────

  private validateItem(item: CreatePrescriptionDto['items'][number], index: number): void {
    const position = index + 1;
    const required: Array<[keyof typeof PRESCRIPTION_ITEM_LIMITS, string, string | undefined]> = [
      ['name', 'nombre', item.name],
      ['dose', 'dosis', item.dose],
      ['frequency', 'frecuencia', item.frequency],
      ['duration', 'duración', item.duration],
    ];

    for (const [key, label, value] of required) {
      if (typeof value !== 'string' || value.trim() === '') {
        throw new BadRequestException(`El medicamento ${position} necesita ${label}.`);
      }
      const limit = PRESCRIPTION_ITEM_LIMITS[key] as number;
      if (value.trim().length > limit) {
        throw new BadRequestException(
          `La ${label} del medicamento ${position} supera ${limit} caracteres.`,
        );
      }
    }

    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      throw new BadRequestException(
        `La cantidad del medicamento ${position} debe ser un entero positivo.`,
      );
    }
    if (item.quantity > PRESCRIPTION_ITEM_LIMITS.maxQuantity) {
      throw new BadRequestException(
        `La cantidad del medicamento ${position} supera ${PRESCRIPTION_ITEM_LIMITS.maxQuantity}.`,
      );
    }
  }

  /**
   * El diagnóstico que fundamenta la receta.
   *
   * Cuando el cliente no lo manda, se toma el más reciente que el mismo profesional emitió sobre el
   * caso en su condición actual. Buscar por condición y no solo por caso importa: en postest hay
   * dos diagnósticos sobre el mismo caso, y atribuir la receta al de pretest diría que se prescribió
   * sin ver la sugerencia cuando sí se vio.
   */
  private async resolveDiagnosis(
    dto: CreatePrescriptionDto,
    _user: AuthenticatedUser,
  ): Promise<Diagnosis | null> {
    const repository = this.dataSource.getRepository(Diagnosis);

    if (dto.diagnosisId !== undefined && dto.diagnosisId !== null) {
      const explicit = await repository.findOne({
        where: { id: dto.diagnosisId },
      });
      if (explicit === null) {
        throw new NotFoundException(`No existe el diagnóstico ${dto.diagnosisId}.`);
      }
      if (explicit.caseId !== dto.caseId) {
        throw new BadRequestException('El diagnóstico indicado pertenece a otro caso.');
      }
      return explicit;
    }

    return repository.findOne({
      where: { caseId: dto.caseId, studyMode: SYSTEM_MEASUREMENT_MODE },
      order: { createdAt: 'DESC' },
    });
  }

  private async resolveDestination(patientId: string, dto: SendPrescriptionDto): Promise<string> {
    const explicit = dto.destination?.trim();
    if (explicit !== undefined && explicit !== '') {
      if (explicit.length > 120) {
        throw new BadRequestException('El destino supera 120 caracteres.');
      }
      return explicit;
    }

    const patient = await this.dataSource
      .getRepository(Patient)
      .createQueryBuilder('p')
      .addSelect(['p.encryptedPhone', 'p.encryptedEmail'])
      .where('p.id = :id', { id: patientId })
      .getOne();

    // El respaldo depende del CANAL. Tomarlo siempre del teléfono mandaba la receta por correo a
    // un número, que el servidor aceptaba sin rechistar y nadie recibía.
    const byChannel: Record<DeliveryChannel, { cipher: string | null; label: string }> = {
      whatsapp: { cipher: patient?.encryptedPhone ?? null, label: 'teléfono' },
      correo: {
        cipher: patient?.encryptedEmail ?? null,
        label: 'correo electrónico',
      },
      descarga: { cipher: patient?.encryptedPhone ?? null, label: 'teléfono' },
    };

    const { cipher, label } = byChannel[dto.channel] ?? byChannel.whatsapp;
    const stored = this.encryption.decryptOptional(cipher);
    if (stored === null || stored === '') {
      throw new BadRequestException(
        `El paciente no tiene ${label} registrado. Indique un destino o complete su ficha.`,
      );
    }
    return stored;
  }

  /**
   * Huella del documento.
   *
   * NO es una firma electrónica reconocida legalmente: detecta que un PDF descargado no coincide
   * con lo registrado, y nada más. Se declara así en TRACEABILITY.md para que nadie la presente
   * ante el comité como algo que no es.
   */
  private sign(code: string, items: CreatePrescriptionDto['items'], physicianId: string): string {
    const payload = items
      .map(
        (item) => `${item.name}|${item.dose}|${item.frequency}|${item.duration}|${item.quantity}`,
      )
      .join('\n');
    return createHash('sha256').update(`${code}\n${physicianId}\n${payload}`).digest('hex');
  }

  private async toDto(
    prescription: Prescription,
    user: AuthenticatedUser,
  ): Promise<PrescriptionDto> {
    const maySeeIdentity = IDENTITY_ROLES.includes(user.role);

    const patient = await this.dataSource
      .getRepository(Patient)
      .createQueryBuilder('p')
      .addSelect('p.encryptedFullName')
      .where('p.id = :id', { id: prescription.patientId })
      .getOne();

    const deliveries = await this.dataSource.getRepository(PrescriptionDelivery).find({
      where: { prescriptionId: prescription.id },
      order: { sentAt: 'DESC' },
    });

    return {
      id: prescription.id,
      prescriptionCode: prescription.prescriptionCode,
      caseId: prescription.caseId,
      caseCode: prescription.case?.caseCode ?? '',
      diagnosisId: prescription.diagnosisId,
      patientId: prescription.patientId,
      patientCode: patient?.patientCode ?? '',
      patientName: maySeeIdentity
        ? this.encryption.decryptOptional(patient?.encryptedFullName ?? null)
        : null,
      physicianId: prescription.physicianId,
      physicianName: prescription.physician?.fullName ?? '',
      instructions: prescription.instructions,
      status: prescription.status,
      statusLabel: PRESCRIPTION_STATUS_LABELS[prescription.status],
      digitalSignature: prescription.digitalSignature,
      signedAt: prescription.signedAt?.toISOString() ?? null,
      isSynthetic: prescription.isSynthetic,
      createdAt: prescription.createdAt.toISOString(),
      items: (prescription.items ?? [])
        .sort((a, b) => a.order - b.order)
        .map((item) => ({
          id: item.id,
          medicationId: item.medicationId,
          name: item.name,
          dose: item.dose,
          frequency: item.frequency,
          duration: item.duration,
          quantity: item.quantity,
          indication: item.indication,
          order: item.order,
        })),
      deliveries: deliveries.map((delivery) => ({
        id: delivery.id,
        channel: delivery.channel,
        channelLabel: DELIVERY_CHANNEL_LABELS[delivery.channel],
        // El destino es un dato identificador del paciente (RF-TR-03): quien no puede verlo recibe
        // lo justo para reconocer el envío, no para reconstruir el número.
        destination: maySeeIdentity ? delivery.destination : maskDestination(delivery.destination),
        simulated: delivery.simulated,
        successful: delivery.successful,
        detail: delivery.detail,
        sentAt: delivery.sentAt.toISOString(),
      })),
    };
  }
}

/** Deja visibles los últimos tres caracteres, lo justo para reconocer a cuál de dos números se envió. */
function maskDestination(destination: string): string {
  if (destination.length <= 3) return '•••';
  return `${'•'.repeat(Math.max(3, destination.length - 3))}${destination.slice(-3)}`;
}
