import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const source = resolve('logo-256x256.png');
const target = resolve(process.env.AWH_ICON_OUT?.trim() || process.env.ART_AGENT_ICON_OUT?.trim() || '.awh-build/awh.ico');
const png = await readFile(source);
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

if (png.length < 24 || !png.subarray(0, 8).equals(pngSignature)) {
  throw new Error('logo-256x256.png is not a valid PNG');
}
if (png.toString('ascii', 12, 16) !== 'IHDR') {
  throw new Error('logo-256x256.png has no PNG IHDR header');
}
const width = png.readUInt32BE(16);
const height = png.readUInt32BE(20);
if (width !== 256 || height !== 256) {
  throw new Error(`Windows icon source must stay 256x256; received ${width}x${height}`);
}

// ICO supports a PNG-compressed 256x256 image. Wrapping the canonical PNG keeps
// the canonical AWH artwork byte-for-byte intact while giving Windows/Squirrel
// the .ico container they require for the executable and installer. The legacy
// ART_AGENT_ICON_OUT variable remains a compatibility alias for local tooling.
const header = Buffer.alloc(22);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // image type: icon
header.writeUInt16LE(1, 4); // one image
header.writeUInt8(0, 6); // 0 means 256 px
header.writeUInt8(0, 7); // 0 means 256 px
header.writeUInt8(0, 8); // true color
header.writeUInt8(0, 9); // reserved
header.writeUInt16LE(1, 10); // color planes
header.writeUInt16LE(32, 12); // bits per pixel
header.writeUInt32LE(png.length, 14);
header.writeUInt32LE(header.length, 18);

await mkdir(dirname(target), { recursive: true });
await writeFile(target, Buffer.concat([header, png]));
console.log(target);
