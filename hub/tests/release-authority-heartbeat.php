<?php

declare(strict_types=1);

function rah_assert(bool $value,string $message): void { if(!$value)throw new RuntimeException($message); }

$base=dirname(__DIR__);
$hosting=(string)file_get_contents($base.'/bin/awh-hosting-operator.php');
$learnlab=(string)file_get_contents($base.'/src/HubLearnLabReleaseOperator.php');
$assessment=(string)file_get_contents($base.'/src/HubAssessmentReleaseOperator.php');

rah_assert(str_contains($learnlab,'public function heartbeat(?string $now=null): array'),'LearnLab exposes release-authority heartbeat');
rah_assert(str_contains($assessment,'public function heartbeat(?string $now=null): array'),'Assessment exposes release-authority heartbeat');

$heartbeat=strpos($hosting,'try{$factory()->heartbeat();}');
$coreTick=strpos($hosting,'$core=HubCoreReleaseOperator::fromEnvironment($pdo)->tick();');
rah_assert($heartbeat!==false&&$coreTick!==false&&$heartbeat<$coreTick,'lower-priority release authorities heartbeat before Core dispatch can return early');
rah_assert(str_contains($hosting,"'learnlab'=>static fn()=>HubLearnLabReleaseOperator::fromEnvironment(\$pdo)"),'LearnLab heartbeat participates in shared release loop');
rah_assert(str_contains($hosting,"'assessment'=>static fn()=>HubAssessmentReleaseOperator::fromEnvironment(\$pdo)"),'Assessment heartbeat participates in shared release loop');
rah_assert(str_contains($hosting,"catch(Throwable \$error){error_log('AWH release heartbeat degraded:"),'one degraded heartbeat cannot starve other release tracks');

fwrite(STDOUT,"AWH release authority heartbeat: PASS\n");
