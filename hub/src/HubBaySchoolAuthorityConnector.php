<?php

declare(strict_types=1);

require_once __DIR__ . '/HubMariaDbReadClient.php';

final class HubBaySchoolAuthorityException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName='BAY_IDENTITY_UNAVAILABLE'){parent::__construct($message);}
}

/**
 * Read-only BAY school authority projection.
 * Reuses the existing Database Studio MariaDB observer (SELECT + SHOW VIEW only);
 * it owns no credential, write path, filesystem release path or school-role cache.
 */
final class HubBaySchoolAuthorityConnector
{
    public function __construct(
        private readonly HubMariaDbReadClient $reader,
        private readonly string $database
    ){
        if(preg_match('/^[A-Za-z0-9_]{1,64}$/',$database)!==1)throw new HubBaySchoolAuthorityException('BAY database authority is invalid','BAY_IDENTITY_CONFIG_INVALID');
    }

    public static function fromControlPlane(PDO $control): self
    {
        $reader=HubMariaDbReadClient::fromEnvironment();
        if(!$reader instanceof HubMariaDbReadClient)throw new HubBaySchoolAuthorityException('AWH MariaDB read authority is unavailable','BAY_IDENTITY_UNAVAILABLE');
        try{
            $q=$control->prepare("SELECT d.database_name FROM control_site_database_bindings d JOIN control_managed_sites s ON s.site_id=d.site_id WHERE d.engine='MARIADB' AND d.state='READY' AND s.name='BAY EXCUSE X' ORDER BY d.site_id LIMIT 1");
            $q->execute();$database=$q->fetchColumn();
        }catch(Throwable){$database=false;}
        if(!is_string($database)||preg_match('/^[A-Za-z0-9_]{1,64}$/',$database)!==1)throw new HubBaySchoolAuthorityException('BAY database is not registered in AWH','BAY_IDENTITY_UNAVAILABLE');
        return new self($reader,$database);
    }

    /** @return list<array<string,mixed>> */
    public function people(int $limit=300): array
    {
        try{return $this->reader->baySchoolPeople($this->database,$limit);}
        catch(HubMariaDbReadClientException $e){throw new HubBaySchoolAuthorityException('BAY school directory is unavailable',$this->map($e->codeName));}
    }

    /** @return array<string,mixed> */
    public function resolve(int $bayUserId): array
    {
        try{return $this->reader->baySchoolIdentity($this->database,$bayUserId);}
        catch(HubMariaDbReadClientException $e){throw new HubBaySchoolAuthorityException('BAY identity is unavailable',$this->map($e->codeName));}
    }

    /** @return array<string,mixed> */
    public function communicationSummary(): array
    {
        try{return $this->reader->bayCommunicationSummary($this->database);}
        catch(HubMariaDbReadClientException $e){throw new HubBaySchoolAuthorityException('BAY communication authority is unavailable',$this->map($e->codeName));}
    }

    private function map(string $code): string
    {
        return match($code){
            'BAY_IDENTITY_INACTIVE'=>'BAY_IDENTITY_INACTIVE',
            'BAY_IDENTITY_SCHEMA_UNAVAILABLE'=>'BAY_IDENTITY_SCHEMA_UNAVAILABLE',
            'DATABASE_REQUEST_INVALID'=>'BAY_IDENTITY_INVALID',
            'DATABASE_UNAVAILABLE','MARIADB_CONFIG_INVALID'=>'BAY_IDENTITY_UNAVAILABLE',
            default=>'BAY_IDENTITY_UNAVAILABLE',
        };
    }
}
