import { readFileSync } from 'node:fs';

/** PNG file signature (first 8 bytes). */
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface PngDimensions {
  width: number;
  height: number;
}

/** Read PNG width/height from the IHDR chunk. Fast sync path: reads only
 * the first 24 bytes. Throws if the file is not a PNG. */
export function readPngDimensions(absPath: string): PngDimensions {
  const fd = readFileSync(absPath, { encoding: null }).subarray(0, 24);
  if (fd.length < 24 || !fd.subarray(0, 8).equals(PNG_SIG)) {
    throw new Error(`not a PNG: ${absPath}`);
  }
  // IHDR starts at byte 8; width = bytes 16..19 BE, height = bytes 20..23 BE.
  const width = fd.readUInt32BE(16);
  const height = fd.readUInt32BE(20);
  return { width, height };
}
