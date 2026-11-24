/** Lowercase hex encoding (`Uint8Array.prototype.toString` takes no encoding). */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}
