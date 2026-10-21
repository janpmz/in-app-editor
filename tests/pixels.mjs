import { inflateSync } from 'node:zlib';

function decode(encoded) {
  const png = Buffer.from(encoded, 'base64');
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20), type = png[25];
  if (png[24] !== 8 || ![2, 6].includes(type)) throw new Error('Expected an 8-bit RGB or RGBA screenshot');
  const channels = type === 6 ? 4 : 3, chunks = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    if (png.toString('ascii', offset + 4, offset + 8) === 'IDAT') chunks.push(png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const packed = inflateSync(Buffer.concat(chunks)), stride = width * channels, pixels = Buffer.alloc(height * stride);
  function paeth(a, b, c) { const p = a + b - c, x = Math.abs(p - a), y = Math.abs(p - b), z = Math.abs(p - c); return x <= y && x <= z ? a : y <= z ? b : c; }
  for (let y = 0; y < height; y++) {
    const filter = packed[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? pixels[y * stride + x - channels] : 0, above = y ? pixels[(y - 1) * stride + x] : 0, diagonal = y && x >= channels ? pixels[(y - 1) * stride + x - channels] : 0;
      const value = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? above : filter === 3 ? Math.floor((left + above) / 2) : filter === 4 ? paeth(left, above, diagonal) : NaN;
      if (!Number.isFinite(value)) throw new Error('Unknown PNG filter');
      pixels[y * stride + x] = (packed[y * (stride + 1) + 1 + x] + value) & 255;
    }
  }
  return { width, height, channels, pixels };
}

export function comparePNG(before, after, tolerance = 0) {
  const a = decode(before), b = decode(after);
  if (a.width !== b.width || a.height !== b.height) throw new Error('Screenshot sizes differ');
  let changed = 0;
  for (let index = 0; index < a.width * a.height; index++) {
    if ([0, 1, 2].some((channel) => Math.abs(a.pixels[index * a.channels + channel] - b.pixels[index * b.channels + channel]) > tolerance)) changed++;
  }
  return { changed, total: a.width * a.height, ratio: changed / (a.width * a.height) };
}
