#!/bin/sh
set -eu
LC_ALL=C
export LC_ALL

TARGET=${AWH_DEPLOY_TARGET:-awh-ready}
KEEP_RECENT=${AWH_RELEASE_KEEP_RECENT:-3}
case "$TARGET" in ''|*[!A-Za-z0-9._-]*) echo "AWH_DEPLOY_TARGET is invalid" >&2; exit 2 ;; esac
case "$KEEP_RECENT" in ''|*[!0-9]*) echo "AWH_RELEASE_KEEP_RECENT must be an integer" >&2; exit 2 ;; esac
if test "$KEEP_RECENT" -lt 1 || test "$KEEP_RECENT" -gt 12; then echo "AWH_RELEASE_KEEP_RECENT must be 1..12" >&2; exit 2; fi

ssh -o BatchMode=yes -o StrictHostKeyChecking=yes "$TARGET" "AWH_RELEASE_KEEP_RECENT=$KEEP_RECENT python3 -" <<'PY'
import json, os, re, sqlite3, subprocess, time
from pathlib import Path

CONTROL = Path('/opt/awh-hub/control-releases')
WEB = Path('/var/www/awh-web/releases')
CONTROL_PTR = Path('/opt/awh-hub/control-plane-current')
WEB_PTR = Path('/var/www/awh-web/current')
DB = '/var/lib/awh-hub/awh.sqlite'
KEEP_RECENT = max(1, min(12, int(os.environ.get('AWH_RELEASE_KEEP_RECENT', '3'))))
NAME = re.compile(r'^m[0-9]+-[A-Za-z0-9._-]{6,72}$')

def pointer_name(path):
    try:
        target = os.readlink(path)
        name = os.path.basename(target)
        return name if NAME.fullmatch(name) else None
    except OSError:
        return None

def releases(root):
    rows=[]
    try:
        entries=list(os.scandir(root))
    except OSError:
        return rows
    for entry in entries:
        if not NAME.fullmatch(entry.name) or entry.is_symlink() or not entry.is_dir(follow_symlinks=False):
            continue
        try: mtime=entry.stat(follow_symlinks=False).st_mtime
        except OSError: mtime=0
        rows.append({'id':entry.name,'mtime':mtime,'root':str(root)})
    rows.sort(key=lambda x:(x['mtime'],x['id']), reverse=True)
    return rows

def exact_bytes(path):
    try:
        out=subprocess.check_output(['/usr/bin/du','-sb','--',str(path)], stderr=subprocess.DEVNULL, text=True, timeout=45)
        return int(out.split()[0])
    except Exception:
        return None

def db_references():
    refs=set()
    if not os.path.isfile(DB) or os.path.islink(DB): return refs
    try:
        db=sqlite3.connect(f'file:{DB}?mode=ro', uri=True, timeout=2)
        cols={r[1] for r in db.execute('PRAGMA table_info(control_managed_sites)')}
        if {'current_release_id','rollback_release_id'} <= cols:
            for current, rollback in db.execute('SELECT current_release_id,rollback_release_id FROM control_managed_sites'):
                for value in (current,rollback):
                    if isinstance(value,str) and NAME.fullmatch(value): refs.add(value)
        db.close()
    except Exception:
        pass
    return refs

control=releases(CONTROL); web=releases(WEB)
current_control=pointer_name(CONTROL_PTR); current_web=pointer_name(WEB_PTR)
by_id={r['id']:r for r in control}
rollback=None
if current_control and current_control in by_id:
    current_major=int(current_control.split('-',1)[0][1:])
    for row in control:
        if row['id']==current_control: continue
        try: major=int(row['id'].split('-',1)[0][1:])
        except Exception: continue
        if major <= current_major:
            rollback=row['id']; break

refs=db_references()
recent={r['id'] for r in control[:KEEP_RECENT]} | {r['id'] for r in web[:KEEP_RECENT]}
protected={x for x in (current_control,current_web,rollback) if x} | refs | recent
all_ids=sorted({r['id'] for r in control}|{r['id'] for r in web})
rows=[]; reclaimable=0; unknown=0
for rid in all_ids:
    control_path=CONTROL/rid; web_path=WEB/rid
    c_exists=control_path.is_dir() and not control_path.is_symlink()
    w_exists=web_path.is_dir() and not web_path.is_symlink()
    c_size=exact_bytes(control_path) if c_exists else 0
    w_size=exact_bytes(web_path) if w_exists else 0
    known=isinstance(c_size,int) and isinstance(w_size,int)
    total=(c_size or 0)+(w_size or 0)
    if rid==current_control or rid==current_web: state='ACTIVE'
    elif rid==rollback: state='ROLLBACK'
    elif rid in refs: state='DB_REFERENCED'
    elif rid in recent: state='KEEP_RECENT'
    else: state='CANDIDATE_REVIEW'
    if state=='CANDIDATE_REVIEW':
        if known: reclaimable+=total
        else: unknown+=1
    rows.append({'releaseId':rid,'state':state,'control':c_exists,'web':w_exists,'sizeBytes':total if known else None})

stat=os.statvfs('/')
total=stat.f_blocks*stat.f_frsize; free=stat.f_bavail*stat.f_frsize; used=max(0,total-free)
result={
 'schemaVersion':1,'generatedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'mode':'AUDIT_ONLY',
 'policy':{'keepRecentPerRoot':KEEP_RECENT,'candidateAction':'REVIEW_ONLY','purgeEnabled':False,'unknownRetained':True},
 'pointers':{'control':current_control,'web':current_web,'match':bool(current_control and current_control==current_web),'rollback':rollback},
 'databaseReferences':sorted(refs),
 'inventory':{'controlReleases':len(control),'webReleases':len(web),'candidateReleases':sum(r['state']=='CANDIDATE_REVIEW' for r in rows),'unknownCandidateSizes':unknown},
 'disk':{'totalBytes':total,'usedBytes':used,'freeBytes':free,'usedPercent':round(used/total*100,1) if total else None},
 'candidateReclaimableBytes':reclaimable,
 'projectedUsedPercentAfterCandidateRemoval':round(max(0,used-reclaimable)/total*100,1) if total else None,
 'releases':rows,
 'safety':{'mutated':False,'databaseReadOnly':True,'symlinksNotFollowed':True,'activeProtected':True,'rollbackProtected':True,'dbReferencesProtected':True}
}
print(json.dumps(result, ensure_ascii=False, separators=(',',':')))
PY
