<?php

declare(strict_types=1);

require_once __DIR__ . '/HubAiProviderAdapter.php';

final class HubOpenAiProviderAdapter implements HubAiProviderAdapter
{
    /** @var null|callable(array<string,mixed>,string):array<string,mixed> */
    private $transport;
    public function __construct(?callable $transport = null) { $this->transport = $transport; }
    public function providerId(): string { return 'openai'; }

    public function call(array $payload, string $credential): array
    {
        if ($this->transport !== null) return ($this->transport)($payload, $credential);
        $model = is_string($payload['model'] ?? null) ? $payload['model'] : null;
        $curl = curl_init('https://api.openai.com/v1/responses');
        if ($curl === false) throw new HubAiProviderAdapterException('Provider is unavailable','PROVIDER_UNAVAILABLE',$this->diagnostic('network',true,null,null,null,$model));
        $encoded=json_encode($payload,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
        curl_setopt_array($curl,[CURLOPT_POST=>true,CURLOPT_POSTFIELDS=>$encoded,CURLOPT_RETURNTRANSFER=>true,CURLOPT_CONNECTTIMEOUT=>10,CURLOPT_TIMEOUT=>45,CURLOPT_HTTPHEADER=>['Content-Type: application/json','Authorization: Bearer '.$credential,'Accept: application/json']]);
        $body=curl_exec($curl); $status=(int)curl_getinfo($curl,CURLINFO_RESPONSE_CODE); $curlError=curl_errno($curl); curl_close($curl);
        if ($curlError !== 0 || !is_string($body)) throw new HubAiProviderAdapterException('Provider is unavailable','PROVIDER_UNAVAILABLE',$this->diagnostic('network',true,null,null,null,$model,$curlError));
        if (strlen($body) > 2*1024*1024) throw new HubAiProviderAdapterException('Provider response exceeded the safe limit','PROVIDER_FAILED',$this->diagnostic('invalid_response',true,$status,null,null,$model));
        $value=null; try { $value=json_decode($body,true,64,JSON_THROW_ON_ERROR); } catch (Throwable) {}
        if ($status < 200 || $status >= 300) {
            $failure=$this->failure($status,is_array($value)?$value:null,$model);
            throw new HubAiProviderAdapterException('Provider rejected the request',$failure['code'],$failure['diagnostic']);
        }
        if (!is_array($value)) throw new HubAiProviderAdapterException('Provider did not return a usable response','PROVIDER_FAILED',$this->diagnostic('invalid_response',true,$status,null,null,$model));
        return $value;
    }

    /** @return array{code:string,diagnostic:array<string,mixed>} */
    private function failure(int $status, ?array $body, ?string $model): array
    {
        $error=is_array($body['error']??null)?$body['error']:[];
        $type=$this->token($error['type']??null); $providerCode=$this->token($error['code']??null);
        $needle=strtolower(($type??'').' '.($providerCode??''));
        $code='PROVIDER_FAILED'; $category='provider_error'; $retryable=false;
        if ($status===401) { $code='PROVIDER_AUTH_FAILED'; $category='auth'; }
        elseif ($status===403) { $code='PROVIDER_PERMISSION_DENIED'; $category='permission'; }
        elseif ($status===429 && preg_match('/quota|billing|credit|insufficient/',$needle)===1) { $code='PROVIDER_QUOTA_EXHAUSTED'; $category='quota'; }
        elseif ($status===429) { $code='PROVIDER_RATE_LIMITED'; $category='rate_limit'; $retryable=true; }
        elseif ($status===404 || preg_match('/model/',$needle)===1) { $code='PROVIDER_MODEL_UNAVAILABLE'; $category='model'; }
        elseif ($status===408 || $status>=500) { $code='PROVIDER_UNAVAILABLE'; $category='temporary'; $retryable=true; }
        elseif ($status>=400) { $code='PROVIDER_REQUEST_INVALID'; $category='invalid_request'; }
        return ['code'=>$code,'diagnostic'=>$this->diagnostic($category,$retryable,$status,$type,$providerCode,$model)];
    }

    /** @return array<string,mixed> */
    private function diagnostic(string $category,bool $retryable,?int $status,?string $type,?string $code,?string $model,?int $transportCode=null): array
    {
        $out=['provider'=>$this->providerId(),'operation'=>'responses','category'=>$category,'retryable'=>$retryable];
        if ($status!==null && $status>=100 && $status<=599) { $out['httpStatus']=$status; $out['httpStatusClass']=intdiv($status,100).'xx'; }
        if ($type!==null) $out['providerType']=$type; if ($code!==null) $out['providerCode']=$code;
        if (is_string($model) && preg_match('/^[A-Za-z0-9._:-]{2,100}$/',$model)===1) $out['model']=$model;
        if ($transportCode!==null && $transportCode>0 && $transportCode<1000) $out['transportCode']=$transportCode;
        return $out;
    }
    private function token(mixed $value): ?string
    {
        if (!is_string($value)) return null; $value=trim($value); return preg_match('/^[A-Za-z0-9._:-]{1,80}$/',$value)===1?$value:null;
    }
}
