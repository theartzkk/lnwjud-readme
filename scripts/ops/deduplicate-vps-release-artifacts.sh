#!/bin/sh
set -eu
LC_ALL=C
export LC_ALL

MODE=preview
APPROVED=0
TARGET=${AWH_DEPLOY_TARGET:-awh-ready}
KEEP_RECENT=${AWH_RELEASE_KEEP_RECENT:-3}
for arg in "$@"; do
  case "$arg" in
    --preview) MODE=preview ;;
    --apply) MODE=apply ;;
    --approve) APPROVED=1 ;;
    *) echo "Usage: $0 [--preview] | --apply --approve" >&2; exit 2 ;;
  esac
done
if test "$MODE" = apply && test "$APPROVED" -ne 1; then echo "--apply requires --approve" >&2; exit 2; fi
case "$TARGET" in ''|*[!A-Za-z0-9._-]*) echo "AWH_DEPLOY_TARGET is invalid" >&2; exit 2 ;; esac
case "$KEEP_RECENT" in ''|*[!0-9]*) echo "AWH_RELEASE_KEEP_RECENT must be an integer" >&2; exit 2 ;; esac
if test "$KEEP_RECENT" -lt 1 || test "$KEEP_RECENT" -gt 12; then echo "AWH_RELEASE_KEEP_RECENT must be 1..12" >&2; exit 2; fi

ssh -o BatchMode=yes -o StrictHostKeyChecking=yes "$TARGET" "AWH_DEDUP_MODE=$MODE AWH_RELEASE_KEEP_RECENT=$KEEP_RECENT python3 -" <<'PY'
import json, os, re, sqlite3, stat, subprocess, tempfile, time
from pathlib import Path

CONTROL=Path('/opt/awh-hub/control-releases')
WEB=Path('/var/www/awh-web/releases')
STORE=Path('/var/www/awh-web/desktop-artifacts')
DB='/var/lib/awh-hub/awh.sqlite'
MODE=os.environ.get('AWH_DEDUP_MODE','preview')
KEEP_RECENT=max(1,min(12,int(os.environ.get('AWH_RELEASE_KEEP_RECENT','3'))))
NAME=re.compile(r'^m[0-9]+-[A-Za-z0-9._-]{6,72}$')
DIGEST=re.compile(r'^[0-9a-f]{64}$')
ARTIFACTS=('AWH-macOS-x64.zip','AWH-Windows-x64.zip','SHA256SUMS.txt')

def pointer(path):
    try:
        name=os.path.basename(os.readlink(path)); return name if NAME.fullmatch(name) else None
    except OSError: return None

def release_rows(root):
    out=[]
    try: entries=list(os.scandir(root))
    except OSError: return out
    for e in entries:
        if not NAME.fullmatch(e.name) or e.is_symlink() or not e.is_dir(follow_symlinks=False): continue
        try: mt=e.stat(follow_symlinks=False).st_mtime
        except OSError: mt=0
        out.append((e.name,mt))
    out.sort(key=lambda x:(x[1],x[0]),reverse=True); return out

def fs_refs(parent,root):
    refs=set(); root_real=os.path.realpath(root)
    try:
        for e in os.scandir(parent):
            if not e.is_symlink(): continue
            target=os.path.realpath(e.path)
            if os.path.dirname(target)==root_real and NAME.fullmatch(os.path.basename(target)): refs.add(os.path.basename(target))
    except OSError: pass
    return refs

def db_refs():
    refs=set()
    try:
        db=sqlite3.connect(f'file:{DB}?mode=ro',uri=True,timeout=2)
        cols={r[1] for r in db.execute('PRAGMA table_info(control_managed_sites)')}
        if {'current_release_id','rollback_release_id'}<=cols:
            for a,b in db.execute('SELECT current_release_id,rollback_release_id FROM control_managed_sites'):
                for v in (a,b):
                    if isinstance(v,str) and NAME.fullmatch(v): refs.add(v)
        db.close()
    except Exception: pass
    return refs

def manifest_entries(release):
    path=CONTROL/release/'dist-web'/'release.json'
    try: data=json.load(open(path,'r',encoding='utf-8'))
    except Exception: return {}
    out={}
    for item in data.get('files',[]):
        if not isinstance(item,dict): continue
        p=item.get('path'); h=str(item.get('sha256','')).lower(); s=item.get('sizeBytes')
        if isinstance(p,str) and p.startswith('downloads/') and p.split('/')[-1] in ARTIFACTS and DIGEST.fullmatch(h) and isinstance(s,int) and s>=0:
            out[p.split('/')[-1]]=(h,s)
    return out

def sha256(path):
    proc=subprocess.run(['/usr/bin/sha256sum','--',str(path)],capture_output=True,text=True,timeout=120,check=True)
    value=proc.stdout.split()[0].lower()
    if not DIGEST.fullmatch(value): raise RuntimeError('HASH_INVALID')
    return value

control=release_rows(CONTROL); web=release_rows(WEB)
current=pointer('/opt/awh-hub/control-plane-current'); current_web=pointer('/var/www/awh-web/current')
rollback=None
if current:
    try: major=int(current.split('-',1)[0][1:])
    except Exception: major=-1
    for rid,_ in control:
        if rid==current: continue
        try: m=int(rid.split('-',1)[0][1:])
        except Exception: continue
        if m<=major: rollback=rid; break
recent={r for r,_ in control[:KEEP_RECENT]}|{r for r,_ in web[:KEEP_RECENT]}
protected={v for v in (current,current_web,rollback) if v}|recent|db_refs()|fs_refs('/opt/awh-hub',CONTROL)|fs_refs('/var/www/awh-web',WEB)

items=[]; candidate_bytes=0; applied_bytes=0; changed=0; blocked=0
for rid,_ in control:
    if rid in protected: continue
    entries=manifest_entries(rid)
    for name,(digest,size) in entries.items():
        file=CONTROL/rid/'dist-web'/'downloads'/name
        obj=STORE/f'{digest}-{name}'
        try:
            fst=os.lstat(file); ost=os.lstat(obj)
        except OSError:
            blocked+=1; items.append({'releaseId':rid,'name':name,'state':'BLOCKED_MISSING'}); continue
        if not stat.S_ISREG(fst.st_mode) or not stat.S_ISREG(ost.st_mode) or os.path.islink(file) or os.path.islink(obj):
            blocked+=1; items.append({'releaseId':rid,'name':name,'state':'BLOCKED_TYPE'}); continue
        if fst.st_size!=size or ost.st_size!=size or fst.st_dev!=ost.st_dev:
            blocked+=1; items.append({'releaseId':rid,'name':name,'state':'BLOCKED_METADATA'}); continue
        if fst.st_ino==ost.st_ino:
            items.append({'releaseId':rid,'name':name,'state':'ALREADY_DEDUPED','sizeBytes':size}); continue
        try:
            if sha256(file)!=digest or sha256(obj)!=digest:
                blocked+=1; items.append({'releaseId':rid,'name':name,'state':'BLOCKED_HASH'}); continue
        except Exception:
            blocked+=1; items.append({'releaseId':rid,'name':name,'state':'BLOCKED_HASH'}); continue
        allocated=max(0,int(fst.st_blocks))*512
        candidate_bytes+=allocated
        if MODE=='preview':
            items.append({'releaseId':rid,'name':name,'state':'READY','sizeBytes':size,'reclaimableAllocatedBytes':allocated}); continue
        parent=file.parent
        temp=parent/f'.{name}.awh-dedup-{os.getpid()}'
        try:
            if temp.exists() or temp.is_symlink(): raise RuntimeError('TEMP_EXISTS')
            os.link(obj,temp)
            tst=os.lstat(temp)
            if tst.st_ino!=ost.st_ino or tst.st_dev!=ost.st_dev or tst.st_size!=size or sha256(temp)!=digest: raise RuntimeError('TEMP_VERIFY_FAILED')
            os.replace(temp,file)
            final=os.lstat(file)
            if final.st_ino!=ost.st_ino or final.st_dev!=ost.st_dev or final.st_size!=size or sha256(file)!=digest: raise RuntimeError('FINAL_VERIFY_FAILED')
            changed+=1; applied_bytes+=allocated
            items.append({'releaseId':rid,'name':name,'state':'DEDUPED','sizeBytes':size,'reclaimedAllocatedBytes':allocated})
        except Exception:
            blocked+=1
            try:
                if temp.exists() and not temp.is_symlink(): temp.unlink()
            except OSError: pass
            items.append({'releaseId':rid,'name':name,'state':'BLOCKED_APPLY'})

v=os.statvfs('/'); total=v.f_blocks*v.f_frsize; free=v.f_bfree*v.f_frsize; used=max(0,total-free)
print(json.dumps({
 'schemaVersion':1,'generatedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'mode':MODE,
 'pointers':{'control':current,'web':current_web,'rollback':rollback,'match':bool(current and current==current_web)},
 'protectedReleaseIds':sorted(protected),'candidateReclaimableAllocatedBytes':candidate_bytes,'changedFiles':changed,'appliedAllocatedBytes':applied_bytes,'blockedFiles':blocked,
 'disk':{'totalBytes':total,'usedBytes':used,'usedPercent':round(used/total*100,1) if total else None},
 'items':items,
 'safety':{'releaseDirectoriesDeleted':False,'databaseReadOnly':True,'manifestHashRequired':True,'objectHashRequired':True,'sameFilesystemRequired':True,'atomicReplace':True,'activeProtected':True,'rollbackProtected':True,'referenceProtected':True}
},ensure_ascii=False,separators=(',',':')))
PY
