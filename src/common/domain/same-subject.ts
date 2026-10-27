import { REQUIRED_SHOT_KEYS, shotLabel, type ShotKey } from './capture';
import type { ShotViewCheck } from './shot-view';

/**
 * Are all the photographs of a case of the same person?
 *
 * Until 25/10/2026 each photograph was screened on its own, so the frontal view of one patient and
 * the profiles of another made a "complete" protocol. The engine now compares the candidate's face
 * with the case's other shots (OpenCV SFace, thresholds per pair of head poses) and says, for each
 * one, `misma`, `distinta` or `sin_rostro`; this decides what that means for the upload.
 *
 * Strict by the research team's decision where a comparison is possible: under the threshold is a
 * refusal, with no "doubtful" warning band — a retake costs seconds, a case that mixes two people
 * costs a diagnosis. Where it is not (`sin_rostro`: no face whole in the frame, typically a clinical
 * shot cut at the eyes) it only warns: the calibrated thresholds say nothing about such a face, and
 * refusing it refused real patients. Identity only, like the rest of the screening: it says nothing
 * about the skin (RF-TR-01), and nothing biometric is stored.
 */

/** Shots that show the face and therefore take part in the comparison. Trunk shots do not. */
export const IDENTITY_SHOT_KEYS: readonly ShotKey[] = [
  'general',
  'perfil_derecho',
  'perfil_izquierdo',
  'acercamiento',
  'borde',
  'otra',
];

export function takesPartInIdentity(shotKey: ShotKey | null): boolean {
  return shotKey === null || IDENTITY_SHOT_KEYS.includes(shotKey);
}

export type IdentityVerdict = 'misma' | 'distinta' | 'sin_rostro';

/** The engine's reading, with each comparison keyed by the shot it was made against. */
export interface IdentityReading {
  /** The candidate has a face clear enough to compare. */
  faceFound: boolean;
  comparisons: ReadonlyArray<{
    shotKey: ShotKey;
    verdict: IdentityVerdict;
    nearDuplicate: boolean;
  }>;
}

function isRequired(shotKey: ShotKey | null): boolean {
  return shotKey !== null && REQUIRED_SHOT_KEYS.includes(shotKey);
}

function quoted(keys: readonly ShotKey[]): string {
  const labels = keys.map((key) => `«${shotLabel(key)}»`);
  return labels.length <= 1
    ? (labels[0] ?? '')
    : `${labels.slice(0, -1).join(', ')} y ${labels[labels.length - 1]}`;
}

/**
 * @param identity null when nothing was compared because screening is switched off
 *   (`IMAGE_SCREENING_ENABLED=false`); the rule is then skipped. An engine that could not compare
 *   never reaches here: the upload is refused before (503).
 */
export function checkSameSubject(
  shotKey: ShotKey | null,
  identity: IdentityReading | null,
): ShotViewCheck {
  if (identity === null || !takesPartInIdentity(shotKey)) return { rejection: null, warnings: [] };
  const label = shotKey === null ? 'esta fotografía' : `la «${shotLabel(shotKey)}»`;

  const duplicate = identity.comparisons.find((c) => c.nearDuplicate);
  if (duplicate) {
    return {
      rejection:
        `Esta fotografía es la misma que ya está registrada como «${shotLabel(duplicate.shotKey)}», ` +
        'aunque se haya reenviado, recortado o recomprimido. Cada toma necesita su propia fotografía.',
      warnings: [],
    };
  }

  // A face cut at the eyes cannot be compared, and a clinical shot framed on the cheeks often is.
  // Refusing it would refuse real patients (25/10/2026: a "Vista general" cut at the eyes scored
  // 0,20 against the same patient's profile), so it only warns; whoever reviews sees the photos.
  if (!identity.faceFound) {
    // Except the general view: it IS the whole face from the front (its own instruction says so),
    // and it is the anchor every other shot is compared with. Without it nothing in the case can
    // be verified — and a stranger's profile next to two cropped shots would pass.
    if (shotKey === 'general') {
      return {
        rejection:
          'La «Vista general» debe mostrar el rostro completo de frente, con los dos ojos, la ' +
          'nariz y la boca dentro de la foto: es la toma con la que se comprueba que todas sean ' +
          'del mismo paciente. Tómela de nuevo un poco más lejos.',
        warnings: [],
      };
    }
    return {
      rejection: null,
      warnings: [
        `No se pudo comprobar que ${label} sea del mismo paciente: en la foto no se ven completos ` +
          'los ojos y el resto del rostro. Revise usted que sea la misma persona.',
      ],
    };
  }

  const different = identity.comparisons
    .filter((c) => c.verdict === 'distinta')
    .map((c) => c.shotKey);
  if (different.length > 0) {
    return {
      rejection:
        `Esta fotografía no corresponde a la misma persona que ${quoted(different)}. Todas las ` +
        'tomas del caso deben ser del mismo paciente. Si la equivocada es la que ya estaba ' +
        'registrada, retírela y vuelva a subirla.',
      warnings: [],
    };
  }

  // Required shots on file whose face cannot be compared are left out of the check. Said only when
  // nothing at all confirmed the identity; one match with another shot is enough to stay quiet.
  const confirmed = identity.comparisons.some((c) => c.verdict === 'misma');
  const unverifiable = identity.comparisons
    .filter((c) => c.verdict === 'sin_rostro' && isRequired(c.shotKey))
    .map((c) => c.shotKey);
  if (!confirmed && unverifiable.length > 0) {
    return {
      rejection: null,
      warnings: [
        `No se pudo comparar esta fotografía con ${quoted(unverifiable)}: en esa toma no se ven ` +
          'completos los ojos y el resto del rostro. Revise usted que sea la misma persona.',
      ],
    };
  }

  return { rejection: null, warnings: [] };
}
