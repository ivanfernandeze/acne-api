import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Electronic informed consent — table `consentimientos`, for patients and for participating staff.
 *
 * Covers: RNF-07. Append-only: a withdrawal is a new row, never an edit, so the consent trail
 * stays defensible before the ethics committee.
 *
 * The subject used to be `subjectType` + `subjectId`, a polymorphic pair no foreign key could
 * constrain: nothing stopped a consent pointing at a uuid that never existed. It is now two
 * nullable columns with real foreign keys and a CHECK of exactly one, which gives the same
 * flexibility WITH referential integrity.
 */
@Entity('consentimientos')
export class Consent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Set when the subject is a patient; mutually exclusive with `userId`. */
  @Index()
  @Column({ type: 'uuid', name: 'paciente_id', nullable: true })
  patientId: string | null;

  /** Set when the subject is a member of staff; mutually exclusive with `patientId`. */
  @Index()
  @Column({ type: 'uuid', name: 'usuario_id', nullable: true })
  userId: string | null;

  @Column({ type: 'varchar', length: 16, name: 'version' })
  version: string;

  @Column({ type: 'boolean', name: 'aceptado', default: true })
  accepted: boolean;

  @Column({ type: 'timestamptz', name: 'aceptado_en' })
  acceptedAt: Date;

  @Column({ type: 'varchar', length: 64, name: 'direccion_ip', nullable: true })
  ipAddress: string | null;

  @Column({ type: 'text', name: 'notas', nullable: true })
  notes: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'creado_en' })
  createdAt: Date;
}
