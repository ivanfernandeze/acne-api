import { deflateSync } from 'node:zlib';

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

/**
 * A placeholder "clinical" image: a skin-tone gradient with a few darker blobs standing in for
 * lesions. Deterministic given `rng`, so the seed stays reproducible (RNF-03).
 */
export function buildSyntheticFaceImage(rng: () => number, size = 256): Buffer {
  const pixels = Buffer.alloc(size * size * 3);

  const base: Rgb = { r: 226, g: 188, b: 164 };
  const blobCount = 6 + Math.floor(rng() * 10);
  const blobs = Array.from({ length: blobCount }, () => ({
    x: rng() * size,
    y: rng() * size,
    radius: 4 + rng() * 9,
    strength: 0.35 + rng() * 0.4,
  }));

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
          r -= 55 * intensity;
          g -= 85 * intensity;
          b -= 80 * intensity;
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
