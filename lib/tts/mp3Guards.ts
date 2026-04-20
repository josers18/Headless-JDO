/** Detect raw MP3 (ID3v2 tag or MPEG frame sync). */
export function isLikelyMp3Buffer(buf: Uint8Array | Buffer): boolean {
  const u = buf instanceof Buffer ? new Uint8Array(buf) : buf;
  if (u.length < 4) return false;
  const b0 = u[0]!;
  const b1 = u[1]!;
  if (b0 === 0x49 && b1 === 0x44 && u[2] === 0x33) return true;
  return b0 === 0xff && (b1 & 0xe0) === 0xe0;
}
