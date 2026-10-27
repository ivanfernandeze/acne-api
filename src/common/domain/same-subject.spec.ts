import { checkSameSubject, type IdentityReading } from './same-subject';

describe('checkSameSubject', () => {
  const reading = (overrides: Partial<IdentityReading> = {}): IdentityReading => ({
    faceFound: true,
    comparisons: [],
    ...overrides,
  });

  it('accepts the first photograph of a case, with nothing to compare against', () => {
    expect(checkSameSubject('general', reading())).toEqual({
      rejection: null,
      warnings: [],
    });
  });

  it('accepts a profile of the same person as the general view', () => {
    const check = checkSameSubject(
      'perfil_derecho',
      reading({
        comparisons: [{ shotKey: 'general', verdict: 'misma', nearDuplicate: false }],
      }),
    );
    expect(check.rejection).toBeNull();
  });

  it('refuses a profile of another person, naming the shots it does not match', () => {
    const check = checkSameSubject(
      'perfil_izquierdo',
      reading({
        comparisons: [
          { shotKey: 'general', verdict: 'distinta', nearDuplicate: false },
          {
            shotKey: 'perfil_derecho',
            verdict: 'distinta',
            nearDuplicate: false,
          },
        ],
      }),
    );
    expect(check.rejection).toMatch(/misma persona que «Vista general» y «Perfil derecho»/);
    expect(check.rejection).toMatch(/retírela/);
  });

  it('refuses even when only one of the shots disagrees', () => {
    const check = checkSameSubject(
      'general',
      reading({
        comparisons: [
          { shotKey: 'perfil_derecho', verdict: 'misma', nearDuplicate: false },
          {
            shotKey: 'perfil_izquierdo',
            verdict: 'distinta',
            nearDuplicate: false,
          },
        ],
      }),
    );
    expect(check.rejection).toMatch(/«Perfil izquierdo»/);
  });

  it('refuses the same picture re-sent under another shot', () => {
    const check = checkSameSubject(
      'perfil_derecho',
      reading({
        comparisons: [{ shotKey: 'general', verdict: 'misma', nearDuplicate: true }],
      }),
    );
    expect(check.rejection).toMatch(/misma que ya está registrada como «Vista general»/);
  });

  it('only warns for a required shot cut at the eyes: it cannot be compared, not refused', () => {
    const check = checkSameSubject('perfil_derecho', reading({ faceFound: false }));
    expect(check.rejection).toBeNull();
    expect(check.warnings[0]).toMatch(/No se pudo comprobar/);
  });

  it('refuses a general view without the whole face: it is the anchor of the comparison', () => {
    const check = checkSameSubject('general', reading({ faceFound: false }));
    expect(check.rejection).toMatch(/rostro completo de frente, con los dos ojos/);
  });

  it('only warns for an optional close-up without a full face', () => {
    const check = checkSameSubject('acercamiento', reading({ faceFound: false }));
    expect(check.rejection).toBeNull();
    expect(check.warnings).toHaveLength(1);
  });

  it('warns when a required shot on file cannot be compared and nothing else confirmed', () => {
    const check = checkSameSubject(
      'perfil_izquierdo',
      reading({
        comparisons: [{ shotKey: 'general', verdict: 'sin_rostro', nearDuplicate: false }],
      }),
    );
    expect(check.rejection).toBeNull();
    expect(check.warnings[0]).toMatch(/No se pudo comparar esta fotografía con «Vista general»/);
  });

  it('stays quiet about a shot it cannot compare when another one confirmed the identity', () => {
    const check = checkSameSubject(
      'perfil_izquierdo',
      reading({
        comparisons: [
          { shotKey: 'general', verdict: 'sin_rostro', nearDuplicate: false },
          { shotKey: 'perfil_derecho', verdict: 'misma', nearDuplicate: false },
        ],
      }),
    );
    expect(check).toEqual({ rejection: null, warnings: [] });
  });

  it('still refuses another person even when some shot could not be compared', () => {
    const check = checkSameSubject(
      'perfil_izquierdo',
      reading({
        comparisons: [
          { shotKey: 'general', verdict: 'sin_rostro', nearDuplicate: false },
          { shotKey: 'perfil_derecho', verdict: 'distinta', nearDuplicate: false },
        ],
      }),
    );
    expect(check.rejection).toMatch(/«Perfil derecho»/);
  });

  it('ignores an optional close-up on file that has no comparable face', () => {
    const check = checkSameSubject(
      'general',
      reading({
        comparisons: [
          {
            shotKey: 'acercamiento',
            verdict: 'sin_rostro',
            nearDuplicate: false,
          },
        ],
      }),
    );
    expect(check).toEqual({ rejection: null, warnings: [] });
  });

  it('does not apply to trunk shots, nor when screening is switched off', () => {
    const different = reading({
      comparisons: [{ shotKey: 'general', verdict: 'distinta', nearDuplicate: false }],
    });
    expect(checkSameSubject('espalda', different).rejection).toBeNull();
    expect(checkSameSubject('general', null).rejection).toBeNull();
  });
});
