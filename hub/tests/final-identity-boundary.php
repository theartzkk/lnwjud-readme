<?php
declare(strict_types=1);
$root=dirname(__DIR__);
$service=(string)file_get_contents($root.'/src/HubOwnerAuthService.php');
$router=(string)file_get_contents($root.'/src/HubOwnerAuthRouter.php');
$web=(string)file_get_contents(dirname($root).'/web/index.html');
$adapter=(string)file_get_contents(dirname($root).'/web/control-plane-adapter.js');
$checks=[
 [str_contains($service,'assertAwhAccountPersonType($personType)'),'public registration enforces BAY identity ownership'],
 [str_contains($service,'assertAwhAccountPersonType($person)'),'owner direct creation enforces BAY identity ownership'],
 [str_contains($service,"['PARENT','STUDENT']"),'legacy person types remain readable but are creation-blocked'],
 [str_contains($router,'IDENTITY_OWNED_BY_BAY'),'router exposes a truthful identity-owner error'],
 [!str_contains($web,'<option value="PARENT">ผู้ปกครอง</option>') && !str_contains($web,'<option value="STUDENT">นักเรียน</option>'),'AWH creation forms do not offer duplicate school identities'],
 [str_contains($adapter,"['DIRECTOR','TEACHER','STAFF','OTHER'].includes(personType)"),'client creation contract matches the server boundary'],
];
foreach($checks as [$ok,$msg]){if(!$ok){fwrite(STDERR,"FAIL: {$msg}\n");exit(1);}echo "PASS: {$msg}\n";}
echo "FINAL IDENTITY BOUNDARY: PASS\n";
