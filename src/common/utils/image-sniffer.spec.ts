import { sniffImageType } from './image-sniffer';

/**
 * This is what stands between the public capture endpoint and whatever a caller decides to POST.
 * Behind a JWT the declared `Content-Type` was a tolerable proxy for the truth; on a route
 * authorised only by a QR token it is not evidence of anything.
 */
describe('sniffImageType', () => {
  const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
  const jpeg = (body: Buffer, closed = true): Buffer =>
    Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      body,
      closed ? Buffer.from([0xff, 0xd9]) : Buffer.alloc(0),
    ]);
  const WEBP = Buffer.concat([
    Buffer.from('RIFF', 'ascii'),
    Buffer.from([0, 0, 0, 0]),
    Buffer.from('WEBP', 'ascii'),
  ]);

  it('recognises the three formats the clinical record accepts', () => {
    expect(sniffImageType(PNG_HEADER)).toBe('image/png');
    expect(sniffImageType(jpeg(Buffer.from([0x00, 0x10])))).toBe('image/jpeg');
    expect(sniffImageType(WEBP)).toBe('image/webp');
  });

  it('rejects a file that merely claims to be an image', () => {
    expect(sniffImageType(Buffer.from('esto no es una imagen'))).toBeNull();
  });

  it('rejects a JPEG that never finished uploading', () => {
    // A photograph cut off when the phone lost Wi-Fi. Half a picture in a clinical record is worse
    // than a rejected upload, because nothing downstream would flag it.
    expect(sniffImageType(jpeg(Buffer.from([0x00, 0x10]), false))).toBeNull();
  });

  it('rejects an empty or too-short buffer instead of reading past its end', () => {
    expect(sniffImageType(Buffer.alloc(0))).toBeNull();
    expect(sniffImageType(Buffer.from([0x89, 0x50]))).toBeNull();
    expect(sniffImageType(Buffer.from('RIFF', 'ascii'))).toBeNull();
  });

  it('rejects a RIFF container that is not WebP', () => {
    const wav = Buffer.concat([
      Buffer.from('RIFF', 'ascii'),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from('WAVE', 'ascii'),
    ]);
    expect(sniffImageType(wav)).toBeNull();
  });
});
