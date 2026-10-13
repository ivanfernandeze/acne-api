import { checkShotView, type ShotSibling } from './shot-view';

const sibling = (overrides: Partial<ShotSibling>): ShotSibling => ({
  id: 'otra',
  shotKey: 'general',
  sha256: 'b'.repeat(64),
  pose: 'frontal',
  ...overrides,
});

const SHA = 'a'.repeat(64);

describe('checkShotView', () => {
  it('accepts a frontal photograph as the general view', () => {
    expect(checkShotView('general', 'frontal', SHA, [])).toEqual({ rejection: null, warnings: [] });
  });

  it('refuses a turned head as the general view', () => {
    const check = checkShotView('general', 'nariz_izquierda', SHA, []);
    expect(check.rejection).toMatch(/de frente/);
  });

  it.each(['perfil_derecho', 'perfil_izquierdo'] as const)('refuses a frontal face as %s', (key) => {
    expect(checkShotView(key, 'frontal', SHA, []).rejection).toMatch(/girado/);
  });

  it('accepts each profile turned the conventional way (rear camera)', () => {
    expect(checkShotView('perfil_derecho', 'nariz_derecha', SHA, [])).toEqual({
      rejection: null,
      warnings: [],
    });
    expect(checkShotView('perfil_izquierdo', 'nariz_izquierda', SHA, [])).toEqual({
      rejection: null,
      warnings: [],
    });
  });

  it('only warns when a profile points the other way: a mirrored selfie flips the sides', () => {
    const check = checkShotView('perfil_derecho', 'nariz_izquierda', SHA, []);
    expect(check.rejection).toBeNull();
    expect(check.warnings).toHaveLength(1);
    expect(check.warnings[0]).toMatch(/espejada/);
  });

  it('refuses two profiles turned to the same side', () => {
    const left = sibling({ shotKey: 'perfil_izquierdo', pose: 'nariz_izquierda' });
    const check = checkShotView('perfil_derecho', 'nariz_izquierda', SHA, [left]);
    expect(check.rejection).toMatch(/mismo lado/);
  });

  it('accepts mirrored profiles as long as they point opposite ways', () => {
    const left = sibling({ shotKey: 'perfil_izquierdo', pose: 'nariz_derecha' });
    const check = checkShotView('perfil_derecho', 'nariz_izquierda', SHA, [left]);
    expect(check.rejection).toBeNull();
  });

  it('compares against the latest photograph of the other profile', () => {
    const old = sibling({ id: '1', shotKey: 'perfil_izquierdo', pose: 'nariz_derecha' });
    const retaken = sibling({ id: '2', shotKey: 'perfil_izquierdo', pose: 'nariz_izquierda' });
    expect(checkShotView('perfil_derecho', 'nariz_derecha', SHA, [old, retaken]).rejection).toBeNull();
    expect(checkShotView('perfil_derecho', 'nariz_derecha', SHA, [retaken, old]).rejection).toMatch(
      /mismo lado/,
    );
  });

  it('refuses the same file filed under a second shot', () => {
    const general = sibling({ shotKey: 'general', sha256: SHA });
    const check = checkShotView('perfil_izquierdo', 'nariz_izquierda', SHA, [general]);
    expect(check.rejection).toMatch(/Vista general/);
  });

  it('allows re-uploading the same file to the same shot', () => {
    const same = sibling({ shotKey: 'perfil_izquierdo', sha256: SHA, pose: 'nariz_izquierda' });
    expect(checkShotView('perfil_izquierdo', 'nariz_izquierda', SHA, [same]).rejection).toBeNull();
  });

  it('refuses a duplicate even when the pose could not be measured', () => {
    const general = sibling({ shotKey: 'general', sha256: SHA });
    expect(checkShotView('perfil_derecho', null, SHA, [general]).rejection).not.toBeNull();
  });

  it('skips the pose rules when nothing was measured (fails open, like the screening)', () => {
    expect(checkShotView('general', null, SHA, [])).toEqual({ rejection: null, warnings: [] });
    expect(checkShotView('perfil_derecho', null, SHA, [])).toEqual({ rejection: null, warnings: [] });
  });

  it('warns but admits an undecided pose on a required shot', () => {
    const check = checkShotView('perfil_izquierdo', 'indeterminado', SHA, []);
    expect(check.rejection).toBeNull();
    expect(check.warnings).toHaveLength(1);
  });

  it.each(['acercamiento', 'borde', 'pecho', 'espalda', 'otra'] as const)(
    'does not check the pose of %s',
    (key) => {
      expect(checkShotView(key, 'nariz_derecha', SHA, [])).toEqual({ rejection: null, warnings: [] });
      expect(checkShotView(key, 'frontal', SHA, [])).toEqual({ rejection: null, warnings: [] });
    },
  );

  it('does nothing for a photograph with no shot label', () => {
    const general = sibling({ shotKey: 'general', sha256: SHA });
    expect(checkShotView(null, 'nariz_derecha', SHA, [general])).toEqual({
      rejection: null,
      warnings: [],
    });
  });

  it('never mentions the disease (RF-TR-01)', () => {
    const texts = [
      checkShotView('general', 'nariz_derecha', SHA, []).rejection,
      checkShotView('perfil_derecho', 'frontal', SHA, []).rejection,
      checkShotView('perfil_derecho', 'nariz_izquierda', SHA, []).warnings[0],
      checkShotView('general', 'indeterminado', SHA, []).warnings[0],
    ];
    for (const text of texts) {
      expect(text).not.toMatch(/acn[eé]|lesi[oó]n|severidad|IGA/i);
    }
  });
});
