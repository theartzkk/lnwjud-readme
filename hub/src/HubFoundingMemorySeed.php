<?php

declare(strict_types=1);

/**
 * Curated, bounded Founding Memory source.  This is intentionally not a raw
 * ChatGPT transcript: each record is an owner-private durable fact, rule or
 * project seed.  Current source/runtime evidence always has higher authority.
 */
final class HubFoundingMemorySeed
{
    public const VERSION = '1.0';

    /** @return list<array<string,mixed>> */
    public static function records(): array
    {
        return [
            self::owner('owner.identity', 'IDENTITY', 'Art / อาร์ต ใช้ภาษาไทยเป็นหลัก และต้องการคำอธิบายที่ชัดเจน เรียบง่าย เมื่อรายละเอียดเชิงเทคนิคไม่จำเป็น', ['art', 'thai', 'communication']),
            self::owner('owner.devices', 'WORKFLOW', 'อุปกรณ์หลักคือ MacBook ที่บ้าน, Windows PC ที่โรงเรียน และ iPhone; งานต้องทำต่อข้ามอุปกรณ์ที่เชื่อถือได้โดยไม่ต้องสร้างบริบทใหม่เอง', ['devices', 'mac', 'windows', 'iphone']),
            self::owner('owner.automation_preference', 'WORKING_PREFERENCE', 'หลักการทำงานคือ Maximum Automation, Minimum User Touch: รับคำสั่งเดียว ตรวจ ดำเนินการ QA และคืนผลงานหรือการอนุมัติที่จำเป็น', ['automation', 'outcome']),
            self::owner('owner.technical_interaction', 'WORKING_PREFERENCE', 'หลีกเลี่ยง Terminal-heavy workflow เมื่อมี UI หรือ automation ที่ปลอดภัยกว่า และอย่าถามข้อมูลซ้ำเมื่อดึงจาก Project Memory หรือ Source of Truth ได้', ['terminal', 'retrieval']),
            self::owner('owner.work_style', 'WORKING_PREFERENCE', 'ทำงานเป็นก้อนที่ coherent แก้จาก root cause ตรวจผลกระทบร่วม รักษา core ที่ดี และแยกหลักฐาน QA ออกจาก field/production evidence เสมอ', ['root-cause', 'qa', 'coherent-pass']),
            self::owner('owner.cost_preference', 'WORKING_PREFERENCE', 'คุมต้นทุนและ quota ใช้เครื่องมือที่ประหยัดกับงานทั่วไป และใช้ reasoning ที่เข้มขึ้นเฉพาะงาน architecture, security, migration, production หรือ root-cause ที่ยาก', ['cost', 'quota', 'routing']),

            self::constitution('constitution.core', 'OPERATING_RULE', 'Outcome-first. System-first. Root-cause-first. Source-of-Truth-first. One coherent pass. Maximum automation. Minimum user touch. Preserve healthy core. No parallel systems. QA the real flow. Report only what is proven.', ['constitution', 'core']),
            self::constitution('constitution.source_of_truth', 'OPERATING_RULE', 'สำหรับการเปลี่ยนแปลงเชิงเทคนิค ให้ตรวจ Source of Truth แล้วจึงดู architecture, shared components, data flow, duplicate/legacy paths, root cause และความเสี่ยงข้างเคียงก่อนเลือก repair ที่เล็กและ coherent ที่สุด', ['source-of-truth', 'engineering']),
            self::constitution('constitution.engineering', 'OPERATING_RULE', 'Codex/engineering worker เป็น Senior Engineering Specialist เมื่อจำเป็น; AWH ประสาน intent, context, safety, result และ continuity โดยไม่บังคับให้ engineer ทำ patch ตามสมมติฐานที่ยังไม่พิสูจน์', ['codex', 'engineering']),
            self::constitution('constitution.success', 'OPERATING_RULE', 'Tool success ไม่เท่ากับ user outcome success: build ผ่านไม่พิสูจน์ production, worker completed ไม่เท่ากับเป้าหมายสำเร็จ และ artifact มีอยู่ไม่เท่ากับคุณภาพจริง', ['truthful-status', 'qa']),
            self::constitution('constitution.production', 'OPERATING_RULE', 'Production ต้องผ่าน Owner approval แบบ bounded, มี rollback และหลักฐานที่ตรวจสอบได้ ห้ามซ่อน failed/partial deployment ใต้สถานะสำเร็จ', ['production', 'approval', 'rollback']),
            self::constitution('constitution.memory', 'OPERATING_RULE', 'Durable continuity เป็นของ AWH ไม่ผูกกับ model/provider/chat session ใด และต้องไม่เก็บ private chain-of-thought เป็น memory', ['memory', 'provider-independent']),

            self::owner('awh.purpose', 'FOUNDING_PURPOSE', 'Art’s Workspace Hub มีไว้เพื่อให้ Art สั่งงานด้วยภาษาปกติครั้งเดียว แล้ว AWH ระบุ Project/context ดึง memory ที่เกี่ยวข้อง ตรวจ Source of Truth เลือก AI/worker/tool ทำงานจริง ตรวจผล และเหลือเพียง Open Result หรือ Deploy ที่ Owner อนุมัติ', ['awh', 'purpose', 'continuity']),
            self::owner('awh.product_principle', 'FOUNDING_PURPOSE', 'ONE WORKSPACE. ANY TRUSTED DEVICE. CONTINUE ANYWHERE. ONE MEMORY AUTHORITY. ONE SOURCE OF TRUTH. ART CONTROLS. THE SYSTEM OPERATES.', ['awh', 'principle']),
            self::owner('awh.user_experience', 'PRODUCT_RULE', 'Work/conversation คือ surface หลักแบบ ChatGPT-like; attachments, progress, approvals และ artifacts อยู่ในบทสนทนา ขณะที่ task IDs, payloads, paths และ server internals อยู่ใน Advanced/Audit', ['ux', 'conversation']),
            self::archive('awh.production_baseline', 'HISTORICAL_BASELINE', 'ข้อมูลก่อตั้งระบุว่า ReadyIDC อยู่ที่ M7 / DB v7 และ physical Mac↔Windows handoff ยังต้องมี field proof หากไม่มีหลักฐานใหม่', ['historical', 'm7'], null),
            self::archive('awh.latest_source_candidate', 'HISTORICAL_BASELINE', 'ข้อมูลก่อตั้งอ้าง M8 candidate f6acf667b47b465de49a153123ead3df529363c1 เท่านั้น จึงเป็น historical memory และห้ามใช้แทน current branch/release evidence', ['historical', 'm8', 'stale-candidate'], 'f6acf667b47b465de49a153123ead3df529363c1'),
            self::owner('awh.final_direction', 'ARCHITECTURE', 'AWH เป็น daily work surface ที่ provider-independent; OpenAI API เป็น native provider เมื่อ configured, Codex เป็น engineering specialist, Mac/Windows เป็น deterministic workers, ReadyIDC เป็น control plane และ GitHub เป็น optional source/mirror', ['architecture', 'provider', 'workers']),

            self::project('bay-excuse-x', 'bay.purpose', 'PURPOSE', 'BAY EXCUSE X / BAY Smart School Suite X เป็นระบบปฏิบัติการโรงเรียนสำหรับบ้านเอือดใหญ่ ครอบคลุม mobile-first, LINE OA, attendance, timetable, substitution, reporting, parent และ teacher workflows', ['bay', 'school', 'mobile-first']),
            self::project('bay-excuse-x', 'bay.frozen_constraints', 'CONSTRAINT', 'ห้ามรื้อ healthy core เพื่อแก้ defect ข้างเคียง, ห้ามสร้าง data authority/table ซ้ำ, LINE OA ไม่เป็น parallel system, shared components ต้องแก้ที่ root cause และรายงานราชการต้องถูกต้องจริงทั้ง A4 geometry, ฟอนต์, spacing, names/signatures และ page behavior', ['bay', 'constraints', 'reports']),
            self::project('bay-excuse-x', 'bay.product_priorities', 'PRIORITY', 'Control Center, My Day, My Child, Publication Gate, Channel/Relationship Registry, Central Outbox, timetable effective dating, Shared Print Engine และการสื่อสาร parent/teacher ที่ง่ายสำหรับผู้ใช้ไม่เทคนิค', ['bay', 'priorities']),
            self::project('bay-excuse-x', 'bay.working_rule', 'WORKING_RULE', 'เมื่อแก้ source/code ของ BAY ให้ตรวจ source/database/runtime ล่าสุดก่อนเสมอ และไม่ใช้ stale patch', ['bay', 'source-of-truth']),

            self::project('school-website', 'schoolsite.purpose', 'PURPOSE', 'เว็บไซต์สาธารณะของโรงเรียนบ้านเอือดใหญ่ แยกจาก BAY back office เพื่อผู้ปกครอง/สาธารณะ แต่เชื่อมข้อมูลที่เกี่ยวข้องโดยไม่ซ้ำ authority', ['schoolsite', 'public']),
            self::project('school-website', 'schoolsite.design', 'STYLE_RULE', 'ธีมโรงเรียนส้ม+เทา คุณภาพต้อง modern, intelligent, polished, mobile-first; ข่าว กิจกรรม วารสาร PR และการอัปโหลดหลายรูปจากโทรศัพท์สำคัญ; LINE OA ต้องผสานอย่างมีประโยชน์โดยไม่ซ้ำระบบ', ['schoolsite', 'design', 'mobile']),

            self::project('teacher-evaluation', 'teacher_eval.purpose', 'PURPOSE', 'งานเอกสารประเมินครูและ video workflow ระยะยาวที่ต้องรักษาความต่อเนื่องของ edits/assets ข้าม session และอุปกรณ์', ['teacher-evaluation', 'video']),
            self::project('teacher-evaluation', 'teacher_eval.video_rules', 'STYLE_RULE', 'หลีกเลี่ยงภาพซ้ำ/overlay โดยไม่ตั้งใจ วิดีโอต้องเป็น moving production ไม่ใช่ static slides ใช้ AI วางแผน/วิเคราะห์ และใช้ Remotion/FFmpeg ทำ deterministic rendering พร้อม preview สั้นก่อน final render', ['teacher-evaluation', 'video', 'remotion', 'ffmpeg']),
            self::project('teacher-evaluation', 'teacher_eval.document_rules', 'STYLE_RULE', 'เอกสารราชการไทยต้องตรวจจาก rendered output: TH Sarabun New เมื่อเหมาะสม, page numbering, line wrapping, table headers และ document structure ต้องถูกต้องจริง', ['teacher-evaluation', 'document', 'thai']),

            self::owner('creative.quality', 'CREATIVE_STYLE', 'งาน PR โรงเรียนต้องสวยงามระดับประเทศ เป็นมืออาชีพและเหมาะกับภาพลักษณ์ของโรงเรียน', ['creative', 'pr', 'quality']),
            self::owner('creative.thai_language', 'CREATIVE_STYLE', 'ภาษาไทยต้องถูกต้องทั้งพยัญชนะ สระ วรรณยุกต์ และ spacing; ห้ามทำให้ glyph เพี้ยนเพื่อเอฟเฟกต์ตกแต่ง', ['creative', 'thai', 'typography']),
            self::owner('creative.pr_journal', 'CREATIVE_STYLE', 'วารสาร PR มักใช้ A4, เว้นพื้นที่ภาพอย่างตั้งใจ, clean/contemporary/school-appropriate, รักษา identity/colors ที่เกี่ยวข้อง และ caption/Facebook copy ต้องเป็นธรรมชาติสำหรับเพจโรงเรียน', ['creative', 'journal', 'a4']),
            self::owner('creative.preservation', 'CREATIVE_STYLE', 'เมื่อ Art บอกว่า “คงต้นฉบับ / ห้ามเพี้ยน” ให้รักษา layout/subject เดิมและเปลี่ยนเฉพาะส่วนที่สั่ง', ['creative', 'preservation']),

            self::owner('tools.policy', 'TOOL_POLICY', 'AWH เลือก tool/worker ให้เอง: งาน engineering ใช้ specialist เมื่อยาก, document/PDF ใช้ tooling จริงพร้อม rendered QA, media ใช้ FFmpeg/Remotion, spreadsheets ใช้ tooling เฉพาะ และ deploy ใช้ adapter+Owner approval+verification+rollback', ['tools', 'workers', 'deploy']),
            self::constitution('users.memory_isolation', 'SECURITY_RULE', 'Owner private memory ไม่แชร์อัตโนมัติ; Project-shared memory เข้าถึงได้เฉพาะสมาชิก Project ที่ได้รับสิทธิ์ และไม่มีใครได้ provider credentials หรือ infrastructure secrets ผ่าน memory', ['security', 'multi-user', 'memory']),
            self::owner('ai.strategy', 'AI_POLICY', 'Native AWH AI ต้อง provider-independent ใช้ economical routing สำหรับ routine work, ใช้ stronger reasoning เมื่อจำเป็น, เก็บ Codex ไว้สำหรับ specialist engineering และใช้ deterministic local execution เพื่อลด AI cost เมื่อเหมาะสม', ['ai', 'routing', 'cost']),
            self::archive('ai.subscription_direction', 'DECISION', 'ทิศทางก่อตั้งคือ AWH ต้องทำงานได้แม้ไม่ต่อ ChatGPT Plus; ข้อนี้เป็น direction ไม่ใช่หลักฐานว่าทุก capability production-ready', ['ai', 'subscription', 'historical'], null),
            self::archive('founding.open_loops', 'OPEN_LOOP', 'ข้อมูลก่อตั้งระบุ open loops เช่น field test iPhone/Windows, attachment/media/engineering acceptance และ future direct MCP; ต้องถือเป็น unresolved จนมี current evidence ใหม่', ['open-loop', 'field-test', 'historical'], null),
        ];
    }

    /** @return list<string> */
    public static function projectAliases(string $projectKey): array
    {
        return match ($projectKey) {
            'bay-excuse-x' => ['bay excuse x', 'bay smart school suite x'],
            'school-website' => ['school website', 'baan uat yai school website'],
            'teacher-evaluation' => ['teacher evaluation', 'teacher assessment', 'teacher-assessment'],
            default => [],
        };
    }

    public static function checksum(): string
    {
        return hash('sha256', json_encode(self::records(), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));
    }

    /** @return array<string,mixed> */
    private static function owner(string $key, string $category, string $content, array $tags): array
    {
        return ['stableKey' => $key, 'scope' => 'OWNER', 'category' => $category, 'content' => $content, 'tags' => $tags, 'sharingPolicy' => 'OWNER_PRIVATE'];
    }

    /** @return array<string,mixed> */
    private static function constitution(string $key, string $category, string $content, array $tags): array
    {
        return ['stableKey' => $key, 'scope' => 'CONSTITUTION', 'category' => $category, 'content' => $content, 'tags' => $tags, 'sharingPolicy' => 'OWNER_PRIVATE'];
    }

    /** @return array<string,mixed> */
    private static function project(string $projectKey, string $key, string $category, string $content, array $tags): array
    {
        return ['stableKey' => $key, 'scope' => 'PROJECT', 'projectKey' => $projectKey, 'category' => $category, 'content' => $content, 'tags' => $tags, 'sharingPolicy' => 'OWNER_PRIVATE'];
    }

    /** @return array<string,mixed> */
    private static function archive(string $key, string $category, string $content, array $tags, ?string $sourceRevision): array
    {
        return ['stableKey' => $key, 'scope' => 'ARCHIVE', 'category' => $category, 'content' => $content, 'tags' => $tags, 'sourceRevision' => $sourceRevision, 'sharingPolicy' => 'OWNER_PRIVATE'];
    }
}
