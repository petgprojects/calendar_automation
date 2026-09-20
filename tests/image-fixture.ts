import { deflateSync } from "node:zlib";
export function samplePng() {
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const byte of b) {
      c ^= byte;
      for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, b: Buffer) => {
    const t = Buffer.from(type),
      size = Buffer.alloc(4),
      sum = Buffer.alloc(4);
    size.writeUInt32BE(b.length);
    sum.writeUInt32BE(crc(Buffer.concat([t, b])));
    return Buffer.concat([size, t, b, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(320);
  header.writeUInt32BE(140, 4);
  header[8] = 8;
  header[9] = 2;
  const raw = Buffer.alloc((320 * 3 + 1) * 140);
  for (let y = 0; y < 140; y++)
    for (let x = 0; x < 320; x++) {
      const p = y * (320 * 3 + 1) + 1 + x * 3;
      raw[p] = x < 160 ? 30 : 235;
      raw[p + 1] = 100;
      raw[p + 2] = y < 70 ? 185 : 75;
    }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
