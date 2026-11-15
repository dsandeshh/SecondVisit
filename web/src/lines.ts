// Voice line ids: id = sha1(utf8(text trimmed, whitespace runs collapsed to one space)).hex[:12], case kept.
// Same rule as engine/dr/voice_lines.py line_id (docs/CHANGELOG.md, Landmark.spoken). Synchronous on purpose:
// the caption and the clip lookup must agree in the same tick.
export const normaliseLine = (text: string): string => text.trim().replace(/\s+/g, " ");

function sha1(bytes: Uint8Array): string {
  const rol = (x: number, n: number) => (x << n) | (x >>> (32 - n));
  const n = bytes.length, padded = new Uint8Array(((n + 9 + 63) >> 6) << 6);
  padded.set(bytes); padded[n] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, Math.floor((n * 8) / 4294967296)); dv.setUint32(padded.length - 4, (n * 8) >>> 0);
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);
  for (let o = 0; o < padded.length; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
    for (let i = 16; i < 80; i++) w[i] = rol(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i++) {
      const [f, k] = i < 20 ? [(b & c) | (~b & d), 0x5a827999] : i < 40 ? [b ^ c ^ d, 0x6ed9eba1]
        : i < 60 ? [(b & c) | (b & d) | (c & d), 0x8f1bbcdc] : [b ^ c ^ d, 0xca62c1d6];
      const t = (rol(a, 5) + f + e + k + w[i]) >>> 0;
      e = d; d = c; c = rol(b, 30) >>> 0; b = a; a = t;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }
  return [h0, h1, h2, h3, h4].map(x => x.toString(16).padStart(8, "0")).join("");
}

export const lineId = (text: string): string => sha1(new TextEncoder().encode(normaliseLine(text))).slice(0, 12);
