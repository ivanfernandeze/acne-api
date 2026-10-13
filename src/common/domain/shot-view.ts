import { shotLabel, type ShotKey } from './capture';

/**
 * Does the photograph match the shot it was filed under?
 *
 * Until now the only check was that the three required labels existed, so the same left profile
 * uploaded into all three slots satisfied the protocol. The engine's admission screener reports
 * the head pose (from YuNet's eye and nose landmarks); this decides what that means per shot.
 *
 * Geometry only, like the rest of the screening: it runs at intake in both experimental conditions
 * and says nothing about the skin (RF-TR-01).
 */

/**
 * `nariz_*` is the side of the IMAGE the nose points to, not the patient's side. A photo taken by
 * someone else with the rear camera is not mirrored; a front-camera selfie may be.
 */
export const HEAD_POSES = ['frontal', 'nariz_derecha', 'nariz_izquierda', 'indeterminado'] as const;
export type HeadPose = (typeof HEAD_POSES)[number];

export function isHeadPose(value: unknown): value is HeadPose {
  return typeof value === 'string' && (HEAD_POSES as readonly string[]).includes(value);
}

/**
 * The pose each profile shows with the rear camera, following the instructions of
 * `SHOT_DEFINITIONS`: "gire el rostro hacia la izquierda para fotografiar la mejilla derecha" — the
 * patient's left is the image's right, so the nose points to the right edge of the picture.
 */
const EXPECTED_PROFILE_POSE: Readonly<Partial<Record<ShotKey, HeadPose>>> = {
  perfil_derecho: 'nariz_derecha',
  perfil_izquierdo: 'nariz_izquierda',
};

const OPPOSITE_PROFILE: Readonly<Partial<Record<ShotKey, ShotKey>>> = {
  perfil_derecho: 'perfil_izquierdo',
  perfil_izquierdo: 'perfil_derecho',
};

/** An image already in the case, as far as this check needs to know it. */
export interface ShotSibling {
  id: string;
  shotKey: ShotKey | null;
  sha256: string;
  pose: HeadPose | null;
}

export interface ShotViewCheck {
  /** Set when the photograph must not be filed under this shot (HTTP 422). */
  rejection: string | null;
  /** Accepted, but worth a second look. */
  warnings: string[];
}

function isTurned(pose: HeadPose | null): pose is 'nariz_derecha' | 'nariz_izquierda' {
  return pose === 'nariz_derecha' || pose === 'nariz_izquierda';
}

/**
 * @param pose what the screener measured; null when nothing was measured (screening off, engine
 *   down, a backend that does not report pose). The pose rules are then skipped — failing open,
 *   exactly like the screening itself.
 * @param siblings the case's other photographs, oldest first (heatmaps excluded). For each shot the
 *   LAST one counts, as everywhere else in the case.
 */
export function checkShotView(
  shotKey: ShotKey | null,
  pose: HeadPose | null,
  sha256: string,
  siblings: readonly ShotSibling[],
): ShotViewCheck {
  if (shotKey === null) return { rejection: null, warnings: [] };

  const duplicate = siblings.find(
    (other) => other.sha256 === sha256 && other.shotKey !== null && other.shotKey !== shotKey,
  );
  if (duplicate) {
    return {
      rejection:
        `Esta misma fotografía ya está registrada como «${shotLabel(duplicate.shotKey!)}». ` +
        'Cada toma necesita su propia fotografía.',
      warnings: [],
    };
  }

  const label = shotLabel(shotKey);
  if (pose === null) return { rejection: null, warnings: [] };

  if (shotKey === 'general') {
    if (isTurned(pose)) {
      return {
        rejection:
          `La «${label}» debe tomarse de frente, y en la fotografía el rostro está girado. ` +
          'Pida al paciente que mire directo a la cámara, o suba esta foto como perfil.',
        warnings: [],
      };
    }
    if (pose === 'indeterminado') {
      return {
        rejection: null,
        warnings: [`No se pudo comprobar que la «${label}» esté de frente; revísela.`],
      };
    }
    return { rejection: null, warnings: [] };
  }

  const expected = EXPECTED_PROFILE_POSE[shotKey];
  if (expected === undefined) return { rejection: null, warnings: [] };

  if (pose === 'frontal') {
    return {
      rejection:
        `El «${label}» debe tomarse con el rostro girado, y la fotografía está de frente. ` +
        'Pida al paciente que gire la cabeza, o suba esta foto como «Vista general».',
      warnings: [],
    };
  }
  if (pose === 'indeterminado') {
    return {
      rejection: null,
      warnings: [`No se pudo comprobar la orientación del «${label}»; revísela.`],
    };
  }

  const opposite = OPPOSITE_PROFILE[shotKey]!;
  const otherProfile = [...siblings].reverse().find((other) => other.shotKey === opposite);
  if (otherProfile && otherProfile.pose === pose) {
    return {
      rejection:
        `El «${label}» y el «${shotLabel(opposite)}» muestran el rostro girado hacia el mismo ` +
        'lado. Cada perfil debe mostrar una mejilla distinta.',
      warnings: [],
    };
  }

  if (pose !== expected) {
    return {
      rejection: null,
      warnings: [
        `Compruebe que sea el «${label}»: la fotografía parece mostrar el otro lado. ` +
          'Si se tomó con la cámara frontal (imagen espejada), ignore este aviso.',
      ],
    };
  }
  return { rejection: null, warnings: [] };
}
