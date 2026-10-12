// Browser stand-in for node:crypto (offline server in the WebView): the few calls the lobby / network make.
const hexOf = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('');
export function randomBytes(n) {
  const u8 = new Uint8Array(n);
  globalThis.crypto.getRandomValues(u8);
  return { length: n, bytes: u8, toString: (enc) => (enc === 'hex' || !enc ? hexOf(u8) : btoa(String.fromCharCode(...u8))) };
}
export function randomInt(a, b) {
  const [min, max] = b === undefined ? [0, a] : [a, b];
  const span = max - min;
  const u32 = new Uint32Array(2);
  globalThis.crypto.getRandomValues(u32);
  return min + Math.floor(((u32[0] * 2 ** 21 + (u32[1] >>> 11)) / 2 ** 53) * span);
}
export function createHash() { throw new Error('createHash is not available offline'); }
export default { randomBytes, randomInt, createHash };
