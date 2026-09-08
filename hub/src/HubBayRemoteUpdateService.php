<?php
declare(strict_types=1);

require_once __DIR__.'/HubProviderCredentialStore.php';

final class HubBayRemoteUpdateException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName='BAY_UPDATE_FAILED'){ parent::__construct($message); }
}

final class HubBayRemoteUpdateService
{
    private const ENDPOINT='https://kruart.great-site.net/remote-update.php';
    private const SIGNING_PROVIDER='bay-remote-update-signing';
    private const PROTOCOL='BAY-REMOTE-UPDATE-V1';

    /** @return array<string,mixed> */
    public function status(?string $now=null): array
    {
        return [
            'schemaVersion'=>1,
            'endpoint'=>self::ENDPOINT,
            'transport'=>'browser-relay',
            'packageAuthority'=>'BAY Update Inbox',
            'installAuthority'=>'BAY PackageManager',
            'autoInbox'=>true,
            'statusRelay'=>$this->sign('STATUS','-','-','-',$now),
        ];
    }

    /** @return array<string,mixed> */
    public function installRelay(string $targetVersion,string $targetSha,string $packageSha256,?string $now=null): array
    {
        $targetVersion=trim($targetVersion);
        $targetSha=strtolower(trim($targetSha));
        $packageSha256=strtolower(trim($packageSha256));
        if(preg_match('/^[0-9A-Za-z][0-9A-Za-z._+-]{0,79}$/',$targetVersion)!==1) throw new HubBayRemoteUpdateException('BAY target version is invalid','BAY_UPDATE_REQUEST_INVALID');
        if(preg_match('/^[a-f0-9]{40}$/',$targetSha)!==1) throw new HubBayRemoteUpdateException('BAY target SHA is invalid','BAY_UPDATE_REQUEST_INVALID');
        if(preg_match('/^[a-f0-9]{64}$/',$packageSha256)!==1) throw new HubBayRemoteUpdateException('BAY package SHA is invalid','BAY_UPDATE_PACKAGE_INVALID');
        return [
            'schemaVersion'=>1,
            'endpoint'=>self::ENDPOINT,
            'relay'=>$this->sign('INSTALL',$targetVersion,$targetSha,$packageSha256,$now),
        ];
    }

    /** @return array<string,mixed> */
    private function sign(string $command,string $targetVersion,string $targetSha,string $packageSha256,?string $now): array
    {
        if(!function_exists('sodium_crypto_sign_detached')) throw new HubBayRemoteUpdateException('AWH signing runtime is unavailable','BAY_UPDATE_SIGNING_UNAVAILABLE');
        $store=HubProviderCredentialStore::fromEnvironment(self::SIGNING_PROVIDER);
        $encoded=$store->read();
        if(!is_string($encoded)) throw new HubBayRemoteUpdateException('BAY Remote Update signing key is not configured','BAY_UPDATE_SIGNING_NOT_CONFIGURED');
        $secret=base64_decode($encoded,true);
        if(!is_string($secret)||strlen($secret)!==SODIUM_CRYPTO_SIGN_SECRETKEYBYTES) throw new HubBayRemoteUpdateException('BAY Remote Update signing key is invalid','BAY_UPDATE_SIGNING_INVALID');
        $issued=strtotime($now??gmdate('c'));
        if($issued===false)$issued=time();
        $expires=$issued+90;
        $nonce=bin2hex(random_bytes(32));
        $message=implode("\n",[self::PROTOCOL,$command,(string)$issued,(string)$expires,$nonce,$targetVersion,$targetSha,$packageSha256]);
        return [
            'schemaVersion'=>1,'command'=>$command,'issuedAt'=>$issued,'expiresAt'=>$expires,'nonce'=>$nonce,
            'targetVersion'=>$targetVersion,'targetSha'=>$targetSha,'packageSha256'=>$packageSha256,
            'signature'=>base64_encode(sodium_crypto_sign_detached($message,$secret)),
        ];
    }
}
