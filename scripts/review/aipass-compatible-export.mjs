import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const MAX_NATIVE_BYTES = 28 * 1024 * 1024;
const A4 = [595.28, 841.89];

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosTimeDate(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

function zipEntries(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  const stamp = dosTimeDate();
  for (const entry of entries) {
    const name = Buffer.from(entry.name.replaceAll('\\', '/'), 'utf8');
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    const compressed = deflateRawSync(raw, { level: 6 });
    const useDeflate = compressed.length < raw.length;
    const body = useDeflate ? compressed : raw;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(raw);
    const flags = 0x0800;
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(flags, 6);
    head.writeUInt16LE(method, 8);
    head.writeUInt16LE(stamp.time, 10);
    head.writeUInt16LE(stamp.day, 12);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(body.length, 18);
    head.writeUInt32LE(raw.length, 22);
    head.writeUInt16LE(name.length, 26);
    local.push(head, name, body);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(flags, 8);
    dir.writeUInt16LE(method, 10);
    dir.writeUInt16LE(stamp.time, 12);
    dir.writeUInt16LE(stamp.day, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(body.length, 20);
    dir.writeUInt32LE(raw.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, name);
    offset += head.length + name.length + body.length;
  }
  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBytes, end]);
}

function xml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function paragraph(lines, style = 'Normal') {
  const runs = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (i > 0) runs.push('<w:r><w:br/></w:r>');
    const line = lines[i] === '' ? ' ' : lines[i];
    runs.push(`<w:r><w:t xml:space="preserve">${xml(line)}</w:t></w:r>`);
  }
  return `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr>${runs.join('')}</w:p>`;
}

function textBlocks(text, style = 'Normal', lineNumbers = false) {
  const lines = String(text).replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');
  const prepared = lineNumbers
    ? lines.map((line, index) => `${String(index + 1).padStart(6, '0')} | ${line}`)
    : lines;
  const out = [];
  for (let i = 0; i < prepared.length; i += 100) out.push(paragraph(prepared.slice(i, i + 100), style));
  return out.join('');
}

function docxBytes({ title, subtitle, sections }) {
  const body = [
    paragraph([title], 'Title'),
    paragraph([subtitle], 'Subtitle'),
  ];
  for (const section of sections) {
    body.push(paragraph([section.title], 'Heading1'));
    if (section.note) body.push(paragraph([section.note], 'Note'));
    body.push(textBlocks(section.text, section.code ? 'Code' : 'Normal', section.lineNumbers === true));
  }
  body.push('<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>');

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join('')}</w:body></w:document>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial"/><w:lang w:val="en-US" w:eastAsia="th-TH"/></w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:sz w:val="20"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="34"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:rPr><w:sz w:val="20"/><w:color w:val="666666"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Note"><w:name w:val="Note"/><w:basedOn w:val="Normal"/><w:rPr><w:i/><w:color w:val="555555"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:eastAsia="Arial"/><w:sz w:val="16"/></w:rPr><w:pPr><w:spacing w:after="0"/></w:pPr></w:style></w:styles>`;
  const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
  const documentRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const now = new Date().toISOString();
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(title)}</dc:title><dc:creator>AWH</dc:creator><cp:lastModifiedBy>AWH</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
  const app = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Art's Workspace Hub</Application></Properties>`;

  return zipEntries([
    { name: '[Content_Types].xml', data: Buffer.from(types) },
    { name: '_rels/.rels', data: Buffer.from(rootRels) },
    { name: 'word/document.xml', data: Buffer.from(document) },
    { name: 'word/styles.xml', data: Buffer.from(styles) },
    { name: 'word/_rels/document.xml.rels', data: Buffer.from(documentRels) },
    { name: 'docProps/core.xml', data: Buffer.from(core) },
    { name: 'docProps/app.xml', data: Buffer.from(app) },
  ]);
}

function walkFiles(root) {
  const out = [];
  const visit = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      const info = statSync(path);
      if (info.isDirectory()) visit(path);
      else if (info.isFile()) out.push(path);
    }
  };
  visit(root);
  return out;
}

function safeRead(path) {
  return readFileSync(path, 'utf8');
}

function assertNativeSize(path) {
  const bytes = statSync(path).size;
  if (bytes < 100 || bytes > MAX_NATIVE_BYTES) throw new Error(`AiPASS-compatible export size is invalid: ${path} (${bytes} bytes)`);
  return bytes;
}

async function createVisualPdf(stage, output) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const imageRoots = ['visual-evidence', 'comparison-evidence']
    .map((name) => join(stage, name))
    .filter((path) => {
      try { return statSync(path).isDirectory(); } catch { return false; }
    });
  const images = imageRoots.flatMap((root) => walkFiles(root).filter((path) => path.toLowerCase().endsWith('.png')));

  const cover = pdf.addPage(A4);
  cover.drawText('AWH AiPASS Visual Evidence', { x: 48, y: 780, size: 20, font });
  cover.drawText('Screenshots are evidence only; CURRENT_REVISION in the context DOCX is authoritative.', { x: 48, y: 752, size: 9, font, maxWidth: 500 });
  cover.drawText(`Images: ${images.length}`, { x: 48, y: 730, size: 10, font });

  for (const imagePath of images) {
    const image = await pdf.embedPng(readFileSync(imagePath));
    const page = pdf.addPage(A4);
    const margin = 28;
    const labelHeight = 24;
    const maxWidth = A4[0] - margin * 2;
    const maxHeight = A4[1] - margin * 2 - labelHeight;
    const scale = Math.min(maxWidth / image.width, maxHeight / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    const x = (A4[0] - width) / 2;
    const y = margin + (maxHeight - height) / 2;
    page.drawImage(image, { x, y, width, height });
    const label = relative(stage, imagePath).replaceAll('\\', '/');
    page.drawText(label.slice(0, 100), { x: margin, y: A4[1] - 20, size: 8, font, maxWidth });
  }

  const bytes = await pdf.save({ useObjectStreams: true });
  writeFileSync(output, Buffer.from(bytes), { mode: 0o600 });
}

export async function writeAipassCompatibleExports({ stage, commit, branch, includedFiles }) {
  const targetDir = join(stage, 'AIPASS-COMPATIBLE');
  mkdirSync(targetDir, { recursive: true, mode: 0o700 });

  const contextFiles = [
    'REVIEW_PROMPT.md',
    'PROJECT_CONTEXT.md',
    'CURRENT_REVISION.json',
    'SAFETY_MANIFEST.json',
    'REVIEWER_POLICY.json',
    'FINDINGS_SCHEMA.json',
    'AWH-UX-CONSTITUTION.md',
    'AWH-VISUAL-QA.md',
    'VISUAL_SCENARIOS.json',
    'SOURCE_TREE.txt',
  ];
  for (const optional of ['visual-evidence/VISUAL_EVIDENCE.json', 'comparison-evidence/COMPARE_MANIFEST.json']) {
    try { if (statSync(join(stage, optional)).isFile()) contextFiles.push(optional); } catch { /* optional */ }
  }

  const contextSections = contextFiles.map((name) => ({
    title: name,
    text: safeRead(join(stage, name)),
    code: name.endsWith('.json') || name.endsWith('.txt'),
  }));
  const contextPath = join(targetDir, '01_AIPASS_REVIEW_CONTEXT.docx');
  writeFileSync(contextPath, docxBytes({
    title: 'AWH AiPASS Review Context',
    subtitle: `Exact revision: ${commit} | Branch: ${branch}`,
    sections: contextSections,
  }), { mode: 0o600 });

  const sourceRoot = join(stage, 'source');
  const sourceSections = walkFiles(sourceRoot).map((path) => ({
    title: relative(sourceRoot, path).replaceAll('\\', '/'),
    note: 'Line numbers are generated from the exact committed snapshot for reviewer reference.',
    text: safeRead(path),
    code: true,
    lineNumbers: true,
  }));
  const sourcePath = join(targetDir, '02_AIPASS_SOURCE_EVIDENCE.docx');
  writeFileSync(sourcePath, docxBytes({
    title: 'AWH AiPASS Source Evidence',
    subtitle: `Exact revision: ${commit} | Sanitized committed files: ${includedFiles}`,
    sections: sourceSections,
  }), { mode: 0o600 });

  const visualPath = join(targetDir, '03_AIPASS_VISUAL_EVIDENCE.pdf');
  await createVisualPdf(stage, visualPath);

  const files = [contextPath, sourcePath, visualPath].map((path) => ({
    path,
    name: relative(stage, path).replaceAll('\\', '/'),
    bytes: assertNativeSize(path),
  }));
  return files;
}
