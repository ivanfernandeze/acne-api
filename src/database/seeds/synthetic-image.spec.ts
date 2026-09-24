import { IGA_CLASSES, type IgaClass } from 'src/common/domain';

import { buildSyntheticFaceImage } from './synthetic-image';

/**
 * Regression tests for a defect that made the seeded dataset self-contradictory: the image's lesion
 * load was drawn at random and had no relationship whatsoever with the case's `ground_truth_iga`.
 * A `severo` case could carry seven faint spots and a `leve` one fourteen, so no model could score
 * above chance on it and any TPD measured against those images was noise.
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Counts pixels reddened enough to be a lesion, as a proxy for the lesion load. */
function lesionLoad(png: Buffer): number {
  // Decoding the PNG would need a dependency; the encoder is ours and deflate is deterministic, so
  // the compressed size tracks the amount of painted detail closely enough to rank severities.
  return png.length;
}

describe('buildSyntheticFaceImage', () => {
  it('produces a lesion load that grows monotonically with the IGA class', () => {
    // Averaged over many draws: a single image can fall anywhere inside its class's range, and the
    // ranges of adjacent classes are meant to touch.
    const meanLoad = (igaClass: IgaClass): number => {
      let total = 0;
      for (let seed = 1; seed <= 40; seed++) {
        total += lesionLoad(buildSyntheticFaceImage(mulberry32(seed), igaClass, 96));
      }
      return total / 40;
    };

    const loads = IGA_CLASSES.map(meanLoad);
    for (let i = 1; i < loads.length; i++) {
      expect(loads[i]).toBeGreaterThan(loads[i - 1] as number);
    }
  });

  it('separates the extremes clearly, which is what a classifier has to see', () => {
    const clean = lesionLoad(buildSyntheticFaceImage(mulberry32(7), 'sin_lesiones', 96));
    const severe = lesionLoad(buildSyntheticFaceImage(mulberry32(7), 'severo', 96));
    expect(severe).toBeGreaterThan(clean * 1.2);
  });

  it('is deterministic: the same seed and class give byte-identical output', () => {
    const first = buildSyntheticFaceImage(mulberry32(99), 'moderado', 96);
    const second = buildSyntheticFaceImage(mulberry32(99), 'moderado', 96);
    expect(first.equals(second)).toBe(true);
  });

  it('consumes the outer generator identically regardless of the class', () => {
    // THE load-bearing test. Review times, diagnoses, journeys and questionnaires all draw from the
    // same generator as the images. If the number of draws varied with the class, every downstream
    // measurement in the study would silently change — TRM, TPD, TCAD and all four contrasts.
    const draws = (igaClass: IgaClass): number => {
      let calls = 0;
      const base = mulberry32(4242);
      buildSyntheticFaceImage(() => {
        calls++;
        return base();
      }, igaClass, 32);
      return calls;
    };

    const counts = IGA_CLASSES.map(draws);
    expect(new Set(counts).size).toBe(1);
  });
});
