<?php

declare(strict_types=1);
require_once dirname(__DIR__).'/src/HubVerificationIntelligence.php';

$mode=$argv[1]??'';
$raw=stream_get_contents(STDIN);
try{$input=$raw===''?[]:json_decode($raw,true,32,JSON_THROW_ON_ERROR);}catch(Throwable){fwrite(STDERR,"VERIFICATION_INPUT_INVALID\n");exit(2);}
if(!is_array($input)){fwrite(STDERR,"VERIFICATION_INPUT_INVALID\n");exit(2);}
try{
    $result=match($mode){
        'plan'=>HubVerificationIntelligence::plan(is_array($input['files']??null)?$input['files']:[]),
        'stability'=>HubVerificationIntelligence::stability(is_array($input['statuses']??null)?$input['statuses']:[]),
        'incident'=>HubVerificationIntelligence::incident((string)($input['code']??'UNKNOWN'),is_array($input['context']??null)?$input['context']:[]),
        default=>throw new InvalidArgumentException('MODE'),
    };
    echo json_encode($result,JSON_UNESCAPED_SLASHES|JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR),"\n";
}catch(Throwable){fwrite(STDERR,"VERIFICATION_POLICY_FAILED\n");exit(2);}
