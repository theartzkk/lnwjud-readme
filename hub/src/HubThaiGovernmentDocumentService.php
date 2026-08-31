<?php

declare(strict_types=1);

/** Deterministic Thai official-document renderer shared by Chat and Tools. */
final class HubThaiGovernmentDocumentService
{
    public const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    private const FONT = 'TH Sarabun New';
    private const DOTS = '................................................................................................';

    /** @return array<string,mixed> */
    public static function memorandumPipeline(): array
    {
        return [
            'mode' => 'THAI_GOVERNMENT_DOCUMENT',
            'classification' => 'INTERNAL_MEMORANDUM',
            'templateId' => 'thai-official-internal-memorandum-v2',
            'standard' => 'ระเบียบสำนักนายกรัฐมนตรีว่าด้วยงานสารบรรณ · กระดาษบันทึกข้อความ',
            'paper' => 'A4',
            'font' => self::FONT,
            'bodyFontPt' => 16,
            'titleFontPt' => 29,
            'labelFontPt' => 20,
            'marginsCm' => ['left' => 3.0, 'right' => 2.0, 'top' => 2.5, 'bottom' => 2.0],
            'firstLineIndentCm' => 2.5,
            'garudaHeightCm' => 1.5,
            'garudaAsset' => 'thai-government-garuda-v7.png',
            'garudaAssetSha256' => '48d043c64487328e3a4aa6738eaf908cc6ac47416d15706c43030ff379904fc0',
            'requiredCapability' => 'artifact.object',
            'validation' => 'STRUCTURAL_RULES_ENFORCED',
        ];
    }

    /** @param array<string,mixed> $fields */
    public static function memorandumDocx(array $fields): string
    {
        $data = self::normalize($fields);
        $garuda = self::garudaPng();
        $entries = [
            '[Content_Types].xml' => self::contentTypes(),
            '_rels/.rels' => self::rootRelationships(),
            'word/styles.xml' => self::stylesXml(),
            'word/document.xml' => self::documentXml($data),
            'word/_rels/document.xml.rels' => self::documentRelationships(),
            'word/media/thai-government-garuda-v7.png' => $garuda,
            'docProps/core.xml' => self::coreProperties(),
        ];
        $bytes = self::zipPackage($entries);
        if (strlen($bytes) < 1500) throw new RuntimeException('DOCX package is incomplete');
        return $bytes;
    }

    /** @param array<string,mixed> $fields @return array<string,string> */
    private static function normalize(array $fields): array
    {
        $text = static function (mixed $value, string $fallback = self::DOTS): string {
            if (!is_string($value)) return $fallback;
            $value = trim(str_replace(["\r\n", "\r"], "\n", $value));
            return $value === '' ? $fallback : $value;
        };
        return [
            'organization' => $text($fields['organization'] ?? null),
            'referenceNo' => $text($fields['referenceNo'] ?? null),
            'date' => $text($fields['date'] ?? null),
            'subject' => $text($fields['subject'] ?? null, 'ตามคำขอใน AWH'),
            'recipient' => $text($fields['recipient'] ?? null),
            'body' => $text($fields['body'] ?? null, 'รายละเอียดตามคำขอใน AWH'),
            'signerName' => $text($fields['signerName'] ?? null),
            'signerPosition' => $text($fields['signerPosition'] ?? null),
        ];
    }

    private static function contentTypes(): string
    {
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            . '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            . '<Default Extension="xml" ContentType="application/xml"/>'
            . '<Default Extension="png" ContentType="image/png"/>'
            . '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
            . '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
            . '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
            . '</Types>';
    }

    private static function rootRelationships(): string
    {
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            . '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
            . '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
            . '</Relationships>';
    }

    private static function documentRelationships(): string
    {
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            . '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
            . '<Relationship Id="rIdGaruda" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/thai-government-garuda-v7.png"/>'
            . '</Relationships>';
    }

    private static function coreProperties(): string
    {
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">'
            . '<dc:title>บันทึกข้อความ</dc:title><dc:creator>Art’s Workspace Hub</dc:creator>'
            . '</cp:coreProperties>';
    }

    private static function stylesXml(): string
    {
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
            . '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/>'
            . '<w:rPr><w:rFonts w:ascii="' . self::FONT . '" w:hAnsi="' . self::FONT . '" w:eastAsia="' . self::FONT . '" w:cs="' . self::FONT . '"/><w:sz w:val="32"/><w:szCs w:val="32"/><w:lang w:val="th-TH"/></w:rPr>'
            . '<w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:style>'
            . '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr>'
            . '<w:tblBorders><w:top w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:left w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:bottom w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:right w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:insideH w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:insideV w:val="none" w:sz="0" w:space="0" w:color="auto"/></w:tblBorders>'
            . '<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>'
            . '</w:styles>';
    }

    /** @param array<string,string> $data */
    private static function documentXml(array $data): string
    {
        $body = self::memorandumHeader();
        $body .= self::fieldLine('ส่วนราชการ', $data['organization'], 40);
        $body .= self::twoFieldTable('ที่', $data['referenceNo'], 'วันที่', $data['date']);
        $body .= self::fieldLine('เรื่อง', $data['subject'], 40);
        $body .= self::paragraphRuns([self::run('เรียน', 32, true), self::run('  ' . $data['recipient'], 32)], 120, 0);
        foreach (preg_split('/\n{2,}/u', $data['body']) ?: [$data['body']] as $paragraph) {
            $text = trim((string) $paragraph);
            if ($text !== '') $body .= self::paragraph($text, 32, false, null, 1417, 0, 0, 'auto');
        }
        $body .= self::paragraph('จึงเรียนมาเพื่อโปรดพิจารณา', 32, false, null, 1417, 0, 0, 'auto', null, 120);
        $body .= self::signatureTable($data['signerName'], $data['signerPosition']);
        $body .= '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
            . '<w:pgMar w:top="1417" w:right="1134" w:bottom="1134" w:left="1701" w:header="0" w:footer="0" w:gutter="0"/>'
            . '<w:cols w:space="720"/><w:docGrid w:linePitch="360"/></w:sectPr>';
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>' . $body . '</w:body></w:document>';
    }

    private static function garudaPng(): string
    {
        $path = dirname(__DIR__) . '/assets/thai-government-garuda-v7.png';
        $bytes = @file_get_contents($path);
        if (!is_string($bytes) || !str_starts_with($bytes, "\x89PNG\r\n\x1a\n")) throw new RuntimeException('Thai government Garuda asset is unavailable');
        if (!hash_equals('48d043c64487328e3a4aa6738eaf908cc6ac47416d15706c43030ff379904fc0', hash('sha256', $bytes))) throw new RuntimeException('Thai government Garuda asset failed integrity verification');
        return $bytes;
    }

    private static function memorandumHeader(): string
    {
        return '<w:tbl><w:tblPr><w:tblStyle w:val="TableNormal"/><w:tblW w:w="9071" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders><w:top w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:left w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:bottom w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:right w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:insideH w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:insideV w:val="none" w:sz="0" w:space="0" w:color="auto"/></w:tblBorders></w:tblPr>'
            . '<w:tblGrid><w:gridCol w:w="2600"/><w:gridCol w:w="6471"/></w:tblGrid><w:tr><w:trPr><w:trHeight w:val="850" w:hRule="exact"/></w:trPr>'
            . '<w:tc><w:tcPr><w:tcW w:w="2600" w:type="dxa"/><w:tcBorders><w:top w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:left w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:bottom w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:right w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:insideH w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:insideV w:val="none" w:sz="0" w:space="0" w:color="auto"/></w:tcBorders><w:vAlign w:val="center"/></w:tcPr>' . self::paragraphRuns([self::garudaRun()], 0, 0, 'left') . '</w:tc>'
            . '<w:tc><w:tcPr><w:tcW w:w="6471" w:type="dxa"/><w:tcBorders><w:top w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:left w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:bottom w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:right w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:insideH w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:insideV w:val="none" w:sz="0" w:space="0" w:color="auto"/></w:tcBorders><w:vAlign w:val="center"/></w:tcPr>' . self::paragraph('บันทึกข้อความ', 58, true, 'left', 0, 0, 700, 'exact') . '</w:tc>'
            . '</w:tr></w:tbl>';
    }

    private static function garudaRun(): string
    {
        $extent = 540000;
        return '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="' . $extent . '" cy="' . $extent . '"/><wp:effectExtent l="0" t="0" r="0" b="0"/>'
            . '<wp:docPr id="1" name="ตราครุฑราชการไทย"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
            . '<pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="thai-government-garuda-v7.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdGaruda"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
            . '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' . $extent . '" cy="' . $extent . '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>'
            . '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
    }

    private static function fieldLine(string $label, string $value, int $labelSize): string
    {
        return self::paragraphRuns([self::run($label, $labelSize, true), self::run('  ' . $value, 32)], 0, 0);
    }

    private static function twoFieldTable(string $leftLabel, string $leftValue, string $rightLabel, string $rightValue): string
    {
        return '<w:tbl><w:tblPr><w:tblStyle w:val="TableNormal"/><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:left w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:bottom w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:right w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:insideH w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:insideV w:val="none" w:sz="0" w:space="0" w:color="auto"/></w:tblBorders></w:tblPr>'
            . '<w:tblGrid><w:gridCol w:w="7600"/><w:gridCol w:w="3000"/></w:tblGrid><w:tr>'
            . '<w:tc><w:tcPr><w:tcW w:w="7600" w:type="dxa"/><w:tcBorders><w:top w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:left w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:bottom w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:right w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:insideH w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:insideV w:val="none" w:sz="0" w:space="0" w:color="auto"/></w:tcBorders></w:tcPr>' . self::paragraphRuns([self::run($leftLabel, 40, true), self::run('  ' . $leftValue, 32)], 0, 0) . '</w:tc>'
            . '<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/><w:tcBorders><w:top w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:left w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:bottom w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:right w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:insideH w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:insideV w:val="none" w:sz="0" w:space="0" w:color="auto"/></w:tcBorders></w:tcPr>' . self::paragraphRuns([self::run($rightLabel, 40, true), self::run('  ' . $rightValue, 32)], 0, 0) . '</w:tc>'
            . '</w:tr></w:tbl>';
    }

    private static function signatureTable(string $name, string $position): string
    {
        $paragraph = static function (string $text, int $before = 0): string {
            return '<w:p><w:pPr><w:spacing w:before="' . $before . '" w:after="0" w:line="240" w:lineRule="auto"/><w:ind w:left="4700"/><w:jc w:val="center"/></w:pPr>'
                . self::run($text, 32, false) . '</w:p>';
        };
        return $paragraph('ลงชื่อ ........................................', 300)
            . $paragraph('(' . $name . ')', 360)
            . $paragraph($position, 0);
    }

    /** @param list<string> $runs */
    private static function paragraphRuns(array $runs, int $before = 0, int $after = 0, ?string $alignment = null, int $firstLine = 0, int $line = 240, string $lineRule = 'auto', ?string $bookmark = null): string
    {
        $pPr = '<w:pPr><w:spacing w:before="' . $before . '" w:after="' . $after . '" w:line="' . $line . '" w:lineRule="' . $lineRule . '"/>'
            . ($alignment ? '<w:jc w:val="' . $alignment . '"/>' : '')
            . ($firstLine > 0 ? '<w:ind w:firstLine="' . $firstLine . '"/>' : '') . '</w:pPr>';
        $mark = $bookmark ? '<w:bookmarkStart w:id="0" w:name="' . self::xml($bookmark) . '"/><w:bookmarkEnd w:id="0"/>' : '';
        return '<w:p>' . $pPr . $mark . implode('', $runs) . '</w:p>';
    }

    private static function paragraph(string $text, int $size = 32, bool $bold = false, ?string $alignment = null, int $firstLine = 0, int $before = 0, int $line = 240, string $lineRule = 'auto', ?string $bookmark = null, int $after = 0): string
    {
        return self::paragraphRuns([self::run($text, $size, $bold)], $before, $after, $alignment, $firstLine, $line, $lineRule, $bookmark);
    }

    private static function run(string $text, int $size = 32, bool $bold = false): string
    {
        $font = self::FONT;
        return '<w:r><w:rPr><w:rFonts w:ascii="' . $font . '" w:hAnsi="' . $font . '" w:eastAsia="' . $font . '" w:cs="' . $font . '"/>'
            . ($bold ? '<w:b/><w:bCs/>' : '') . '<w:sz w:val="' . $size . '"/><w:szCs w:val="' . $size . '"/><w:lang w:val="th-TH"/></w:rPr>'
            . '<w:t xml:space="preserve">' . self::xml($text) . '</w:t></w:r>';
    }

    /** @param array<string,string> $entries */
    private static function zipPackage(array $entries): string
    {
        $body = ''; $central = ''; $offset = 0; $count = 0;
        foreach ($entries as $name => $data) {
            $name = str_replace('\\', '/', $name);
            $crc = crc32($data); $size = strlen($data); $nameLength = strlen($name);
            $local = "PK\x03\x04" . pack('vvvvvVVVvv', 20, 0, 0, 0, 0, $crc, $size, $size, $nameLength, 0) . $name . $data;
            $central .= "PK\x01\x02" . pack('vvvvvvVVVvvvvvVV', 20, 20, 0, 0, 0, 0, $crc, $size, $size, $nameLength, 0, 0, 0, 0, 0, $offset) . $name;
            $body .= $local; $offset += strlen($local); $count++;
        }
        $centralOffset = strlen($body); $centralSize = strlen($central);
        return $body . $central . "PK\x05\x06" . pack('vvvvVVv', 0, 0, $count, $count, $centralSize, $centralOffset, 0);
    }

    private static function xml(string $value): string
    {
        return htmlspecialchars($value, ENT_XML1 | ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }
}
