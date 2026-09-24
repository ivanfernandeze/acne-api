import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import type { MedicationDto, SaveMedicationDto } from './dto/prescription.dto';
import { MedicationIndication } from './medication-indication.entity';
import { Medication } from './medication.entity';

/**
 * Vademécum base para acné vulgar.
 *
 * Tomado de las pautas que la clínica ya usa y recortado a lo que el prototipo puede prescribir: la
 * sección 3 lo confina al acné, de modo que un vademécum general sería un desplegable inservible en
 * consulta. La dosis sugerida cuelga de la INDICACIÓN porque un mismo fármaco no se pauta igual
 * según para qué se receta.
 *
 * Las sugerencias son un PUNTO DE PARTIDA editable, nunca una prescripción automática: RNF-06 dice
 * que el sistema no prescribe, y el especialista corrige cualquier renglón antes de firmar.
 */
const DEFAULT_MEDICATIONS: ReadonlyArray<{
  name: string;
  activeIngredient: string;
  description: string;
  indications: ReadonlyArray<{
    indication: string;
    dose: string;
    frequency: string;
    duration: string;
  }>;
}> = [
  {
    name: 'Peróxido de benzoilo 5% gel',
    activeIngredient: 'Peróxido de benzoilo',
    description: 'Antibacteriano y comedolítico tópico. Primera línea en acné leve a moderado.',
    indications: [
      {
        indication: 'Acné leve, lesiones inflamatorias',
        dose: 'Capa fina sobre la zona afectada',
        frequency: '1 vez al día, por la noche',
        duration: '8 semanas',
      },
      {
        indication: 'Acné moderado, combinado con tópico',
        dose: 'Capa fina sobre la zona afectada',
        frequency: '2 veces al día',
        duration: '12 semanas',
      },
    ],
  },
  {
    name: 'Adapaleno 0.1% gel',
    activeIngredient: 'Adapaleno',
    description: 'Retinoide tópico de tercera generación. Comedolítico y antiinflamatorio.',
    indications: [
      {
        indication: 'Acné comedoniano',
        dose: 'Capa fina sobre la zona afectada',
        frequency: '1 vez al día, por la noche',
        duration: '12 semanas',
      },
    ],
  },
  {
    name: 'Clindamicina 1% solución tópica',
    activeIngredient: 'Clindamicina',
    description: 'Antibiótico tópico. No se usa en monoterapia por resistencia bacteriana.',
    indications: [
      {
        indication: 'Acné inflamatorio, asociado a peróxido de benzoilo',
        dose: 'Aplicar sobre la zona afectada',
        frequency: '2 veces al día',
        duration: '8 semanas',
      },
    ],
  },
  {
    name: 'Doxiciclina 100 mg',
    activeIngredient: 'Doxiciclina',
    description: 'Antibiótico sistémico. Requiere fotoprotección estricta.',
    indications: [
      {
        indication: 'Acné moderado a severo con componente inflamatorio',
        dose: '100 mg vía oral',
        frequency: '1 vez al día con alimentos',
        duration: '8 a 12 semanas',
      },
    ],
  },
  {
    name: 'Isotretinoína 20 mg',
    activeIngredient: 'Isotretinoína',
    description:
      'Retinoide oral. TERATÓGENO: exige descartar embarazo y anticoncepción durante y después ' +
      'del tratamiento. Se dosifica por kilo de peso.',
    indications: [
      {
        indication: 'Acné severo o refractario a tratamiento previo',
        dose: '0.5 mg/kg/día',
        frequency: '1 vez al día con alimentos',
        duration: '16 a 24 semanas',
      },
    ],
  },
  {
    name: 'Ácido azelaico 20% crema',
    activeIngredient: 'Ácido azelaico',
    description: 'Comedolítico y despigmentante. Seguro en embarazo.',
    indications: [
      {
        indication: 'Acné con hiperpigmentación postinflamatoria',
        dose: 'Capa fina sobre la zona afectada',
        frequency: '2 veces al día',
        duration: '12 semanas',
      },
      {
        indication: 'Acné en gestante',
        dose: 'Capa fina sobre la zona afectada',
        frequency: '2 veces al día',
        duration: 'Según evolución',
      },
    ],
  },
  {
    name: 'Protector solar facial FPS 50+ oil free',
    activeIngredient: 'Filtros solares',
    description: 'Coadyuvante obligado con retinoides y con doxiciclina.',
    indications: [
      {
        indication: 'Fotoprotección durante el tratamiento',
        dose: 'Cantidad de dos dedos sobre el rostro',
        frequency: 'Cada 3 horas mientras haya exposición',
        duration: 'Todo el tratamiento',
      },
    ],
  },
];

@Injectable()
export class MedicationsService {
  constructor(
    @InjectRepository(Medication) private readonly repository: Repository<Medication>,
    @InjectRepository(MedicationIndication)
    private readonly indications: Repository<MedicationIndication>,
  ) {}

  async search(term?: string): Promise<MedicationDto[]> {
    const query = this.repository
      .createQueryBuilder('m')
      .leftJoinAndSelect('m.indications', 'i')
      .where('m.active = true')
      .orderBy('m.name', 'ASC')
      .addOrderBy('i.order', 'ASC');

    const cleaned = term?.trim();
    if (cleaned !== undefined && cleaned !== '') {
      // El principio activo entra en la búsqueda porque el especialista lo recuerda tanto como la
      // marca, y buscar «clindamicina» no debería fallar por estar escrito en el segundo campo.
      // `unaccent` en ambos lados: teclear «isotretinoina» tiene que encontrar ISOTRETINOÍNA.
      query.andWhere(
        '(unaccent(m.name) ILIKE unaccent(:term) OR unaccent(m.activeIngredient) ILIKE unaccent(:term))',
        { term: `%${cleaned}%` },
      );
    }

    return (await query.getMany()).map((row) => this.toDto(row));
  }

  /** Una ficha de fármaco tal como la pinta el portal, con sus indicaciones en orden. */
  private toDto(row: Medication): MedicationDto {
    return {
      id: row.id,
      name: row.name,
      activeIngredient: row.activeIngredient,
      description: row.description,
      active: row.active,
      indications: (row.indications ?? [])
        .sort((a, b) => a.order - b.order)
        .map((indication) => ({
          id: indication.id,
          indication: indication.indication,
          suggestedDose: indication.suggestedDose,
          suggestedFrequency: indication.suggestedFrequency,
          suggestedDuration: indication.suggestedDuration,
        })),
    };
  }

  /** Idempotente: solo inserta los fármacos que aún no existen, por nombre. */

  /**
   * El almacén completo, activos e inactivos.
   *
   * `search` solo devuelve los activos porque alimenta el buscador de la receta, donde ofrecer un
   * fármaco retirado sería un error. La pantalla de gestión necesita ver justamente los que están
   * retirados, que es lo que permite reactivarlos.
   */
  async findAll(term?: string): Promise<MedicationDto[]> {
    const query = this.repository
      .createQueryBuilder('m')
      .leftJoinAndSelect('m.indications', 'i')
      .orderBy('m.name', 'ASC')
      .addOrderBy('i.order', 'ASC');

    const trimmed = term?.trim();
    if (trimmed !== undefined && trimmed !== '') {
      query.andWhere(
        '(unaccent(m.name) ILIKE unaccent(:term) OR unaccent(m.activeIngredient) ILIKE unaccent(:term))',
        { term: `%${trimmed}%` },
      );
    }
    return (await query.getMany()).map((medication) => this.toDto(medication));
  }

  async create(dto: SaveMedicationDto): Promise<MedicationDto> {
    const name = dto.name.trim();
    const existing = await this.repository.findOne({ where: { name } });
    if (existing !== null) {
      throw new BadRequestException(
        `Ya existe «${name}» en el almacén. Edítelo en vez de crear un duplicado: dos fichas del ` +
          'mismo fármaco acaban con dosis distintas para lo mismo.',
      );
    }

    const saved = await this.repository.save(
      this.repository.create({
        name,
        activeIngredient: dto.activeIngredient?.trim() ?? null,
        description: dto.description?.trim() ?? null,
        active: dto.active ?? true,
      }),
    );
    await this.replaceIndications(saved.id, dto.indications ?? []);
    return this.findOne(saved.id);
  }

  async update(id: string, dto: SaveMedicationDto): Promise<MedicationDto> {
    const medication = await this.repository.findOne({ where: { id } });
    if (medication === null) throw new NotFoundException(`No existe el medicamento ${id}.`);

    const name = dto.name.trim();
    if (name !== medication.name) {
      const clash = await this.repository.findOne({ where: { name } });
      if (clash !== null) throw new BadRequestException(`Ya existe «${name}» en el almacén.`);
      medication.name = name;
    }
    if (dto.activeIngredient !== undefined) {
      medication.activeIngredient = dto.activeIngredient?.trim() ?? null;
    }
    if (dto.description !== undefined) medication.description = dto.description?.trim() ?? null;
    if (dto.active !== undefined) medication.active = dto.active;

    await this.repository.save(medication);
    if (dto.indications !== undefined) await this.replaceIndications(id, dto.indications);
    return this.findOne(id);
  }

  async findOne(id: string): Promise<MedicationDto> {
    const medication = await this.repository
      .createQueryBuilder('m')
      .leftJoinAndSelect('m.indications', 'i')
      .where('m.id = :id', { id })
      .orderBy('i.order', 'ASC')
      .getOne();
    if (medication === null) throw new NotFoundException(`No existe el medicamento ${id}.`);
    return this.toDto(medication);
  }

  /**
   * Reemplaza la lista de indicaciones de un fármaco.
   *
   * Se borran y se reinsertan en vez de conciliar fila a fila: son como mucho veinte, no las
   * referencia nadie —`items_receta` COPIA el texto al emitir, justamente para que una receta ya
   * entregada no cambie— y conciliar por texto sería frágil sin ganar nada.
   */
  private async replaceIndications(
    medicationId: string,
    entries: NonNullable<SaveMedicationDto['indications']>,
  ): Promise<void> {
    await this.indications.delete({ medicationId });
    if (entries.length === 0) return;
    await this.indications.save(
      entries.map((entry, index) =>
        this.indications.create({
          medicationId,
          indication: entry.indication.trim(),
          suggestedDose: entry.suggestedDose?.trim() ?? null,
          suggestedFrequency: entry.suggestedFrequency?.trim() ?? null,
          suggestedDuration: entry.suggestedDuration?.trim() ?? null,
          order: index + 1,
        }),
      ),
    );
  }

  async seedDefaults(): Promise<number> {
    let created = 0;

    for (const definition of DEFAULT_MEDICATIONS) {
      const existing = await this.repository.findOne({ where: { name: definition.name } });
      if (existing !== null) continue;

      const medication = await this.repository.save(
        this.repository.create({
          name: definition.name,
          activeIngredient: definition.activeIngredient,
          description: definition.description,
          active: true,
        }),
      );

      await this.indications.save(
        definition.indications.map((indication, order) =>
          this.indications.create({
            medicationId: medication.id,
            indication: indication.indication,
            suggestedDose: indication.dose,
            suggestedFrequency: indication.frequency,
            suggestedDuration: indication.duration,
            order,
          }),
        ),
      );
      created += 1;
    }

    return created;
  }
}
