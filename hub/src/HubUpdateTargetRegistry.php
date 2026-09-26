<?php
declare(strict_types=1);

final class HubUpdateTargetRegistry
{
    /** @return array<string,array{directory:string,project:string,projection:bool,kind:string,defaultBranch:string}> */
    public static function repositories(): array
    {
        return [
            'awh'=>['directory'=>'awh.git','project'=>'Art’s Workspace Hub','projection'=>false,'kind'=>'CORE','defaultBranch'=>'production'],
            'bay-excuse-x'=>['directory'=>'bay-excuse-x.git','project'=>'BAY EXCUSE X','projection'=>true,'kind'=>'SYSTEM','defaultBranch'=>'main'],
            'bay-hub'=>['directory'=>'bay-hub.git','project'=>'BAY Hub','projection'=>true,'kind'=>'HUB','defaultBranch'=>'main'],
            'bay-learnlab'=>['directory'=>'bay-learnlab.git','project'=>'BAY LearnLab','projection'=>true,'kind'=>'PRODUCT','defaultBranch'=>'main'],
            'bay-assessment'=>['directory'=>'bay-assessment.git','project'=>'BAY Assessment','projection'=>false,'kind'=>'PRODUCT','defaultBranch'=>'main'],
            'school-website'=>['directory'=>'school-website.git','project'=>'เว็บไซต์โรงเรียน','projection'=>true,'kind'=>'HOSTING','defaultBranch'=>'main'],
            'bay-computer-lab'=>['directory'=>'bay-computer-lab.git','project'=>'BAY Computer Lab','projection'=>true,'kind'=>'SYSTEM','defaultBranch'=>'main'],
        ];
    }


    /**
     * Every canonical patch must carry a compact owner-readable change contract.
     * Legacy metadata stays readable in the UI; strict mode is used for new promotions.
     */
    public static function releaseDetailsReady(mixed $notes,bool $strict=false): bool
    {
        if(!is_array($notes)||array_is_list($notes)||($notes['schemaVersion']??null)!==1)return false;
        $summary=$notes['summary']??null;if(!is_array($summary)||array_is_list($summary))return false;
        $total=0;
        foreach(['features','improvements','fixes','internal'] as $key){
            $rows=$summary[$key]??null;if(!is_array($rows)||!array_is_list($rows))return false;
            foreach($rows as $row){if(!is_string($row)||trim($row)===''||strlen($row)>220)return false;$total++;}
        }
        if($total<1)return false;
        $impact=$notes['impact']??null;
        if(!is_array($impact)||array_is_list($impact)||!is_bool($impact['plannedDowntime']??null))return false;
        foreach(['databaseMigration','serviceReload','appRestart','signIn'] as $key)
            if(!is_string($impact[$key]??null)||trim((string)$impact[$key])==='')return false;
        if(!is_array($notes['knownIssues']??null)||!array_is_list($notes['knownIssues']))return false;
        foreach($notes['knownIssues'] as $issue)if(!is_string($issue)||trim($issue)===''||strlen($issue)>220)return false;
        if(!$strict)return true;
        if(($notes['metadataState']??null)!=='READY'||!is_bool($notes['userVisible']??null)||!is_string($notes['ownerSummary']??null)||trim((string)$notes['ownerSummary'])==='')return false;
        $compat=$notes['compatibility']??null;
        if(!is_array($compat)||array_is_list($compat))return false;
        foreach(['data','runtime','authentication'] as $key)
            if(!is_string($compat[$key]??null)||trim((string)$compat[$key])==='')return false;
        $rollback=$notes['rollback']??null;
        if(!is_array($rollback)||array_is_list($rollback)||($rollback['required']??null)!==true||!is_string($rollback['strategy']??null)||trim((string)$rollback['strategy'])==='')return false;
        $previous=strtolower(trim((string)($rollback['sourceSha']??'')));
        return preg_match('/^[0-9a-f]{40}$/',$previous)===1;
    }

    /** @return array{repository:string,directory:string,project:string,projection:bool,kind:string,defaultBranch:string}|null */
    public static function byProjectName(string $name): ?array
    {
        foreach (self::repositories() as $repository=>$row) if ($row['project']===$name) return ['repository'=>$repository]+$row;
        return null;
    }
}
