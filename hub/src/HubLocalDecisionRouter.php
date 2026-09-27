<?php
declare(strict_types=1);

require_once __DIR__ . '/HubCapabilityRegistryService.php';
require_once __DIR__ . '/HubSecretContentPolicy.php';

/**
 * Zero-cost local route classifier.
 * It never owns approval, permission, executor selection or release authority.
 * Route memory is advisory evidence used only when deterministic routing is AUTO_FIT.
 */
final class HubLocalDecisionRouter
{
    public const POLICY_VERSION = 'awh-local-route-v1';
    public const MIN_SCORE = 0.34;
    public const MIN_MARGIN = 0.055;
    private const MAX_HISTORY_EXAMPLES = 96;

    /** @var array<string,list<string>>|null */
    private ?array $exampleCache = null;

    public function __construct(private readonly ?PDO $pdo = null) {}

    /** @return array<string,mixed> */
    public function status(): array
    {
        $examples = $this->examples();
        $count = 0; foreach ($examples as $values) $count += count($values);
        return [
            'provider'=>'awh-local',
            'engine'=>'route-memory-ngram',
            'active'=>true,
            'costClass'=>'LOCAL_INCLUDED',
            'networkRequired'=>false,
            'policyVersion'=>self::POLICY_VERSION,
            'minScore'=>self::MIN_SCORE,
            'minMargin'=>self::MIN_MARGIN,
            'exampleCount'=>$count,
        ];
    }
    /** @return array<string,mixed> */
    public function decideGoal(string $goal): array
    {
        $profile = HubCapabilityRegistryService::workProfileForGoal($goal);
        $hard = (string)($profile['primaryRoute'] ?? 'AUTO_FIT');
        if ($hard !== 'AUTO_FIT') return $this->result('DETERMINISTIC_ROUTE', $hard, 1.0, 1.0, 'hard-rule');

        $normalized = self::normalize($goal);
        if ($normalized === '') return $this->result('AUTO_FIT', 'AUTO_FIT', 0.0, 0.0, 'empty');

        $scores = [];
        foreach ($this->examples() as $route => $examples) {
            $best = 0.0;
            foreach ($examples as $example) $best = max($best, self::similarity($normalized, $example));
            $scores[$route] = $best;
        }
        arsort($scores, SORT_NUMERIC);
        $routes = array_keys($scores); $values = array_values($scores);
        $route = (string)($routes[0] ?? 'AUTO_FIT');
        $score = (float)($values[0] ?? 0.0);
        $runnerUp = (float)($values[1] ?? 0.0);
        $margin = max(0.0, $score - $runnerUp);

        if ($score < self::MIN_SCORE || $margin < self::MIN_MARGIN) {
            return $this->result('AUTO_FIT', 'AUTO_FIT', self::confidence($score, $margin), $margin, 'low-confidence', $score);
        }
        return $this->result('APPLIED', $route, self::confidence($score, $margin), $margin, 'local-route-memory', $score);
    }

    /** @return array<string,list<string>> */
    private function examples(): array
    {
        if ($this->exampleCache !== null) return $this->exampleCache;
        $examples = self::seedExamples();
        foreach ($this->historyExamples() as $route => $values) {
            foreach ($values as $value) $examples[$route][] = $value;
        }
        foreach ($examples as $route => $values) $examples[$route] = array_values(array_unique(array_map([self::class,'normalize'], $values)));
        return $this->exampleCache = $examples;
    }
    /** @return array<string,list<string>> */
    private static function seedExamples(): array
    {
        return [
            'VPS_DIRECT'=>[
                'ตรวจ nginx บน vps','service systemd บน server ล่ม','แก้ database production',
                'deploy backend runtime','พื้นที่ disk vps เต็ม','เว็บ production ไม่อัปเดต',
                'ตรวจ runtime บน server','แก้ php fpm บน vps','restart service backend',
                'เช็ค api gateway บน server','production backend error','ตรวจ log server',
                'เว็บจริงไม่เปลี่ยนหลังอัปเดต','หน้าเว็บยังเป็นเวอร์ชันเก่า',
            ],
            'REMOTE_DEVICE'=>[
                'เปิด photoshop บน m5','ดูหน้าจอจริงบน macbook','กดปุ่มในโปรแกรมผ่าน remote desktop',
                'ใช้ premiere pro บนเครื่อง','ตรวจ gui บน mac','ใช้ windows desktop',
                'เปิด after effects','ควบคุมเครื่องผ่าน remote','ทดสอบในโปรแกรมบนเครื่องจริง',
                'ดู browser บน macbook','คลิกเมนูในแอปจริง','ตรวจหน้าจอด้วย remote desktop',
                'ดูหน้าจอเครื่องจริง','ตรวจหน้าจอผ่าน remote','เช็คหน้าจอให้หน่อย',
            ],
            'CONNECTED_FILES'=>[
                'หาไฟล์ใน google drive','อ่าน pdf แล้วสรุป','ค้นเอกสารรายงาน',
                'ดึงไฟล์จาก project','หารูปโรงเรียนจากโฟลเดอร์','เปิดรายงานที่บันทึกไว้',
                'ค้นไฟล์ source','อ่านเอกสารแนบ','หาไฟล์ข้อสอบ','ดึงเอกสารจาก drive',
                'เปิดไฟล์ใน project vault','ค้นรูปกิจกรรมโรงเรียน',
            ],
            'DIRECT_PLUS_REMOTE'=>[
                'แก้ server แล้วทดสอบบน macbook','deploy แล้วเปิด safari ตรวจ',
                'ตรวจ vps และ gui พร้อมกัน','แก้ backend แล้วดูหน้าจอจริง',
                'แก้ production แล้วทดสอบเครื่องจริง','ตรวจ runtime และ app บนเครื่อง',
                'deploy web แล้วตรวจ browser จริง','แก้ api แล้วเปิดหน้าเว็บบน mac',
                'ตรวจ server แล้วกดทดสอบผ่าน remote','แก้ backend และตรวจ gui',
            ],
        ];
    }
    /** @return array<string,list<string>> */
    private function historyExamples(): array
    {
        $out = ['VPS_DIRECT'=>[],'REMOTE_DEVICE'=>[],'CONNECTED_FILES'=>[],'DIRECT_PLUS_REMOTE'=>[]];
        if (!$this->pdo instanceof PDO) return $out;
        try {
            $query = $this->pdo->query("SELECT goal FROM control_tasks WHERE state='COMPLETED' AND goal IS NOT NULL ORDER BY updated_at DESC LIMIT " . self::MAX_HISTORY_EXAMPLES);
            while (($goal = $query->fetchColumn()) !== false) {
                if (!is_string($goal) || trim($goal) === '' || strlen($goal) > 4000 || self::containsSecret($goal)) continue;
                $profile = HubCapabilityRegistryService::workProfileForGoal($goal);
                $route = (string)($profile['primaryRoute'] ?? 'AUTO_FIT');
                if (!isset($out[$route])) continue;
                $value = self::normalize($goal);
                if ($value !== '') $out[$route][] = $value;
            }
        } catch (Throwable) {}
        return $out;
    }

    private static function containsSecret(string $value): bool
    {
        return HubSecretContentPolicy::containsCredential($value)
            || preg_match('/\b(?:api[_ -]?key|token|password|secret)\s*[:=]\s*[^\s]{8,}/i', $value) === 1;
    }

    private static function normalize(string $value): string
    {
        $value = trim(str_replace(["\r\n","\r"], "\n", $value));
        if (function_exists('mb_strtolower')) $value = mb_strtolower($value, 'UTF-8'); else $value = strtolower($value);
        $value = preg_replace('#https?://\S+#iu', ' url ', $value) ?? $value;
        $value = preg_replace('/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/i', ' id ', $value) ?? $value;
        $value = preg_replace('/\b[0-9a-f]{40,64}\b/i', ' revision ', $value) ?? $value;
        $value = preg_replace('/[^\p{L}\p{N}._-]+/u', ' ', $value) ?? $value;
        return trim((string)(preg_replace('/\s+/u', ' ', $value) ?? $value));
    }
    private static function similarity(string $a, string $b): float
    {
        if ($a === $b) return 1.0;
        $charA = self::grams($a); $charB = self::grams($b);
        $charDice = self::dice($charA, $charB);
        $tokenA = self::tokens($a); $tokenB = self::tokens($b);
        $tokenJaccard = self::jaccard($tokenA, $tokenB);
        $containment = (str_contains($a, $b) || str_contains($b, $a)) ? 0.08 : 0.0;
        return min(1.0, (0.82 * $charDice) + (0.18 * $tokenJaccard) + $containment);
    }

    /** @return array<string,true> */
    private static function grams(string $value): array
    {
        $compact = preg_replace('/\s+/u', '', $value) ?? $value;
        $chars = preg_split('//u', $compact, -1, PREG_SPLIT_NO_EMPTY);
        if (!is_array($chars) || $chars === []) return [];
        $out = []; $count = count($chars);
        foreach ([2,3,4] as $size) {
            if ($count < $size) continue;
            for ($i=0; $i <= $count-$size; $i++) $out[implode('', array_slice($chars,$i,$size))] = true;
        }
        return $out;
    }

    /** @return array<string,true> */
    private static function tokens(string $value): array
    {
        $parts = preg_split('/\s+/u', $value, -1, PREG_SPLIT_NO_EMPTY);
        $out = []; if (!is_array($parts)) return $out;
        foreach ($parts as $part) if (strlen($part) > 1) $out[$part] = true;
        return $out;
    }

    /** @param array<string,true> $a @param array<string,true> $b */
    private static function dice(array $a, array $b): float
    {
        if ($a === [] || $b === []) return 0.0;
        $intersection = count(array_intersect_key($a,$b));
        return (2.0 * $intersection) / (count($a) + count($b));
    }
    /** @param array<string,true> $a @param array<string,true> $b */
    private static function jaccard(array $a, array $b): float
    {
        if ($a === [] || $b === []) return 0.0;
        $intersection = count(array_intersect_key($a,$b));
        $union = count($a + $b);
        return $union > 0 ? $intersection / $union : 0.0;
    }

    private static function confidence(float $score, float $margin): float
    {
        if ($score <= 0.0) return 0.0;
        $quality = max(0.0, min(1.0, ($score - 0.18) / 0.52));
        $separation = max(0.0, min(1.0, $margin / 0.20));
        return round(min(0.99, (0.72 * $quality) + (0.27 * $separation)), 4);
    }

    /** @return array<string,mixed> */
    private function result(string $state, string $route, float $confidence, float $margin, string $reason, ?float $score = null): array
    {
        $out = [
            'schemaVersion'=>1,
            'policyVersion'=>self::POLICY_VERSION,
            'state'=>$state,
            'provider'=>'awh-local',
            'engine'=>'route-memory-ngram',
            'route'=>$route,
            'confidence'=>round(max(0.0,min(1.0,$confidence)),4),
            'margin'=>round(max(0.0,min(1.0,$margin)),4),
            'authority'=>'ADVISORY_ONLY',
            'reason'=>$reason,
            'costClass'=>'LOCAL_INCLUDED',
        ];
        if ($score !== null) $out['score'] = round(max(0.0,min(1.0,$score)),4);
        return $out;
    }
}
