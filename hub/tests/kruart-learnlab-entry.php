<?php
declare(strict_types=1);

$html=(string)file_get_contents(dirname(__DIR__,2).'/web/index.html');
$needles=[
  'href="https://learn.kruart.online/learnlab/teacher/"',
  'href="https://learn.kruart.online/learnlab/teacher/worksheet-studio.php"',
  'href="https://learn.kruart.online/learnlab/teacher/worksheet-review.php"',
  'สร้างใบงานดิจิทัล',
  'ตรวจใบงานนักเรียน',
];
foreach($needles as $needle){
  if(!str_contains($html,$needle)){
    fwrite(STDERR,"missing: {$needle}\n");
    exit(1);
  }
}
if(str_contains($html,'class="kruart-role-card teacher" type="button" data-open-login')){
  fwrite(STDERR,"teacher role still points to AWH login\n");
  exit(1);
}
echo "kruart-learnlab-entry: PASS\n";
