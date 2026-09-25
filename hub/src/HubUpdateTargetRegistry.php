<?php
declare(strict_types=1);

final class HubUpdateTargetRegistry
{
    /** @return array<string,array{directory:string,project:string,projection:bool,kind:string}> */
    public static function repositories(): array
    {
        return [
            'awh'=>['directory'=>'awh.git','project'=>'Art’s Workspace Hub','projection'=>false,'kind'=>'CORE'],
            'bay-excuse-x'=>['directory'=>'bay-excuse-x.git','project'=>'BAY EXCUSE X','projection'=>true,'kind'=>'SYSTEM'],
            'bay-hub'=>['directory'=>'bay-hub.git','project'=>'BAY Hub','projection'=>true,'kind'=>'HUB'],
            'bay-learnlab'=>['directory'=>'bay-learnlab.git','project'=>'BAY LearnLab','projection'=>true,'kind'=>'PRODUCT'],
            'bay-assessment'=>['directory'=>'bay-assessment.git','project'=>'BAY Assessment','projection'=>false,'kind'=>'PRODUCT'],
            'school-website'=>['directory'=>'school-website.git','project'=>'เว็บไซต์โรงเรียน','projection'=>true,'kind'=>'HOSTING'],
            'bay-computer-lab'=>['directory'=>'bay-computer-lab.git','project'=>'BAY Computer Lab','projection'=>true,'kind'=>'SYSTEM'],
        ];
    }

    /** @return array{repository:string,directory:string,project:string,projection:bool,kind:string}|null */
    public static function byProjectName(string $name): ?array
    {
        foreach (self::repositories() as $repository=>$row) if ($row['project']===$name) return ['repository'=>$repository]+$row;
        return null;
    }
}
