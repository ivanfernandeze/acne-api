import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Append-only audit trail — table `registros_auditoria`.
 *
 * Covers: RNF-02 — "logs de auditoría por acceso a caso". Every read of a clinical image, every
 * decryption of a patient's identity and every dataset export lands here.
 */
@Entity('registros_auditoria')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid', name: 'usuario_id', nullable: true })
  userId: string | null;

  /**
   * Copy of the actor's email at the time of the event.
   *
   * Deliberately redundant, and for that reason NOT a 3NF violation in the sense that matters: if
   * the account is later deleted or changes address, the trail must still say who acted. It is a
   * historical value, not a transitive dependency on `userId`.
   */
  @Column({ type: 'varchar', length: 180, name: 'correo', nullable: true })
  userEmail: string | null;

  /** e.g. `image.read`, `patient.identity.read`, `dataset.export`, `hypothesis.run`. */
  @Index()
  @Column({ type: 'varchar', length: 64, name: 'accion' })
  action: string;

  @Index()
  @Column({ type: 'varchar', length: 40, name: 'tipo_entidad' })
  entityType: string;

  @Column({ type: 'uuid', name: 'entidad_id', nullable: true })
  entityId: string | null;

  @Column({ type: 'varchar', length: 64, name: 'direccion_ip', nullable: true })
  ipAddress: string | null;

  @Column({ type: 'varchar', length: 255, name: 'agente_usuario', nullable: true })
  userAgent: string | null;

  /**
   * The only `jsonb` that survived normalisation, and deliberately: the context of an action is
   * genuinely schemaless — which filter an export carried, which field was decrypted. Normalising
   * it would mean one table per action type for no analytical gain.
   */
  @Column({ type: 'jsonb', name: 'metadatos', nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'creado_en' })
  createdAt: Date;
}
