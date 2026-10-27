import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

/**
 * Refuses to add work to a case that no longer exists for the study.
 *
 * An annulled case keeps its row for the audit, so nothing structural stops a request from reaching
 * it: a phone with an old QR, a tab left open on the case file. Each entry point that adds content
 * (photographs, anamnesis, analysis, diagnosis, prescription, QR) calls this first. A raw query
 * rather than `CasesService` because those services are dependencies of it.
 */
export async function assertCaseActive(manager: EntityManager, caseId: string): Promise<void> {
  const [row] = await manager.query<Array<{ anulado_en: Date | null; codigo_caso: string }>>(
    `SELECT "anulado_en", "codigo_caso" FROM "casos" WHERE "id" = $1`,
    [caseId],
  );
  if (row === undefined) throw new NotFoundException(`No existe el caso ${caseId}.`);
  if (row.anulado_en !== null) {
    throw new BadRequestException(
      `El caso ${row.codigo_caso} está anulado y ya no admite cambios.`,
    );
  }
}
