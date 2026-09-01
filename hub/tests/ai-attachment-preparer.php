<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubAiAttachmentPreparer.php';

function aip_assert(bool $condition, string $message): void { if (!$condition) throw new RuntimeException($message); }
function aip_clean(string $root): void { if(!is_dir($root))return;$it=new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root,FilesystemIterator::SKIP_DOTS),RecursiveIteratorIterator::CHILD_FIRST);foreach($it as $f){$x=$f->getPathname();$f->isDir()&&!$f->isLink()?@rmdir($x):@unlink($x);}@rmdir($root); }

$root=rtrim(sys_get_temp_dir(),'/').'/awh-ai-attachment-'.bin2hex(random_bytes(6));
$jpeg=base64_decode('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EB//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EB//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EB//2Q==', true);
aip_assert(is_string($jpeg) && strlen($jpeg)>100,'JPEG fixture');
try {
    mkdir($root,0700,true); $heic=$root.'/iphone.heic'; file_put_contents($heic,"fake-heic-source\n"); $beforeHash=hash_file('sha256',$heic);
    $fixture=$root.'/fixture.jpg'; file_put_contents($fixture,$jpeg);
    $converter=$root.'/vipsthumbnail';
    $script="#!/bin/sh\nset -eu\ntest \"$1\" = '--size=2048x2048>'\ntest \"$2\" = --rotate\ntest \"$3\" = --delete\nout=$(printf '%s' \"$4\" | sed 's/^--output=//;s/\\[Q=88\\]$//')\ncp " . escapeshellarg($fixture) . " \"\$out\"\n";
    file_put_contents($converter,$script); chmod($converter,0700);
    $tempRoot=rtrim(sys_get_temp_dir(),'/').'/awh-ai-images'; $before=glob($tempRoot.'/*.jpg') ?: [];
    $preparer=new HubAiAttachmentPreparer($converter);
    $prepared=$preparer->prepare(['name'=>'IMG_0001.HEIC','mimeType'=>'image/heic','path'=>$heic,'sizeBytes'=>filesize($heic)]);
    aip_assert($prepared['mimeType']==='image/jpeg' && $prepared['kind']==='image' && str_ends_with($prepared['name'],'.jpg'),'HEIC becomes provider-safe JPEG');
    aip_assert(hash('sha256',$prepared['bytes'])===hash('sha256',$jpeg),'normalized bytes come from bounded runtime output');
    aip_assert(hash_file('sha256',$heic)===$beforeHash,'canonical HEIC source stays byte-identical');
    $after=glob($tempRoot.'/*.jpg') ?: []; aip_assert($after===$before,'ephemeral normalized file is removed after read');

    $direct=$preparer->prepare(['name'=>'photo.jpg','mimeType'=>'image/jpeg','path'=>$fixture,'sizeBytes'=>filesize($fixture)]);
    aip_assert($direct['bytes']===$jpeg && $direct['kind']==='image' && $direct['name']==='photo.jpg','small supported image remains unchanged');

    $largeImage=$root.'/large.jpg'; file_put_contents($largeImage,$jpeg); $fh=fopen($largeImage,'ab'); ftruncate($fh,HubAiAttachmentPreparer::MAX_PREPARED_IMAGE_BYTES+1); fclose($fh);
    $normalized=$preparer->prepare(['name'=>'large.jpg','mimeType'=>'image/jpeg','path'=>$largeImage,'sizeBytes'=>filesize($largeImage)]);
    aip_assert($normalized['mimeType']==='image/jpeg' && $normalized['sizeBytes']===strlen($jpeg),'large supported image is normalized instead of silently skipped');

    $nineMb=$root.'/nine.txt'; $fh=fopen($nineMb,'wb'); ftruncate($fh,9*1024*1024); fclose($fh);
    $document=$preparer->prepare(['name'=>'nine.txt','mimeType'=>'text/plain','path'=>$nineMb,'sizeBytes'=>filesize($nineMb)]);
    aip_assert($document['kind']==='document' && $document['sizeBytes']===9*1024*1024,'file above legacy 8 MiB limit remains available to AI');
    $unsupported=false; try { $preparer->prepare(['name'=>'archive.zip','mimeType'=>'application/zip','path'=>$fixture,'sizeBytes'=>filesize($fixture)]); }
    catch(HubAiAttachmentPreparerException $e){$unsupported=$e->codeName==='ATTACHMENT_AI_INPUT_UNSUPPORTED';}
    aip_assert($unsupported,'unsupported direct file type fails explicitly');

    $missing=false; try { (new HubAiAttachmentPreparer($root.'/missing-vipsthumbnail'))->prepare(['name'=>'IMG.HEIC','mimeType'=>'image/heic','path'=>$heic,'sizeBytes'=>filesize($heic)]); }
    catch(HubAiAttachmentPreparerException $e){$missing=$e->codeName==='IMAGE_INPUT_RUNTIME_UNAVAILABLE';}
    aip_assert($missing,'missing image runtime fails with typed readiness error');

    $tooLarge=$root.'/too-large.jpg'; $fh=fopen($tooLarge,'wb'); ftruncate($fh,HubAiAttachmentPreparer::MAX_IMAGE_SOURCE_BYTES+1); fclose($fh);
    $rejected=false; try { $preparer->prepare(['name'=>'too-large.jpg','mimeType'=>'image/jpeg','path'=>$tooLarge,'sizeBytes'=>filesize($tooLarge)]); }
    catch(HubAiAttachmentPreparerException $e){$rejected=$e->codeName==='ATTACHMENT_AI_INPUT_TOO_LARGE';}
    aip_assert($rejected,'image over upload-bound is rejected explicitly');
    fwrite(STDOUT,"AWH AI Attachment Preparer: PASS\n");
} finally { aip_clean($root); }
