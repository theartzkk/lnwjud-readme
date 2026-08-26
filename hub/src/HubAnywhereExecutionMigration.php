<?php

declare(strict_types=1);

require_once __DIR__ . '/HubCentralProjectAuthorityMigration.php';

final class HubAnywhereExecutionMigrationException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName = 'MIGRATION_FAILED') { parent::__construct($message); }
}

/** M13 adds capability/provider discovery without creating a second work authority. */
final class HubAnywhereExecutionMigration
{
    public const TARGET_USER_VERSION = 13;
    public const MIGRATION_ID = 'm13-anywhere-execution-fabric';
    private const TABLES = [
        'control_capability_sources', 'control_capability_catalog',
        'control_execution_providers', 'control_execution_provider_capabilities',
        'control_execution_envelopes',
    ];
    private const INDEXES = [
        'idx_control_capability_catalog_category',
        'idx_control_execution_providers_availability',
        'idx_control_execution_provider_capabilities_route',
        'idx_control_execution_envelopes_project',
    ];

    public static function apply(string $databasePath, string $sqlPath, ?string $now = null): string
    {
        $pdo = self::open($databasePath); $sql = @file_get_contents($sqlPath);
        if (!is_string($sql) || $sql === '') throw new HubAnywhereExecutionMigrationException('Anywhere Execution migration is unavailable', 'MIGRATION_FILE_INVALID');
        $checksum = hash('sha256', $sql); $version = (int) $pdo->query('PRAGMA user_version')->fetchColumn();        if ($version < 12) throw new HubAnywhereExecutionMigrationException('M12 Central Project Authority is unavailable', 'BASE_SCHEMA_INVALID');
        try { HubCentralProjectAuthorityMigration::assertCapabilityReady($pdo, dirname(__DIR__) . '/migrations/011_central_project_authority.sql'); }
        catch (Throwable) { throw new HubAnywhereExecutionMigrationException('M12 Central Project Authority is unavailable', 'BASE_SCHEMA_INVALID'); }
        $q = $pdo->prepare('SELECT schema_version, checksum FROM awh_schema_migrations WHERE migration_id = :id');
        $q->execute(['id' => self::MIGRATION_ID]); $ledger = $q->fetch();
        if (is_array($ledger)) {
            if ((int) $ledger['schema_version'] !== self::TARGET_USER_VERSION || !hash_equals((string) $ledger['checksum'], $checksum) || $version < self::TARGET_USER_VERSION) throw new HubAnywhereExecutionMigrationException('Anywhere Execution migration record is invalid', 'MIGRATION_RECORD_INVALID');
            self::assertReady($pdo, $checksum); return 'already-applied';
        }
        if ($version > 12 || self::presentTables($pdo) !== []) throw new HubAnywhereExecutionMigrationException('Anywhere Execution migration order is not provable', 'MIGRATION_ORDER_UNCERTAIN');
        $at = self::timestamp($now ?? gmdate('c'));
        try {
            $pdo->beginTransaction(); $pdo->exec($sql); self::seedCatalog($pdo, $at); self::backfillEnvelopes($pdo, $at);
            $pdo->prepare('INSERT INTO awh_schema_migrations(migration_id, schema_version, checksum, applied_at) VALUES(:id, :version, :checksum, :at)')->execute(['id' => self::MIGRATION_ID, 'version' => self::TARGET_USER_VERSION, 'checksum' => $checksum, 'at' => $at]);
            $pdo->exec('PRAGMA user_version = 13'); self::assertReady($pdo, $checksum); $pdo->commit();
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            if ($error instanceof HubAnywhereExecutionMigrationException) throw $error;
            throw new HubAnywhereExecutionMigrationException('Anywhere Execution migration rolled back', 'MIGRATION_ROLLED_BACK');
        }
        return 'applied';
    }

    public static function assertCapabilityReady(PDO $pdo, string $sqlPath): void
    {
        if (!is_file($sqlPath)) throw new HubAnywhereExecutionMigrationException('Anywhere Execution migration authority is unavailable', 'MIGRATION_FILE_INVALID');
        self::assertReady($pdo, hash_file('sha256', $sqlPath));
    }
    private static function seedCatalog(PDO $pdo, string $at): void
    {
        $source = $pdo->prepare('INSERT INTO control_capability_sources(source_id, source_kind, display_name, source_uri, version, license_id, enabled, observed_at, metadata_json) VALUES(:id,:kind,:name,:uri,:version,:license,1,:at,:meta)');
        $source->execute(['id' => 'awh-core', 'kind' => 'BUILTIN', 'name' => 'AWH Core', 'uri' => null, 'version' => '1.0.0-rc.1', 'license' => 'PROJECT', 'at' => $at, 'meta' => '{}']);
        $source->execute(['id' => 'lnwjud-upstream', 'kind' => 'UPSTREAM', 'name' => 'lnwjud', 'uri' => 'https://github.com/engasnm111/lnwjud', 'version' => 'v4.10.0', 'license' => 'MIT', 'at' => $at, 'meta' => '{"role":"optional-execution-source"}']);
        $rows = [
            ['agent.conversation','awh-core','ai','ผู้ช่วย AI','สนทนาและวางแผนจากบริบท AWH','READ','LOW','AVAILABLE',1],
            ['project.read','awh-core','project','อ่านโปรเจกต์','อ่าน Source of Truth แบบจำกัดขอบเขต','READ','LOW','AVAILABLE',0],
            ['project.search','awh-core','project','ค้นหาในโปรเจกต์','ค้นหาไฟล์และบริบทโดยไม่แก้ source','READ','LOW','AVAILABLE',0],
            ['project.mutate.text','awh-core','project','แก้ข้อความแบบปลอดภัย','สร้าง candidate ที่ย้อนกลับได้ก่อนแทน source','REPLACE','MEDIUM','AVAILABLE',0],
            ['project.mutate.assisted','awh-core','project','ช่วยแก้โค้ดบน Cloud','AI แก้ text/code ใน Vault แยกและรอการอนุมัติ','REPLACE','HIGH','AVAILABLE',1],
            ['artifact.object','awh-core','artifact','ไฟล์ผลลัพธ์','จัดเก็บผลลัพธ์แบบ private object','CREATE','LOW','AVAILABLE',0],
            ['workspace.files','lnwjud-upstream','files','จัดการไฟล์','ความสามารถไฟล์จาก worker ที่ได้รับอนุญาต','REPLACE','MEDIUM','OPTIONAL',1],
            ['code.git','lnwjud-upstream','code','Git และ Source','งาน Git ผ่าน worker ที่ได้รับอนุญาต','OPAQUE','HIGH','OPTIONAL',1],
            ['system.shell','lnwjud-upstream','code','คำสั่งระบบ','งาน shell ที่ผ่าน policy และขอบเขตโปรเจกต์','EXECUTE','HIGH','OPTIONAL',0],
            ['browser.automation','lnwjud-upstream','browser','ทำงานบนเว็บ','Browser automation ผ่าน provider ที่รองรับ','OPAQUE','MEDIUM','OPTIONAL',1],
        ];        $rows = array_merge($rows, [
            ['document.office','lnwjud-upstream','document','เอกสาร Office','Word Excel PowerPoint ผ่าน provider ที่รองรับ','REPLACE','MEDIUM','OPTIONAL',1],
            ['document.pdf','lnwjud-upstream','document','เครื่องมือ PDF','อ่าน ตรวจ และสร้างงาน PDF ผ่าน provider ที่รองรับ','REPLACE','MEDIUM','OPTIONAL',1],
            ['document.ocr','lnwjud-upstream','document','อ่านข้อความจากภาพ','OCR ผ่าน provider ที่รองรับ','READ','LOW','OPTIONAL',1],
            ['code.specialist','awh-core','code','ผู้เชี่ยวชาญโค้ด','Specialist เช่น Codex ใช้เมื่อคุ้มและได้รับอนุญาต','OPAQUE','HIGH','OPTIONAL',0],
            ['voice.tts','awh-core','voice','สร้างเสียงภาษาไทย','TTS เป็น capability กลาง ไม่ผูกกับโมเดลเดียว','CREATE','LOW','PLANNED',1],
            ['voice.clone','awh-core','voice','เสียงของฉัน','Voice Profile ที่ต้องมีสิทธิ์และความยินยอม','CREATE','HIGH','PLANNED',1],
            ['video.render','awh-core','video','สร้างวิดีโอ','Render ผ่าน cloud/burst worker โดยไม่บังคับเครื่องส่วนตัว','CREATE','MEDIUM','PLANNED',1],
        ]);
        $insert = $pdo->prepare('INSERT INTO control_capability_catalog(capability, source_id, category, display_name, description, mutation_kind, risk_class, maturity, user_visible, enabled, created_at, updated_at) VALUES(:cap,:source,:category,:name,:description,:mutation,:risk,:maturity,:visible,1,:at,:at)');
        foreach ($rows as $row) $insert->execute([
            'cap' => $row[0], 'source' => $row[1], 'category' => $row[2], 'name' => $row[3],
            'description' => $row[4], 'mutation' => $row[5], 'risk' => $row[6],
            'maturity' => $row[7], 'visible' => $row[8], 'at' => $at,
        ]);
    }

    private static function backfillEnvelopes(PDO $pdo, string $at): void
    {
        $rows = $pdo->query('SELECT e.execution_id,e.task_id,e.project_id,e.vault_revision_id,e.executor_kind,e.required_capability,t.conversation_id FROM control_task_executions e JOIN control_tasks t ON t.task_id=e.task_id LEFT JOIN control_execution_envelopes x ON x.execution_id=e.execution_id WHERE x.execution_id IS NULL ORDER BY e.created_at,e.execution_id LIMIT 10000')->fetchAll();
        $insert = $pdo->prepare("INSERT INTO control_execution_envelopes(envelope_id,execution_id,task_id,project_id,conversation_id,base_revision_id,session_key,mutation_scope,state,provider_id,lease_expires_at,created_at,updated_at) VALUES(:envelope,:execution,:task,:project,:conversation,:revision,:session,:scope,'OPEN',NULL,NULL,:at,:at)");
        foreach ($rows as $row) {
            $required = (string) $row['required_capability'];
            $scope = str_starts_with($required, 'project.mutate.') ? 'PROJECT_CANDIDATE' : (in_array((string) $row['executor_kind'], ['DEVICE','CODEX'], true) ? 'DEVICE_WORKSPACE' : (preg_match('/^(?:agent\.conversation|project\.(?:read|search)|artifact\.object)$/', $required) ? 'READ' : 'EXTERNAL'));
            $conversation = is_string($row['conversation_id'] ?? null) ? (string) $row['conversation_id'] : null;
            $insert->execute(['envelope' => self::uuid(), 'execution' => $row['execution_id'], 'task' => $row['task_id'], 'project' => $row['project_id'], 'conversation' => $conversation, 'revision' => $row['vault_revision_id'], 'session' => $conversation === null ? 'task:' . $row['task_id'] : 'conversation:' . $conversation, 'scope' => $scope, 'at' => $at]);
        }
    }

    private static function assertReady(PDO $pdo, string $checksum): void
    {
        $q = $pdo->prepare('SELECT schema_version, checksum FROM awh_schema_migrations WHERE migration_id = :id');
        $q->execute(['id' => self::MIGRATION_ID]); $ledger = $q->fetch();
        $seeded = (int) $pdo->query("SELECT COUNT(*) FROM control_capability_catalog WHERE capability IN ('agent.conversation','project.mutate.assisted','voice.tts')")->fetchColumn() === 3;
        if ((int) $pdo->query('PRAGMA user_version')->fetchColumn() < self::TARGET_USER_VERSION || !is_array($ledger) || (int) $ledger['schema_version'] !== self::TARGET_USER_VERSION || !hash_equals(strtolower($checksum), strtolower((string) ($ledger['checksum'] ?? ''))) || !self::ready($pdo) || !$seeded || $pdo->query('PRAGMA foreign_key_check')->fetchAll() !== []) throw new HubAnywhereExecutionMigrationException('Anywhere Execution capability is not ready', 'ANYWHERE_EXECUTION_SCHEMA_NOT_READY');
    }
    private static function open(string $path): PDO
    {
        if ($path === '' || str_contains($path, "\0")) throw new HubAnywhereExecutionMigrationException('Database path is invalid', 'DATABASE_CONFIG_INVALID');
        try {
            $pdo = new PDO('sqlite:' . $path, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
            $pdo->exec('PRAGMA foreign_keys = ON'); $pdo->exec('PRAGMA busy_timeout = 2500'); return $pdo;
        } catch (Throwable) { throw new HubAnywhereExecutionMigrationException('Database is unavailable', 'DATABASE_UNAVAILABLE'); }
    }

    /** @return list<string> */
    private static function presentTables(PDO $pdo): array
    {
        $out = []; foreach (self::TABLES as $table) if ($pdo->query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '" . $table . "'")->fetchColumn() !== false) $out[] = $table; return $out;
    }

    private static function ready(PDO $pdo): bool
    {
        foreach (self::INDEXES as $index) if ($pdo->query("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = '" . $index . "'")->fetchColumn() === false) return false;
        return self::presentTables($pdo) === self::TABLES;
    }

    private static function uuid(): string
    {
        $bytes = random_bytes(16); $bytes[6] = chr((ord($bytes[6]) & 15) | 64); $bytes[8] = chr((ord($bytes[8]) & 63) | 128);
        return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($bytes), 4));
    }

    private static function timestamp(string $value): string
    {
        if (strtotime($value) === false) throw new HubAnywhereExecutionMigrationException('Anywhere Execution migration time is invalid', 'MIGRATION_FAILED');
        return gmdate('c', strtotime($value));
    }
}
