/**
 * Minimal PNG/JPEG header parser.
 *
 * Reads the intrinsic dimensions of a clinical image without pulling in a native image library:
 * the API only needs width and height for the record and for the RNF-01 latency note, and adding
 * `sharp` would introduce a native build step on the examiner's machine for no clinical benefit.
 * Returns `null` when the format is not recognised, which callers treat as "unknown dimensions".
 */
export interface ImageDimensions {
  width: number;
  height: number;
}

export function readImageDimensions(buffer: Buffer): ImageDimensions | null {
  return readPng(buffer) ?? readJpeg(buffer);
}

function readPng(buffer: Buffer): ImageDimensions | null {
  // Signature 89 50 4E 47 0D 0A 1A 0A, then the IHDR chunk with width/height at bytes 16..23.
  if (buffer.length < 24) return null;
  if (buffer.readUInt32BE(0) !== 0x89504e47 || buffer.readUInt32BE(4) !== 0x0d0a1a0a) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function readJpeg(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 4 || buffer.readUInt16BE(0) !== 0xffd8) return null;

  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = buffer[offset + 1];
    if (marker === undefined) return null;

    // SOF0..SOF15, excluding the DHT/JPG/DAC markers that share the range.
    const isStartOfFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isStartOfFrame) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }

    const segmentLength = buffer.readUInt16BE(offset + 2);
    if (segmentLength <= 0) return null;
    offset += 2 + segmentLength;
  }
  return null;
}
