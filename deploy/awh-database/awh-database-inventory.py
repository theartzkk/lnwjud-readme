#!/usr/bin/env python3
import json, os, sqlite3, subprocess, tempfile
from datetime import datetime, timezone
from pathlib import Path

OUT=Path(os.environ.get('AWH_DATABASE_FLEET_SNAPSHOT','/var/lib/awh-hub/database-fleet.json'))
AWH_DB=Path(os.environ.get('AWH_HUB_DB_PATH','/var/lib/awh-hub/awh.sqlite'))
SYSTEM={'information_schema','mysql','performance_schema','sys'}
PROOF_MARKERS=('proof','authority_force','projection')

def mariadb_rows():
    query=("SELECT table_schema,COUNT(*),COALESCE(SUM(data_length+index_length),0) "
           "FROM information_schema.tables GROUP BY table_schema ORDER BY table_schema")
    proc=subprocess.run(['/usr/bin/mariadb','--protocol=socket','--batch','--skip-column-names','-e',query],
                        capture_output=True,text=True,timeout=20,check=False,env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin'})
    if proc.returncode != 0: return [], 'UNAVAILABLE'
    rows=[]
    for line in proc.stdout.splitlines():
        parts=line.split('\t')
        if len(parts)!=3 or parts[0] in SYSTEM: continue
        name=parts[0]
        if not name or len(name)>128 or any(not(c.isalnum() or c in '_.-') for c in name): continue
        authority='PROOF' if any(x in name.lower() for x in PROOF_MARKERS) else ('STAGING' if 'staging' in name.lower() else 'UNCLASSIFIED')
        rows.append({'id':'mariadb:'+name,'name':name,'label':name,'engine':'MARIADB','state':'HEALTHY',
                     'sizeBytes':max(0,int(parts[2] or 0)),'tableCount':max(0,int(parts[1] or 0)),
                     'authority':authority,'readOnly':True})
    return rows, 'READY'

def sqlite_row():
    if not AWH_DB.is_file() or AWH_DB.is_symlink(): return None
    try:
        uri='file:'+str(AWH_DB)+'?mode=ro'
        db=sqlite3.connect(uri,uri=True,timeout=3)
        quick=db.execute('PRAGMA quick_check').fetchone()[0]
        count=db.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").fetchone()[0]
        db.close()
        return {'id':'sqlite:awh','name':'awh.sqlite','label':'AWH Control Plane','engine':'SQLITE',
                'state':'HEALTHY' if quick=='ok' else 'REVIEW','sizeBytes':AWH_DB.stat().st_size,
                'tableCount':int(count),'authority':'CONTROL','readOnly':True}
    except Exception:
        return {'id':'sqlite:awh','name':'awh.sqlite','label':'AWH Control Plane','engine':'SQLITE',
                'state':'REVIEW','sizeBytes':AWH_DB.stat().st_size if AWH_DB.exists() else 0,
                'tableCount':0,'authority':'CONTROL','readOnly':True}

def main():
    rows,state=mariadb_rows()
    awh=sqlite_row()
    if awh: rows.insert(0,awh)
    payload={'schemaVersion':1,'generatedAt':datetime.now(timezone.utc).isoformat(),'state':state,'databases':rows}
    OUT.parent.mkdir(parents=True,exist_ok=True)
    fd,tmp=tempfile.mkstemp(prefix=OUT.name+'.',dir=str(OUT.parent))
    try:
        with os.fdopen(fd,'w',encoding='utf-8') as f: json.dump(payload,f,ensure_ascii=False,separators=(',',':')); f.write('\n')
        os.chmod(tmp,0o640)
        try:
            import grp
            os.chown(tmp,0,grp.getgrnam('awh-hub').gr_gid)
        except Exception: pass
        os.replace(tmp,OUT)
    finally:
        if os.path.exists(tmp): os.unlink(tmp)
    print(json.dumps({'state':state,'databaseCount':len(rows),'output':str(OUT)},separators=(',',':')))
if __name__=='__main__': main()
