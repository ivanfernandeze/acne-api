/**
 * Format detection from the file's own bytes.
 *
 * The `mimetype` on a multipart part is whatever the client typed in the `Content-Type` header; it
 * is not evidence of anything. Behind a JWT that was tolerable, but the mobile capture endpoint is
 * authorised by a QR token alone, so what actually lands in the clinical record has to be decided by
 * reading the file, not by believing the uploader.
 *
 * Only the three formats `ImagesService` accepts are recognised; anything else returns `null` and
 * the caller rejects the upload.
 */
export type SniffedImageType = 'image/jpeg' | 'image/png' | 'image/webp';

export function sniffImageType(buffer: Buffer): SniffedImageType | null {
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer.length >= 8 &&
    buffer.readUInt32BE(0) === 0x89504e47 &&
    buffer.readUInt32BE(4) === 0x0d0a1a0a
  ) {
    return 'image/png';
  }

  // JPEG: starts FF D8 FF and ends FF D9. The trailer is checked too because a truncated upload is
  // a real failure mode on a phone that loses Wi-Fi mid-request, and a half-written photograph in a
  // clinical record is worse than a rejected one.
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    const endsProperly =
      buffer[buffer.length - 2] === 0xff && buffer[buffer.length - 1] === 0xd9;
    return endsProperly ? 'image/jpeg' : null;
  }

  // WebP: "RIFF" .... "WEBP"
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }

  return null;
}
