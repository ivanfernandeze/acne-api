import { CASE_STAGE_OF, CASE_STATUSES, statusesOfStage } from './study';

describe('etapas visibles del caso', () => {
  it('maps every internal status to one of the three stages', () => {
    for (const status of CASE_STATUSES) {
      expect(['borrador', 'en_revision', 'revisado']).toContain(CASE_STAGE_OF[status]);
    }
  });

  it('shows a signed, a referred and a closed case as «Revisado»', () => {
    expect(statusesOfStage('revisado').sort()).toEqual(
      ['cerrado', 'derivar_presencial', 'diagnosticado'].sort(),
    );
  });

  it('keeps a case waiting for photographs or for the signature «En revisión»', () => {
    expect(statusesOfStage('en_revision').sort()).toEqual(
      ['en_revision', 'procesado_ia', 'solicitar_fotos'].sort(),
    );
    expect(statusesOfStage('borrador')).toEqual(['borrador']);
  });
});
