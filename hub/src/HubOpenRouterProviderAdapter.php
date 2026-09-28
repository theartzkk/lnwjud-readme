<?php
declare(strict_types=1);

require_once __DIR__.'/HubAiProviderAdapter.php';

/**
 * Optional free-only OpenRouter adapter. AWH exposes one virtual model
 * (openrouter-free) and maps it to the upstream openrouter/free router.
 * Any other model is rejected before network I/O.
 */
final class HubOpenRouterProviderAdapter implements HubAiProviderAdapter
{
    private const AWH_MODEL='openrouter-free';
    private const UPSTREAM_MODEL='openrouter/free';
    /** @var null|callable(array<string,mixed>,string):array<string,mixed> */
    private $transport;

    public function __construct(?callable $transport=null) { $this->transport=$transport; }
    public function providerId(): string { return 'openrouter'; }

    public function call(array $payload,string $credential): array
    {
        $model=is_string($payload['model']??null)?$payload['model']:'';
        if($model!==self::AWH_MODEL) throw new HubAiProviderAdapterException('Only the approved free OpenRouter route is allowed','PROVIDER_MODEL_UNAVAILABLE',$this->diagnostic('model',false,null,$model));
        $request=$this->toChatRequest($payload);
        if($this->transport!==null) return $this->normalize(($this->transport)($request,$credential));
        $curl=curl_init('https://openrouter.ai/api/v1/chat/completions');
        if($curl===false) throw new HubAiProviderAdapterException('Provider is unavailable','PROVIDER_UNAVAILABLE',$this->diagnostic('network',true,null,$model));
        $body=json_encode($request,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
        $retryAfter=null;
        curl_setopt_array($curl,[
            CURLOPT_POST=>true,
            CURLOPT_POSTFIELDS=>$body,
            CURLOPT_RETURNTRANSFER=>true,
            CURLOPT_CONNECTTIMEOUT=>10,
            CURLOPT_TIMEOUT=>45,
            CURLOPT_HTTPHEADER=>[
                'Content-Type: application/json',
                'Authorization: Bearer '.$credential,
                'Accept: application/json',
                'HTTP-Referer: https://kruart.online/',
                'X-Title: AWH',
            ],
            CURLOPT_HEADERFUNCTION=>static function($handle,string $line) use (&$retryAfter): int {
                $length=strlen($line); $trim=trim($line);
                if(preg_match('/^Retry-After\s*:\s*(.+)$/i',$trim,$match)===1){
                    $candidate=trim($match[1]); if($candidate!==''&&strlen($candidate)<=100)$retryAfter=$candidate;
                }
                return $length;
            },
        ]);
        $raw=curl_exec($curl); $status=(int)curl_getinfo($curl,CURLINFO_RESPONSE_CODE); $curlError=curl_errno($curl); curl_close($curl);
        if($curlError!==0||!is_string($raw)) throw new HubAiProviderAdapterException('Provider is unavailable','PROVIDER_UNAVAILABLE',$this->diagnostic('network',true,null,$model,$curlError));
        if(strlen($raw)>2*1024*1024) throw new HubAiProviderAdapterException('Provider response exceeded the safe limit','PROVIDER_FAILED',$this->diagnostic('invalid_response',true,$status,$model));
        $value=null; try{$value=json_decode($raw,true,64,JSON_THROW_ON_ERROR);}catch(Throwable){}
        if($status<200||$status>=300){
            $failure=$this->failure($status,is_array($value)?$value:null,$model,$this->retryAfterSeconds($retryAfter));
            throw new HubAiProviderAdapterException('Provider rejected the request',$failure['code'],$failure['diagnostic']);
        }
        if(!is_array($value)) throw new HubAiProviderAdapterException('Provider did not return a usable response','PROVIDER_FAILED',$this->diagnostic('invalid_response',true,$status,$model));
        return $this->normalize($value);
    }

    /** @param array<string,mixed> $payload @return array<string,mixed> */
    private function toChatRequest(array $payload): array
    {
        $messages=[];
        $instructions=$payload['instructions']??null;
        if(is_string($instructions)&&trim($instructions)!=='') $messages[]=['role'=>'system','content'=>$instructions];
        $input=$payload['input']??null;
        if(is_string($input)) $messages[]=['role'=>'user','content'=>$input];
        elseif(is_array($input)){
            foreach($input as $item){
                if(!is_array($item)) continue;
                $type=$item['type']??null;
                if($type==='function_call_output'){
                    $callId=$item['call_id']??null; $output=$item['output']??null;
                    if(!is_string($callId)||!is_string($output)) throw new HubAiProviderAdapterException('Provider tool continuation is invalid','PROVIDER_REQUEST_INVALID',$this->diagnostic('invalid_request',false,null,self::AWH_MODEL));
                    $messages[]=['role'=>'tool','tool_call_id'=>$callId,'content'=>$output];
                    continue;
                }
                if($type==='function_call'){
                    $callId=$item['call_id']??null; $name=$item['name']??null; $arguments=$item['arguments']??null;
                    if(!is_string($callId)||!is_string($name)||!is_string($arguments)) throw new HubAiProviderAdapterException('Provider tool continuation is invalid','PROVIDER_REQUEST_INVALID',$this->diagnostic('invalid_request',false,null,self::AWH_MODEL));
                    $messages[]=['role'=>'assistant','content'=>'','tool_calls'=>[['id'=>$callId,'type'=>'function','function'=>['name'=>$name,'arguments'=>$arguments]]]];
                    continue;
                }
                $role=$item['role']??null; $content=$item['content']??null;
                if(!is_string($role)||!in_array($role,['user','assistant'],true)||!is_array($content)) continue;
                $parts=[];
                foreach($content as $part){
                    if(!is_array($part)) continue;
                    if(in_array($part['type']??null,['input_text','output_text'],true)&&is_string($part['text']??null)) $parts[]=['type'=>'text','text'=>$part['text']];
                    elseif(($part['type']??null)==='input_image'&&is_string($part['image_url']??null)) $parts[]=['type'=>'image_url','image_url'=>['url'=>$part['image_url']]];
                    elseif(($part['type']??null)==='input_file') throw new HubAiProviderAdapterException('The free OpenRouter route does not accept AWH file attachments','PROVIDER_UNAVAILABLE',$this->diagnostic('capability',true,null,self::AWH_MODEL));
                }
                if($parts!==[]) $messages[]=['role'=>$role,'content'=>$parts];
            }
        }
        if($messages===[]) throw new HubAiProviderAdapterException('Provider request is empty','PROVIDER_REQUEST_INVALID',$this->diagnostic('invalid_request',false,null,self::AWH_MODEL));
        $request=['model'=>self::UPSTREAM_MODEL,'messages'=>$messages,'max_tokens'=>max(1,min(4096,(int)($payload['max_output_tokens']??1200)))];
        if(is_array($payload['tools']??null)&&$payload['tools']!==[]){
            $tools=[];
            foreach($payload['tools'] as $tool){
                if(!is_array($tool)||($tool['type']??null)!=='function'||!is_string($tool['name']??null)||!is_array($tool['parameters']??null)) throw new HubAiProviderAdapterException('Provider tool definition is invalid','PROVIDER_REQUEST_INVALID',$this->diagnostic('invalid_request',false,null,self::AWH_MODEL));
                $function=['name'=>$tool['name'],'parameters'=>$tool['parameters']];
                if(is_string($tool['description']??null))$function['description']=$tool['description'];
                $tools[]=['type'=>'function','function'=>$function];
            }
            $request['tools']=$tools;
            $request['tool_choice']='auto';
        }
        return $request;
    }

    /** @param array<string,mixed> $raw @return array<string,mixed> */
    private function normalize(array $raw): array
    {
        $choices=$raw['choices']??null; $message=is_array($choices)&&is_array($choices[0]??null)&&is_array($choices[0]['message']??null)?$choices[0]['message']:null;
        if(!is_array($message)) throw new HubAiProviderAdapterException('Provider response is invalid','PROVIDER_FAILED',$this->diagnostic('invalid_response',true,null,self::AWH_MODEL));
        $output=[]; $text='';
        $content=$message['content']??null;
        if(is_string($content)) $text=trim($content);
        elseif(is_array($content)){
            foreach($content as $part) if(is_array($part)&&($part['type']??null)==='text'&&is_string($part['text']??null)) $text.=$part['text'];
            $text=trim($text);
        }
        if($text!=='') $output[]=['type'=>'message','role'=>'assistant','content'=>[['type'=>'output_text','text'=>$text]]];
        $toolCalls=$message['tool_calls']??[];
        if(is_array($toolCalls)){
            foreach($toolCalls as $call){
                if(!is_array($call)||($call['type']??null)!=='function'||!is_array($call['function']??null)) continue;
                $id=$call['id']??null; $name=$call['function']['name']??null; $arguments=$call['function']['arguments']??null;
                if(!is_string($id)||!is_string($name)||!is_string($arguments)) continue;
                $output[]=['type'=>'function_call','call_id'=>$id,'name'=>$name,'arguments'=>$arguments];
            }
        }
        if($output===[]) throw new HubAiProviderAdapterException('Provider response is empty','PROVIDER_FAILED',$this->diagnostic('invalid_response',true,null,self::AWH_MODEL));
        $usage=is_array($raw['usage']??null)?$raw['usage']:[];
        $id=is_string($raw['id']??null)&&preg_match('/^[A-Za-z0-9_-]{4,200}$/',$raw['id'])===1?$raw['id']:'or_'.substr(hash('sha256',json_encode($output)),0,24);
        return ['id'=>$id,'output_text'=>$text,'output'=>$output,'usage'=>[
            'input_tokens'=>max(0,(int)($usage['prompt_tokens']??0)),
            'output_tokens'=>max(0,(int)($usage['completion_tokens']??0)),
        ]];
    }

    /** @return array{code:string,diagnostic:array<string,mixed>} */
    private function failure(int $status,?array $body,?string $model,?int $retryAfter=null): array
    {
        $error=is_array($body['error']??null)?$body['error']:[];
        $providerCode=is_scalar($error['code']??null)?substr((string)$error['code'],0,80):null;
        $message=is_string($error['message']??null)?strtolower(substr($error['message'],0,240)):'';
        $code='PROVIDER_FAILED'; $category='provider_error'; $retryable=false;
        if($status===401){$code='PROVIDER_AUTH_FAILED';$category='auth';}
        elseif($status===403){$code='PROVIDER_PERMISSION_DENIED';$category='permission';}
        elseif($status===429&&preg_match('/quota|credit|insufficient|limit/',$message)===1){$code='PROVIDER_QUOTA_EXHAUSTED';$category='quota';}
        elseif($status===429){$code='PROVIDER_RATE_LIMITED';$category='rate_limit';$retryable=true;}
        elseif($status===404){$code='PROVIDER_MODEL_UNAVAILABLE';$category='model';}
        elseif($status===408||$status>=500){$code='PROVIDER_UNAVAILABLE';$category='temporary';$retryable=true;}
        elseif($status>=400){$code='PROVIDER_REQUEST_INVALID';$category='invalid_request';}
        $diag=$this->diagnostic($category,$retryable,$status,$model,null,$retryable?$retryAfter:null);
        if($providerCode!==null&&preg_match('/^[A-Za-z0-9._:-]{1,80}$/',$providerCode)===1)$diag['providerCode']=$providerCode;
        return ['code'=>$code,'diagnostic'=>$diag];
    }

    /** @return array<string,mixed> */
    private function diagnostic(string $category,bool $retryable,?int $status,?string $model,?int $transportCode=null,?int $retryAfter=null): array
    {
        $out=['provider'=>'openrouter','operation'=>'chat-completions','category'=>$category,'retryable'=>$retryable];
        if($status!==null&&$status>=100&&$status<=599){$out['httpStatus']=$status;$out['httpStatusClass']=intdiv($status,100).'xx';}
        if($model!==null)$out['model']=$model;
        if($transportCode!==null&&$transportCode>0&&$transportCode<1000)$out['transportCode']=$transportCode;
        if($retryable&&$retryAfter!==null&&$retryAfter>=1&&$retryAfter<=3600)$out['retryAfterSeconds']=$retryAfter;
        return $out;
    }

    private function retryAfterSeconds(?string $value): ?int
    {
        if(!is_string($value)||trim($value)==='')return null;
        $value=trim($value);
        if(preg_match('/^[0-9]{1,10}$/',$value)===1){$seconds=(int)$value;return $seconds>=1?min(3600,$seconds):null;}
        $target=strtotime($value);if($target===false)return null;$seconds=$target-time();return $seconds>=1?min(3600,$seconds):null;
    }
}
