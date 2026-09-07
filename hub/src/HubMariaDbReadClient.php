<?php

declare(strict_types=1);

final class HubMariaDbReadClientException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName = 'MARIADB_READ_FAILED') { parent::__construct($message); }
}

/**
 * Server-side MariaDB inspection adapter. The intended runtime principal has
 * SELECT + SHOW VIEW only on explicitly registered application databases.
 * No mutation method exists in this class.
 */
final class HubMariaDbReadClient
{
    private const MAX_PAGE_SIZE = 100;
    private const MAX_EXPORT_ROWS = 5000;
    private const MAX_EXPORT_BYTES = 5_242_880;

    private function __construct(private readonly string $socket, private readonly string $user, private readonly string $password) {}

    public static function fromEnvironment(): ?self
    {
        $user = getenv('AWH_DATABASE_STUDIO_MARIADB_USER');
        $passwordFile = getenv('AWH_DATABASE_STUDIO_MARIADB_PASSWORD_FILE');
        $socket = getenv('AWH_DATABASE_STUDIO_MARIADB_SOCKET') ?: '/run/mysqld/mysqld.sock';
        if (!is_string($user) || $user === '' || !is_string($passwordFile) || $passwordFile === '') return null;
        if (!preg_match('/^[A-Za-z0-9_]{1,64}$/', $user) || !self::safeAbsoluteFile($passwordFile) || !self::validSocket($socket)) return null;
        $password = file_get_contents($passwordFile, false, null, 0, 256);
        if (!is_string($password)) return null;
        $password = rtrim($password, "\r\n");
        if (strlen($password) > 192 || preg_match('/[\x00-\x1f\x7f]/', $password)) return null;
        return new self($socket, $user, $password);
    }

    public static function forSocket(string $socket, string $user, string $password): self
    {
        if (!self::validSocket($socket) || !preg_match('/^[A-Za-z0-9_]{1,64}$/', $user) || strlen($password) > 192 || preg_match('/[\x00-\x1f\x7f]/', $password)) {
            throw new HubMariaDbReadClientException('MariaDB reader configuration is invalid', 'MARIADB_CONFIG_INVALID');
        }
        return new self($socket, $user, $password);
    }

    public function databaseOverview(string $database): array
    {
        $pdo = $this->open($database);
        $q = $pdo->prepare("SELECT COALESCE(SUM(data_length + index_length),0) AS bytes, COUNT(*) AS tables FROM information_schema.tables WHERE table_schema=:db");
        $q->execute(['db'=>$database]); $row = $q->fetch();
        $version = (string) $pdo->query('SELECT VERSION()')->fetchColumn();
        return ['engine'=>'MariaDB','databaseName'=>$database,'sizeBytes'=>(int)($row['bytes']??0),'tables'=>(int)($row['tables']??0),'serverVersion'=>$version,'readOnly'=>true];
    }

    public function tables(string $database): array
    {
        $pdo = $this->open($database);
        $q = $pdo->prepare("SELECT table_name,table_type,table_rows,data_length,index_length FROM information_schema.tables WHERE table_schema=:db ORDER BY table_name");
        $q->execute(['db'=>$database]); $out=[];
        foreach ($q->fetchAll() as $row) {
            $name=(string)$row['table_name']; $locked=self::sensitiveTable($name);
            $out[]=['name'=>$name,'type'=>(string)$row['table_type'],'locked'=>$locked,'rowCount'=>$locked?null:(is_numeric($row['table_rows'])?(int)$row['table_rows']:null),'sizeBytes'=>(int)($row['data_length']??0)+(int)($row['index_length']??0)];
        }
        return $out;
    }

    public function browse(string $database,string $table,?string $search=null,int $page=1,int $limit=50,?string $sort=null,string $direction='ASC'): array
    {
        if ($page<1||$page>10000||$limit<1||$limit>self::MAX_PAGE_SIZE) throw new HubMariaDbReadClientException('Pagination is invalid','DATABASE_REQUEST_INVALID');
        $pdo=$this->open($database); $table=$this->assertTable($pdo,$database,$table); if(self::sensitiveTable($table)) throw new HubMariaDbReadClientException('Table is protected','DATABASE_TABLE_RESTRICTED');
        $columns=$this->columns($pdo,$database,$table); [$sort,$direction]=$this->sortContract($columns,$sort,$direction); $search=self::searchText($search); [$where,$params]=$this->searchClause($columns,$search);
        $count=$pdo->prepare('SELECT COUNT(*) FROM '.self::qid($table).$where); $count->execute($params); $total=(int)$count->fetchColumn();
        $select=[]; foreach($columns as $c)$select[]=$c['redacted']?'NULL AS '.self::qid($c['name']):self::qid($c['name']);
        $sql='SELECT '.implode(', ',$select).' FROM '.self::qid($table).$where.' ORDER BY '.self::qid($sort).' '.$direction.' LIMIT :limit OFFSET :offset';
        $q=$pdo->prepare($sql); foreach($params as $k=>$v)$q->bindValue($k,$v,PDO::PARAM_STR); $q->bindValue(':limit',$limit,PDO::PARAM_INT); $q->bindValue(':offset',($page-1)*$limit,PDO::PARAM_INT); $q->execute();
        $rows=[]; $redacted=array_column(array_filter($columns,static fn(array $c):bool=>$c['redacted']),'name'); foreach($q->fetchAll() as $row){foreach($redacted as $name)$row[$name]='[ซ่อนข้อมูลอ่อนไหว]';$rows[]=$this->normalizeRow($row);}
        return ['table'=>$table,'columns'=>$this->publicColumns($columns),'rows'=>$rows,'page'=>$page,'pageSize'=>$limit,'totalRows'=>$total,'totalPages'=>max(1,(int)ceil($total/$limit)),'search'=>$search,'sort'=>$sort,'direction'=>$direction];
    }

    public function schema(string $database,string $table): array
    {
        $pdo=$this->open($database); $table=$this->assertTable($pdo,$database,$table); if(self::sensitiveTable($table))return ['table'=>$table,'locked'=>true,'columns'=>[],'indexes'=>[],'foreignKeys'=>[]];
        $columns=$this->columns($pdo,$database,$table);
        $iq=$pdo->prepare("SELECT index_name,non_unique,seq_in_index,column_name FROM information_schema.statistics WHERE table_schema=:db AND table_name=:table ORDER BY index_name,seq_in_index");$iq->execute(['db'=>$database,'table'=>$table]);$map=[];foreach($iq->fetchAll() as $r){$n=(string)$r['index_name'];if(!isset($map[$n]))$map[$n]=['name'=>$n,'unique'=>(int)$r['non_unique']===0,'columns'=>[]];$map[$n]['columns'][]=(string)$r['column_name'];}
        $fq=$pdo->prepare("SELECT k.column_name,k.referenced_table_name,k.referenced_column_name,r.update_rule,r.delete_rule FROM information_schema.key_column_usage k LEFT JOIN information_schema.referential_constraints r ON r.constraint_schema=k.constraint_schema AND r.constraint_name=k.constraint_name AND r.table_name=k.table_name WHERE k.table_schema=:db AND k.table_name=:table AND k.referenced_table_name IS NOT NULL ORDER BY k.ordinal_position");$fq->execute(['db'=>$database,'table'=>$table]);$foreign=[];foreach($fq->fetchAll() as $r)$foreign[]=['from'=>(string)$r['column_name'],'table'=>(string)$r['referenced_table_name'],'to'=>(string)$r['referenced_column_name'],'onUpdate'=>(string)($r['update_rule']??''),'onDelete'=>(string)($r['delete_rule']??'')];
        return ['table'=>$table,'locked'=>false,'columns'=>$this->publicColumns($columns),'indexes'=>array_values($map),'foreignKeys'=>$foreign];
    }

    public function export(string $database,string $table,string $format,?string $search=null,?string $sort=null,string $direction='ASC'): array
    {
        $format=strtolower(trim($format));if(!in_array($format,['csv','json'],true))throw new HubMariaDbReadClientException('Export format is invalid','DATABASE_REQUEST_INVALID');
        $pdo=$this->open($database);$table=$this->assertTable($pdo,$database,$table);if(self::sensitiveTable($table))throw new HubMariaDbReadClientException('Table is protected','DATABASE_TABLE_RESTRICTED');$columns=$this->columns($pdo,$database,$table);[$sort,$direction]=$this->sortContract($columns,$sort,$direction);$search=self::searchText($search);[$where,$params]=$this->searchClause($columns,$search);
        $safe=array_values(array_filter($columns,static fn(array $c):bool=>!$c['redacted']));$names=array_column($safe,'name');$sql='SELECT '.implode(', ',array_map([self::class,'qid'],$names)).' FROM '.self::qid($table).$where.' ORDER BY '.self::qid($sort).' '.$direction.' LIMIT '.(self::MAX_EXPORT_ROWS+1);$q=$pdo->prepare($sql);$q->execute($params);$rows=$q->fetchAll();$truncated=count($rows)>self::MAX_EXPORT_ROWS;if($truncated)array_pop($rows);
        if($format==='json'){$content=json_encode(array_map(fn($r)=>$this->normalizeRow($r),$rows),JSON_PRETTY_PRINT|JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);$mime='application/json';}
        else{$stream=fopen('php://temp','w+');if(!is_resource($stream))throw new HubMariaDbReadClientException('Export failed','DATABASE_EXPORT_FAILED');fputcsv($stream,$names);foreach($rows as $r)fputcsv($stream,array_map(static fn($n)=>is_scalar($r[$n]??null)||($r[$n]??null)===null?$r[$n]:json_encode($r[$n]),$names));rewind($stream);$content=stream_get_contents($stream);fclose($stream);$mime='text/csv';}
        if(!is_string($content)||strlen($content)>self::MAX_EXPORT_BYTES)throw new HubMariaDbReadClientException('Export is too large','DATABASE_EXPORT_TOO_LARGE');return ['table'=>$table,'format'=>$format,'filename'=>$database.'-'.$table.'.'.$format,'mimeType'=>$mime,'content'=>$content,'sizeBytes'=>strlen($content),'rows'=>count($rows),'truncated'=>$truncated];
    }

    public function health(string $database): array
    {
        $pdo=$this->open($database);$value=(int)$pdo->query('SELECT 1')->fetchColumn();$q=$pdo->prepare("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=:db");$q->execute(['db'=>$database]);return ['status'=>$value===1?'PASS':'REVIEW','readOnly'=>true,'databaseName'=>$database,'tables'=>(int)$q->fetchColumn(),'serverVersion'=>(string)$pdo->query('SELECT VERSION()')->fetchColumn()];
    }

    public function migrationReadiness(string $database): array
    {
        $pdo=$this->open($database);
        $schema=$pdo->prepare("SELECT default_character_set_name,default_collation_name FROM information_schema.schemata WHERE schema_name=:db");$schema->execute(['db'=>$database]);$meta=$schema->fetch()?:[];
        $objects=$pdo->prepare("SELECT table_type,COUNT(*) c,COALESCE(SUM(table_rows),0) rows_estimate FROM information_schema.tables WHERE table_schema=:db GROUP BY table_type");$objects->execute(['db'=>$database]);$types=[];$rowsEstimate=0;foreach($objects->fetchAll() as $r){$types[(string)$r['table_type']]=(int)$r['c'];$rowsEstimate+=(int)$r['rows_estimate'];}
        $count=function(string $sql)use($pdo,$database):int{$q=$pdo->prepare($sql);$q->execute(['db'=>$database]);return(int)$q->fetchColumn();};
        $indexes=$count("SELECT COUNT(DISTINCT table_name,index_name) FROM information_schema.statistics WHERE table_schema=:db");
        $foreign=$count("SELECT COUNT(*) FROM information_schema.key_column_usage WHERE table_schema=:db AND referenced_table_name IS NOT NULL");
        $triggers=$count("SELECT COUNT(*) FROM information_schema.triggers WHERE trigger_schema=:db");
        $events=$count("SELECT COUNT(*) FROM information_schema.events WHERE event_schema=:db");
        return ['databaseName'=>$database,'engine'=>'MARIADB','readOnly'=>true,'serverVersion'=>(string)$pdo->query('SELECT VERSION()')->fetchColumn(),'charset'=>(string)($meta['default_character_set_name']??''),'collation'=>(string)($meta['default_collation_name']??''),'objects'=>['baseTables'=>(int)($types['BASE TABLE']??0),'views'=>(int)($types['VIEW']??0),'rowsEstimate'=>$rowsEstimate,'indexes'=>$indexes,'foreignKeys'=>$foreign,'triggers'=>$triggers,'events'=>$events],'migration'=>['mode'=>'SHADOW_FIRST','productionMutationAllowed'=>false,'dualWriteAllowed'=>false,'requiredBeforeCutover'=>['immutable-dump-and-sha256','exact-row-count-manifest','schema-object-manifest','uploads-checksum-manifest','shadow-restore-reconciliation','critical-flow-smoke','backup-restore-proof','rollback-preserves-post-cutover-writes']]];
    }

    private function open(string $database): PDO
    {
        self::databaseName($database);
        try{$pdo=new PDO('mysql:unix_socket='.$this->socket.';dbname='.$database.';charset=utf8mb4',$this->user,$this->password,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC,PDO::ATTR_EMULATE_PREPARES=>false]);$pdo->exec("SET SESSION sql_mode='STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'");return $pdo;}
        catch(Throwable){throw new HubMariaDbReadClientException('MariaDB read connection is unavailable','DATABASE_UNAVAILABLE');}
    }
    private function assertTable(PDO $pdo,string $database,string $table):string{if(!preg_match('/^[A-Za-z_][A-Za-z0-9_$]{0,127}$/',$table))throw new HubMariaDbReadClientException('Table name is invalid','DATABASE_REQUEST_INVALID');$q=$pdo->prepare("SELECT table_name FROM information_schema.tables WHERE table_schema=:db AND table_name=:table");$q->execute(['db'=>$database,'table'=>$table]);$name=$q->fetchColumn();if(!is_string($name))throw new HubMariaDbReadClientException('Table was not found','DATABASE_TABLE_NOT_FOUND');return $name;}
    private function columns(PDO $pdo,string $database,string $table):array{$q=$pdo->prepare("SELECT column_name,column_type,is_nullable,column_default,column_key,ordinal_position FROM information_schema.columns WHERE table_schema=:db AND table_name=:table ORDER BY ordinal_position");$q->execute(['db'=>$database,'table'=>$table]);$out=[];foreach($q->fetchAll() as $r){$name=(string)$r['column_name'];$out[]=['name'=>$name,'type'=>(string)$r['column_type'],'notNull'=>(string)$r['is_nullable']==='NO','primaryKey'=>(string)$r['column_key']==='PRI'?1:0,'default'=>self::sensitiveColumn($name)?null:$r['column_default'],'redacted'=>self::sensitiveColumn($name)];}if($out===[])throw new HubMariaDbReadClientException('Table schema is unavailable','DATABASE_SCHEMA_FAILED');return $out;}
    private function publicColumns(array $columns):array{return array_map(static fn(array $c):array=>['name'=>$c['name'],'type'=>$c['type'],'notNull'=>$c['notNull'],'primaryKey'=>$c['primaryKey'],'default'=>$c['default'],'redacted'=>$c['redacted']],$columns);}
    private function sortContract(array $columns,?string $sort,string $direction):array{$safe=array_values(array_filter($columns,static fn(array $c):bool=>!$c['redacted']));$names=array_column($safe,'name');if($sort===null||$sort===''){$pk=array_values(array_filter($safe,static fn(array $c):bool=>$c['primaryKey']>0));$sort=$pk[0]['name']??$names[0]??null;}if(!is_string($sort)||!in_array($sort,$names,true))throw new HubMariaDbReadClientException('Sort column is invalid','DATABASE_REQUEST_INVALID');$direction=strtoupper($direction);if(!in_array($direction,['ASC','DESC'],true))throw new HubMariaDbReadClientException('Sort direction is invalid','DATABASE_REQUEST_INVALID');return[$sort,$direction];}
    private function searchClause(array $columns,?string $search):array{if($search===null)return['',[]];$parts=[];foreach($columns as $c)if(!$c['redacted']&&!preg_match('/(?:blob|binary)/i',(string)$c['type']))$parts[]='LOWER(CAST('.self::qid($c['name']).' AS CHAR)) LIKE LOWER(:needle)';return $parts===[]?['',[]]:[' WHERE ('.implode(' OR ',$parts).')',['needle'=>'%'.$search.'%']];}
    private function normalizeRow(array $row):array{$out=[];foreach($row as $k=>$v){$name=(string)$k;if(self::sensitiveColumn($name)){$out[$name]='[ซ่อนข้อมูลอ่อนไหว]';continue;}if(is_string($v)){$out[$name]=preg_match('//u',$v)!==1||preg_match('/[\x00-\x08\x0b\x0c\x0e-\x1f]/',$v)?'[binary '.strlen($v).' bytes]':(strlen($v)>4000?substr($v,0,3999).'…':$v);}else$out[$name]=$v;}return$out;}
    private static function searchText(?string $v):?string{if($v===null)return null;$v=trim($v);if($v==='')return null;if(strlen($v)>160||preg_match('/[\x00-\x1f\x7f]/',$v))throw new HubMariaDbReadClientException('Search text is invalid','DATABASE_REQUEST_INVALID');return$v;}
    private static function databaseName(string $v):string{if(!preg_match('/^[A-Za-z0-9_]{1,64}$/',$v))throw new HubMariaDbReadClientException('Database name is invalid','DATABASE_REQUEST_INVALID');return$v;}
    private static function qid(string $v):string{return '`'.str_replace('`','``',$v).'`';}
    private static function sensitiveTable(string $v):bool{return preg_match('/(?:password|credential|token|session|pairing|recovery|secret)/i',$v)===1;}
    private static function sensitiveColumn(string $v):bool{return preg_match('/(?:password|secret|token|credential|csrf|api[_-]?key|private[_-]?key|(?:^|_)hash$|(?:^|_)salt$)/i',$v)===1;}
    private static function validSocket(string $path):bool{if(!str_starts_with($path,'/')||str_contains($path,"\0")||!file_exists($path))return false;$type=@filetype($path);return $type==='socket';}
    private static function safeAbsoluteFile(string $path):bool{return str_starts_with($path,'/')&&!str_contains($path,"\0")&&is_file($path)&&!is_link($path);}
}
