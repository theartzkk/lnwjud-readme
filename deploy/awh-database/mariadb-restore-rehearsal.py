#!/usr/bin/env python3
import argparse, datetime, json, os, re, secrets, subprocess, tempfile
from pathlib import Path

SAFE_SOURCE = re.compile(r'^[A-Za-z0-9_]{1,64}$')
SAFE_DRILL = re.compile(r'^awh_restore_drill_[0-9]{8}_[0-9a-f]{8}$')
SYSTEM = {'information_schema','mysql','performance_schema','sys'}

def run(argv, stdin=None, check=True):
    p=subprocess.run(argv,input=stdin,text=isinstance(stdin,str) or stdin is None,capture_output=True,check=False,env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin'})
    if check and p.returncode:
        raise RuntimeError(f'command failed: {Path(argv[0]).name}: {p.stderr[:500]}')
    return p

def qid(name): return '`'+name.replace('`','``')+'`'

def scalar(sql):
    p=run(['/usr/bin/mariadb','--protocol=socket','--batch','--skip-column-names','-e',sql])
    return p.stdout.strip()

def table_rows(db):
    raw=scalar(f"SELECT table_name FROM information_schema.tables WHERE table_schema={json.dumps(db)} AND table_type='BASE TABLE' ORDER BY table_name")
    names=[x for x in raw.splitlines() if x]
    if not names: return {}
    union=' UNION ALL '.join(f"SELECT {json.dumps(n)} AS t, COUNT(*) AS c FROM {qid(db)}.{qid(n)}" for n in names)
    out=scalar(union)
    rows={}
    for line in out.splitlines():
        t,c=line.split('\t',1); rows[t]=int(c)
    return rows

def object_counts(db):
    esc=json.dumps(db)
    return {
        'tables': int(scalar(f"SELECT COUNT(*) FROM information_schema.tables WHERE table_schema={esc} AND table_type='BASE TABLE'") or 0),
        'views': int(scalar(f"SELECT COUNT(*) FROM information_schema.tables WHERE table_schema={esc} AND table_type='VIEW'") or 0),
        'triggers': int(scalar(f"SELECT COUNT(*) FROM information_schema.triggers WHERE trigger_schema={esc}") or 0),
        'routines': int(scalar(f"SELECT COUNT(*) FROM information_schema.routines WHERE routine_schema={esc}") or 0),
        'events': int(scalar(f"SELECT COUNT(*) FROM information_schema.events WHERE event_schema={esc}") or 0),
    }

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--source',required=True)
    args=ap.parse_args()
    source=args.source
    if not SAFE_SOURCE.fullmatch(source) or source in SYSTEM:
        raise SystemExit('RESTORE_DRILL_BLOCKED=INVALID_SOURCE')
    # This tool is deliberately limited to non-production proof/staging authorities.
    if not any(marker in source.lower() for marker in ('staging','proof')):
        raise SystemExit('RESTORE_DRILL_BLOCKED=SOURCE_NOT_PROVEN_NON_PRODUCTION')
    if scalar(f"SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name={json.dumps(source)}")!='1':
        raise SystemExit('RESTORE_DRILL_BLOCKED=SOURCE_NOT_FOUND')

    stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d')
    drill=f'awh_restore_drill_{stamp}_{secrets.token_hex(4)}'
    if not SAFE_DRILL.fullmatch(drill): raise SystemExit('RESTORE_DRILL_BLOCKED=DRILL_NAME')
    dump_fd,dump_name=tempfile.mkstemp(prefix='awh-mariadb-drill-',suffix='.sql',dir='/var/tmp')
    os.close(dump_fd); os.chmod(dump_name,0o600)
    created=False
    result={'schemaVersion':1,'source':source,'drillDatabase':drill,'state':'FAIL'}
    try:
        before_objects=object_counts(source); before_rows=table_rows(source)
        with open(dump_name,'wb') as out:
            p=subprocess.run(['/usr/bin/mariadb-dump','--protocol=socket','--single-transaction','--quick','--routines','--triggers','--events','--hex-blob','--skip-lock-tables','--default-character-set=utf8mb4',source],stdout=out,stderr=subprocess.PIPE,check=False,env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin'})
        if p.returncode: raise RuntimeError('dump failed: '+p.stderr.decode('utf-8','replace')[:500])
        dump_bytes=os.path.getsize(dump_name)
        run(['/usr/bin/mariadb','--protocol=socket','--batch','--skip-column-names','-e',f'CREATE DATABASE {qid(drill)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'])
        created=True
        with open(dump_name,'rb') as inp:
            p=subprocess.run(['/usr/bin/mariadb','--protocol=socket','--batch',drill],stdin=inp,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=False,env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin'})
        if p.returncode: raise RuntimeError('restore failed: '+p.stderr.decode('utf-8','replace')[:500])
        after_objects=object_counts(drill); after_rows=table_rows(drill)
        row_mismatch={k:{'source':v,'restored':after_rows.get(k)} for k,v in before_rows.items() if after_rows.get(k)!=v}
        extra=sorted(set(after_rows)-set(before_rows)); missing=sorted(set(before_rows)-set(after_rows))
        object_match=before_objects==after_objects
        result.update({'state':'PASS' if object_match and not row_mismatch and not extra and not missing else 'REVIEW','dumpBytes':dump_bytes,'sourceObjects':before_objects,'restoredObjects':after_objects,'baseTableCount':len(before_rows),'rowCountMismatchCount':len(row_mismatch),'missingTables':missing[:20],'extraTables':extra[:20]})
        if result['state']!='PASS':
            result['rowCountMismatchSample']=dict(list(row_mismatch.items())[:20])
        print(json.dumps(result,ensure_ascii=False,separators=(',',':')))
        return 0 if result['state']=='PASS' else 3
    finally:
        if created and SAFE_DRILL.fullmatch(drill):
            run(['/usr/bin/mariadb','--protocol=socket','--batch','--skip-column-names','-e',f'DROP DATABASE IF EXISTS {qid(drill)}'],check=False)
        try: os.unlink(dump_name)
        except FileNotFoundError: pass
        # Emit cleanup proof on stderr so machine-readable stdout stays one JSON object.
        remaining=scalar(f"SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name={json.dumps(drill)}")
        print(f'RESTORE_DRILL_CLEANUP_DB={"PASS" if remaining=="0" else "FAIL"}',file=os.sys.stderr)
        print(f'RESTORE_DRILL_CLEANUP_DUMP={"PASS" if not os.path.exists(dump_name) else "FAIL"}',file=os.sys.stderr)

if __name__=='__main__':
    raise SystemExit(main())
