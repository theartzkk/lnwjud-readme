<?php
declare(strict_types=1);

require_once __DIR__.'/HubProviderCredentialStore.php';
require_once __DIR__.'/HubLineOaGatewayMigration.php';

final class HubLineOaGatewayException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName='LINE_GATEWAY_FAILED')
    {
        parent::__construct($message);
    }
}

final class HubLineOaGatewayService
{
    private const CHANNEL='LINE_AWH';
    private const SECRET_PROVIDER='line.awh.channel-secret';
    private const TOKEN_PROVIDER='line.awh.channel-token';
    private const PAIRING_TTL=600;
    private const API_REPLY='https://api.line.me/v2/bot/message/reply';

    private $transport;

    public function __construct(private readonly PDO $pdo, private readonly HubProviderCredentialStore $secretStore, private readonly HubProviderCredentialStore $tokenStore, ?callable $transport=null)
    {
        $this->transport=$transport;
    }
    public static function fromEnvironment(PDO $pdo, ?callable $transport=null): self
    {
        return new self($pdo, HubProviderCredentialStore::fromEnvironment(self::SECRET_PROVIDER), HubProviderCredentialStore::fromEnvironment(self::TOKEN_PROVIDER), $transport);
    }

    public static function schemaPresent(PDO $pdo): bool
    {
        return HubLineOaGatewayMigration::schemaPresent($pdo);
    }

    public function status(string $userId, ?string $now=null): array
    {
        $this->assertSchema();
        $at=self::timestamp($now??gmdate('c'));
        $binding=$this->bindingForUser($userId);
        $pair=$this->pdo->prepare("SELECT expires_at FROM control_external_channel_pairings WHERE user_id=:user AND channel=:channel AND consumed_at IS NULL AND expires_at>:at ORDER BY created_at DESC LIMIT 1");
        $pair->execute(['user'=>$userId,'channel'=>self::CHANNEL,'at'=>$at]);
        $pairExpires=$pair->fetchColumn();
        return ['schemaVersion'=>1,'configured'=>$this->secretStore->configured()&&$this->tokenStore->configured(),'channelSecretConfigured'=>$this->secretStore->configured(),'accessTokenConfigured'=>$this->tokenStore->configured(),'bound'=>is_array($binding)&&$binding['state']==='ACTIVE','lastSeenAt'=>is_array($binding)?(string)$binding['last_seen_at']:null,'pairingOpen'=>is_string($pairExpires),'pairingExpiresAt'=>is_string($pairExpires)?$pairExpires:null,'webhookPath'=>'/api/v1/integrations/line/awh/webhook'];
    }
    public function configure(string $channelSecret,string $accessToken,string $userId,?string $now=null): array
    {
        $this->assertSchema();
        $channelSecret=trim($channelSecret);$accessToken=trim($accessToken);
        if(strlen($channelSecret)<16||strlen($channelSecret)>512||preg_match('/[\x00-\x20\x7f]/',$channelSecret)) throw new HubLineOaGatewayException('LINE channel secret is invalid','LINE_CREDENTIAL_INVALID');
        if(strlen($accessToken)<40||strlen($accessToken)>4096||preg_match('/[\x00-\x20\x7f]/',$accessToken)) throw new HubLineOaGatewayException('LINE access token is invalid','LINE_CREDENTIAL_INVALID');
        try{$this->secretStore->replace($channelSecret);$this->tokenStore->replace($accessToken);}
        catch(HubProviderCredentialStoreException $e){throw new HubLineOaGatewayException('LINE credential could not be stored',$e->codeName);}
        return $this->status($userId,$now);
    }

    public function openPairing(string $userId,?string $now=null): array
    {
        $this->assertSchema();
        if(!$this->secretStore->configured()||!$this->tokenStore->configured()) throw new HubLineOaGatewayException('LINE gateway is not configured','LINE_GATEWAY_NOT_CONFIGURED');
        $at=self::timestamp($now??gmdate('c'));$expires=gmdate('c',strtotime($at)+self::PAIRING_TTL);
        $code='AWH-'.strtoupper(substr(self::base64url(random_bytes(9)),0,10));$id=self::uuid();
        $this->pdo->prepare("UPDATE control_external_channel_pairings SET consumed_at=:at WHERE user_id=:user AND channel=:channel AND consumed_at IS NULL")->execute(['at'=>$at,'user'=>$userId,'channel'=>self::CHANNEL]);
        $this->pdo->prepare("INSERT INTO control_external_channel_pairings(pairing_id,user_id,channel,code_hash,expires_at,consumed_at,created_at) VALUES(:id,:user,:channel,:hash,:expires,NULL,:at)")->execute(['id'=>$id,'user'=>$userId,'channel'=>self::CHANNEL,'hash'=>hash('sha256',$code),'expires'=>$expires,'at'=>$at]);
        return ['code'=>$code,'expiresAt'=>$expires];
    }
    public function revokeBinding(string $userId,?string $now=null): void
    {
        $this->assertSchema();$at=self::timestamp($now??gmdate('c'));
        $this->pdo->prepare("UPDATE control_external_channel_bindings SET state='REVOKED',revoked_at=:at,last_seen_at=:at WHERE user_id=:user AND channel=:channel AND state='ACTIVE'")->execute(['at'=>$at,'user'=>$userId,'channel'=>self::CHANNEL]);
    }

    public function handleWebhook(string $signature,string $body,callable $submit,?string $now=null): array
    {
        $this->assertSchema();$secret=$this->secretStore->read();$token=$this->tokenStore->read();
        if($secret===null||$token===null) throw new HubLineOaGatewayException('LINE gateway is not configured','LINE_GATEWAY_NOT_CONFIGURED');
        $expected=base64_encode(hash_hmac('sha256',$body,$secret,true));
        if($signature===''||!hash_equals($expected,$signature)) throw new HubLineOaGatewayException('LINE signature is invalid','LINE_SIGNATURE_INVALID');
        try{$payload=json_decode($body,true,32,JSON_THROW_ON_ERROR);}catch(Throwable){throw new HubLineOaGatewayException('LINE webhook body is invalid','LINE_WEBHOOK_INVALID');}
        if(!is_array($payload)||!is_array($payload['events']??null)) throw new HubLineOaGatewayException('LINE webhook body is invalid','LINE_WEBHOOK_INVALID');
        $at=self::timestamp($now??gmdate('c'));$processed=0;$accepted=0;
        foreach(array_slice($payload['events'],0,20) as $index=>$event){
            if(!is_array($event))continue;$processed++;
            if(($event['type']??null)!=='message'||($event['message']['type']??null)!=='text')continue;
            $source=$event['source']??null;$lineUser=is_array($source)&&is_string($source['userId']??null)?trim($source['userId']):'';
            $replyToken=is_string($event['replyToken']??null)?trim((string)$event['replyToken']):'';$text=is_string($event['message']['text']??null)?trim((string)$event['message']['text']):'';
            if(!preg_match('/^U[0-9a-f]{32}$/i',$lineUser)||$replyToken===''||$text==='')continue;
            $binding=$this->bindingForExternal($lineUser);
            if(!is_array($binding)||$binding['state']!=='ACTIVE'){
                $paired=$this->consumePairing($lineUser,$text,$at);
                if($paired!==null){$accepted++;$this->reply($token,$replyToken,'เชื่อม AWH กับบัญชี Owner เรียบร้อยแล้ว ✅\nพิมพ์ “สถานะระบบ” เพื่อเริ่มใช้งานได้เลย');}
                else{$this->reply($token,$replyToken,'AWH ยังไม่ได้ผูก LINE บัญชีนี้กับ Owner\nเปิด AWH Control Panel → Settings → AWH LINE OA แล้วสร้างรหัสจับคู่ก่อน');}
                continue;
            }
            $userId=(string)$binding['user_id'];
            $this->pdo->prepare("UPDATE control_external_channel_bindings SET last_seen_at=:at WHERE binding_id=:id")->execute(['at'=>$at,'id'=>$binding['binding_id']]);
            $eventId=is_string($event['webhookEventId']??null)&&$event['webhookEventId']!==''?substr((string)$event['webhookEventId'],0,160):'line-'.hash('sha256',$body."\n".$index);
            try{
                $result=$submit($userId,$text,$eventId);$reply=trim((string)($result['replyText']??''));
                if($reply==='')$reply='รับคำสั่งแล้ว กำลังดำเนินการผ่าน AWH';
                $this->reply($token,$replyToken,self::clip($reply,4500));$accepted++;
            }catch(Throwable){$this->reply($token,$replyToken,'AWH รับข้อความแล้วแต่ยังเริ่มงานไม่ได้ กรุณาลอง “สถานะระบบ” อีกครั้ง');}
        }
        return ['schemaVersion'=>1,'processedEvents'=>$processed,'acceptedEvents'=>$accepted];
    }

    private function consumePairing(string $lineUser,string $text,string $at): ?array
    {
        if(preg_match('/(?:^|\s)(AWH-[A-Z0-9_-]{8,20})(?:\s|$)/i',$text,$m)!==1)return null;
        $hash=hash('sha256',strtoupper($m[1]));
        $q=$this->pdo->prepare("SELECT pairing_id,user_id FROM control_external_channel_pairings WHERE channel=:channel AND code_hash=:hash AND consumed_at IS NULL AND expires_at>:at LIMIT 1");
        $q->execute(['channel'=>self::CHANNEL,'hash'=>$hash,'at'=>$at]);$pair=$q->fetch();if(!is_array($pair))return null;
        try{
            $this->pdo->beginTransaction();
            $consume=$this->pdo->prepare("UPDATE control_external_channel_pairings SET consumed_at=:at WHERE pairing_id=:id AND consumed_at IS NULL AND expires_at>:at");
            $consume->execute(['at'=>$at,'id'=>$pair['pairing_id']]);
            if($consume->rowCount()!==1){$this->pdo->rollBack();return null;}
            $id=self::uuid();
            $this->pdo->prepare("INSERT INTO control_external_channel_bindings(binding_id,user_id,channel,external_user_id,state,paired_at,last_seen_at,revoked_at) VALUES(:id,:user,:channel,:external,'ACTIVE',:at,:at,NULL) ON CONFLICT(user_id,channel) DO UPDATE SET external_user_id=excluded.external_user_id,state='ACTIVE',paired_at=excluded.paired_at,last_seen_at=excluded.last_seen_at,revoked_at=NULL")
                ->execute(['id'=>$id,'user'=>$pair['user_id'],'channel'=>self::CHANNEL,'external'=>$lineUser,'at'=>$at]);
            $this->pdo->commit();return ['user_id'=>(string)$pair['user_id']];
        }catch(Throwable $e){if($this->pdo->inTransaction())$this->pdo->rollBack();throw $e;}
    }

    private function bindingForUser(string $userId): array|false
    {
        $q=$this->pdo->prepare("SELECT * FROM control_external_channel_bindings WHERE user_id=:user AND channel=:channel LIMIT 1");
        $q->execute(['user'=>$userId,'channel'=>self::CHANNEL]);return $q->fetch();
    }

    private function bindingForExternal(string $external): array|false
    {
        $q=$this->pdo->prepare("SELECT * FROM control_external_channel_bindings WHERE external_user_id=:external AND channel=:channel LIMIT 1");
        $q->execute(['external'=>$external,'channel'=>self::CHANNEL]);return $q->fetch();
    }
    private function reply(string $token,string $replyToken,string $text): void
    {
        $payload=json_encode(['replyToken'=>$replyToken,'messages'=>[['type'=>'text','text'=>$text]]],JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
        $response=$this->request(self::API_REPLY,['Authorization'=>'Bearer '.$token,'Content-Type'=>'application/json'],$payload);
        if($response['status']<200||$response['status']>=300) throw new HubLineOaGatewayException('LINE reply failed','LINE_DELIVERY_FAILED');
    }

    private function request(string $url,array $headers,string $body): array
    {
        if($this->transport!==null)return ($this->transport)($url,$headers,$body);
        if(!function_exists('curl_init'))throw new HubLineOaGatewayException('HTTP transport unavailable','LINE_DELIVERY_FAILED');
        $ch=curl_init($url);if($ch===false)throw new HubLineOaGatewayException('HTTP transport unavailable','LINE_DELIVERY_FAILED');
        $headerLines=[];foreach($headers as $name=>$value)$headerLines[]=$name.': '.$value;
        curl_setopt_array($ch,[CURLOPT_POST=>true,CURLOPT_HTTPHEADER=>$headerLines,CURLOPT_POSTFIELDS=>$body,CURLOPT_RETURNTRANSFER=>true,CURLOPT_CONNECTTIMEOUT=>3,CURLOPT_TIMEOUT=>6,CURLOPT_PROTOCOLS=>CURLPROTO_HTTPS,CURLOPT_FOLLOWLOCATION=>false]);
        $response=curl_exec($ch);$status=(int)curl_getinfo($ch,CURLINFO_RESPONSE_CODE);$errno=curl_errno($ch);curl_close($ch);
        if($response===false||$errno!==0)throw new HubLineOaGatewayException('LINE transport failed','LINE_DELIVERY_FAILED');
        return ['status'=>$status,'body'=>(string)$response];
    }

    private function assertSchema(): void
    {
        if(!self::schemaPresent($this->pdo))throw new HubLineOaGatewayException('LINE gateway migration is not ready','LINE_GATEWAY_SCHEMA_NOT_READY');
    }
    private static function clip(string $value,int $bytes): string
    {
        $value=trim($value);if(strlen($value)<=$bytes)return $value;
        return function_exists('mb_strcut')?trim((string)mb_strcut($value,0,$bytes-4,'UTF-8')).'…':substr($value,0,$bytes-4).'…';
    }

    private static function timestamp(string $value): string
    {
        if(strtotime($value)===false)throw new HubLineOaGatewayException('Time is invalid','LINE_GATEWAY_FAILED');
        return gmdate('c',strtotime($value));
    }

    private static function base64url(string $bytes): string
    {
        return rtrim(strtr(base64_encode($bytes),'+/','-_'),'=');
    }

    private static function uuid(): string
    {
        $b=random_bytes(16);$b[6]=chr((ord($b[6])&15)|64);$b[8]=chr((ord($b[8])&63)|128);
        return vsprintf('%s%s-%s-%s-%s-%s%s%s',str_split(bin2hex($b),4));
    }
}
