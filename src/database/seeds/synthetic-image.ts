import { deflateSync } from 'node:zlib';

import type { IgaClass } from 'src/common/domain';

/**
 * Minimal PNG encoder for the synthetic seed.
 *
 * The demo needs images that actually render — a case view with a broken thumbnail is a poor
 * rehearsal for the defence — but shipping real clinical photographs in a seed would be both a
 * data-protection problem and a lie about provenance. So the seed paints its own placeholders:
 * a skin-tone field with lesion-like blobs and, for the postest pass, a Grad-CAM-style heat
 * overlay. No dependency, no native build step.
 */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = -1;
  for (const byte of buffer) crc = (crc >>> 8) ^ (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0);
  return (crc ^ -1) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Encodes an RGB pixel buffer (width * height * 3 bytes) as a PNG. */
export function encodePng(width: number, height: number, pixels: Buffer): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // Each scanline is prefixed with filter type 0 (None).
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 3);
    raw[rowStart] = 0;
    pixels.copy(raw, rowStart + 1, y * width * 3, (y + 1) * width * 3);
  }

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Lesion load per IGA class: count, radius and inflammation all climb with severity. */
const LESION_PROFILE: Readonly<Record<IgaClass, { min: number; max: number; radius: number; redness: number }>> = {
  sin_lesiones: { min: 0, max: 1, radius: 3.5, redness: 0.25 },
  casi_sin_lesiones: { min: 2, max: 4, radius: 4.5, redness: 0.4 },
  leve: { min: 5, max: 10, radius: 5.5, redness: 0.55 },
  moderado: { min: 11, max: 20, radius: 7, redness: 0.75 },
  severo: { min: 21, max: 35, radius: 9, redness: 1 },
};

/**
 * A placeholder "clinical" image: a skin-tone field whose lesion load MATCHES its IGA class.
 *
 * It used to draw `6 + floor(rng() * 10)` blobs regardless of the label, so a case marked `severo`
 * could carry seven faint spots and a `leve` one fourteen. The correlation between image and label
 * was exactly zero, which made the dataset internally contradictory and made it impossible for ANY
 * model — this project's CNN included — to score above chance on it. That was a defect, not a
 * simplification.
 *
 * The outer generator is consumed EXACTLY as before — one draw for the count, four per drawn blob —
 * and the lesion field is then built from a local generator seeded with those values. Keeping the
 * call count identical is what stops the whole downstream stream from shifting: review times,
 * diagnoses, journeys and questionnaires all draw from the same `rng`, and a single extra call would
 * silently change every indicator in the study.
 */
export function buildSyntheticFaceImage(
  rng: () => number,
  igaClass: IgaClass,
  size = 256,
): Buffer {
  const pixels = Buffer.alloc(size * size * 3);
  const base: Rgb = { r: 226, g: 188, b: 164 };

  // --- Consume the outer stream exactly as the previous version did -----------
  const drawnCount = 6 + Math.floor(rng() * 10);
  const drawn = Array.from({ length: drawnCount }, () => ({
    x: rng(),
    y: rng(),
    radius: rng(),
    strength: rng(),
  }));

  // --- Build the lesion field from a local generator seeded by those draws -----
  const profile = LESION_PROFILE[igaClass];
  const local = mulberry32(seedFrom(drawn));
  const count = profile.min + Math.floor(local() * (profile.max - profile.min + 1));

  const blobs = Array.from({ length: count }, () => {
    // Lesions cluster on the face, not on the background, so they stay inside a central disc.
    const angle = local() * Math.PI * 2;
    const distance = Math.sqrt(local()) * size * 0.38;
    return {
      x: size / 2 + Math.cos(angle) * distance,
      y: size / 2 + Math.sin(angle) * distance,
      radius: profile.radius * (0.7 + local() * 0.6),
      strength: profile.redness * (0.65 + local() * 0.45),
    };
  });

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Radial falloff towards the edges, so the field reads as a face-shaped subject.
      const dx = (x - size / 2) / (size / 2);
      const dy = (y - size / 2) / (size / 2);
      const vignette = Math.max(0, 1 - 0.55 * Math.sqrt(dx * dx + dy * dy));

      let r = base.r * (0.75 + 0.25 * vignette);
      let g = base.g * (0.75 + 0.25 * vignette);
      let b = base.b * (0.75 + 0.25 * vignette);

      for (const blob of blobs) {
        const distance = Math.hypot(x - blob.x, y - blob.y);
        if (distance < blob.radius) {
          const intensity = blob.strength * (1 - distance / blob.radius);
          // Inflammation reddens: green and blue drop far more than red, so a severe field reads
          // as angry rather than merely dirty.
          r -= 18 * intensity;
          g -= 95 * intensity;
          b -= 92 * intensity;
        }
      }

      const offset = (y * size + x) * 3;
      pixels[offset] = clamp(r);
      pixels[offset + 1] = clamp(g);
      pixels[offset + 2] = clamp(b);
    }
  }

  return encodePng(size, size, pixels);
}

/** Folds the drawn values into a 32-bit seed for the local generator. */
function seedFrom(drawn: ReadonlyArray<{ x: number; y: number }>): number {
  let hash = 0x811c9dc5;
  for (const item of drawn) {
    hash = Math.imul(hash ^ Math.floor(item.x * 0xffff), 16777619) >>> 0;
    hash = Math.imul(hash ^ Math.floor(item.y * 0xffff), 16777619) >>> 0;
  }
  return hash >>> 0;
}

/** Mulberry32, the same tiny generator the seeder uses for the study itself. */
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

/** A Grad-CAM-style overlay: warm blobs over a dimmed copy of the subject. */
export function buildSyntheticHeatmap(rng: () => number, size = 256): Buffer {
  const pixels = Buffer.alloc(size * size * 3);
  const hotspots = Array.from({ length: 3 }, () => ({
    x: size * (0.25 + rng() * 0.5),
    y: size * (0.25 + rng() * 0.5),
    radius: size * (0.12 + rng() * 0.16),
  }));

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let heat = 0;
      for (const spot of hotspots) {
        const distance = Math.hypot(x - spot.x, y - spot.y);
        heat = Math.max(heat, Math.max(0, 1 - distance / spot.radius));
      }

      // Blue (cold) → red (hot), over a dark background, the usual Grad-CAM reading.
      const offset = (y * size + x) * 3;
      pixels[offset] = clamp(40 + 215 * heat);
      pixels[offset + 1] = clamp(40 + 140 * Math.max(0, 1 - Math.abs(heat - 0.5) * 2));
      pixels[offset + 2] = clamp(90 + 120 * (1 - heat));
    }
  }

  return encodePng(size, size, pixels);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}
