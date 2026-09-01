#!/bin/sh
set -eu
LC_ALL=C
export LC_ALL

TARGET=${AWH_DEPLOY_TARGET:-awh-ready}
KEEP_RECENT=${AWH_RELEASE_KEEP_RECENT:-3}
MAX_FILES=${AWH_RELEASE_AUDIT_MAX_FILES:-400000}
case "$TARGET" in ''|*[!A-Za-z0-9._-]*) echo "AWH_DEPLOY_TARGET is invalid" >&2; exit 2 ;; esac
case "$KEEP_RECENT" in ''|*[!0-9]*) echo "AWH_RELEASE_KEEP_RECENT must be an integer" >&2; exit 2 ;; esac
case "$MAX_FILES" in ''|*[!0-9]*) echo "AWH_RELEASE_AUDIT_MAX_FILES must be an integer" >&2; exit 2 ;; esac
if test "$KEEP_RECENT" -lt 1 || test "$KEEP_RECENT" -gt 12; then echo "AWH_RELEASE_KEEP_RECENT must be 1..12" >&2; exit 2; fi
if test "$MAX_FILES" -lt 10000 || test "$MAX_FILES" -gt 2000000; then echo "AWH_RELEASE_AUDIT_MAX_FILES must be 10000..2000000" >&2; exit 2; fi

ssh -o BatchMode=yes -o StrictHostKeyChecking=yes "$TARGET" "AWH_RELEASE_KEEP_RECENT=$KEEP_RECENT AWH_RELEASE_AUDIT_MAX_FILES=$MAX_FILES python3 -" <<'PY'
import json, os, re, sqlite3, stat, time
from pathlib import Path

CONTROL = Path('/opt/awh-hub/control-releases')
WEB = Path('/var/www/awh-web/releases')
CONTROL_PTR = Path('/opt/awh-hub/control-plane-current')
WEB_PTR = Path('/var/www/awh-web/current')
DESKTOP_OBJECTS = Path('/var/www/awh-web/desktop-artifacts')
DB = '/var/lib/awh-hub/awh.sqlite'
KEEP_RECENT = max(1, min(12, int(os.environ.get('AWH_RELEASE_KEEP_RECENT', '3'))))
MAX_FILES = max(10000, min(2000000, int(os.environ.get('AWH_RELEASE_AUDIT_MAX_FILES', '400000'))))
NAME = re.compile(r'^m[0-9]+-[A-Za-z0-9._-]{6,72}$')


def pointer_name(path):
    try:
        name = os.path.basename(os.readlink(path))
        return name if NAME.fullmatch(name) else None
    except OSError:
        return None


def releases(root):
    rows=[]
    try: entries=list(os.scandir(root))
    except OSError: return rows
    for entry in entries:
        if not NAME.fullmatch(entry.name) or entry.is_symlink() or not entry.is_dir(follow_symlinks=False): continue
        try: mtime=entry.stat(follow_symlinks=False).st_mtime
        except OSError: mtime=0
        rows.append({'id':entry.name,'mtime':mtime})
    rows.sort(key=lambda x:(x['mtime'],x['id']), reverse=True)
    return rows


def filesystem_release_references(parent, release_root):
    refs=set()
    try:
        root_real=os.path.realpath(release_root)
        for entry in os.scandir(parent):
            if not entry.is_symlink(): continue
            target=os.path.realpath(entry.path)
            if os.path.dirname(target) != root_real: continue
            name=os.path.basename(target)
            if NAME.fullmatch(name): refs.add(name)
    except OSError:
        pass
    return refs


def db_references():
    refs=set()
    if not os.path.isfile(DB) or os.path.islink(DB): return refs
    try:
        db=sqlite3.connect(f'file:{DB}?mode=ro', uri=True, timeout=2)
        cols={r[1] for r in db.execute('PRAGMA table_info(control_managed_sites)')}
        if {'current_release_id','rollback_release_id'} <= cols:
            for current, rollback in db.execute('SELECT current_release_id,rollback_release_id FROM control_managed_sites'):
                for value in (current, rollback):
                    if isinstance(value,str) and NAME.fullmatch(value): refs.add(value)
        db.close()
    except Exception:
        pass
    return refs


control=releases(CONTROL); web=releases(WEB)
current_control=pointer_name(CONTROL_PTR); current_web=pointer_name(WEB_PTR)
rollback=None
if current_control:
    try: current_major=int(current_control.split('-',1)[0][1:])
    except Exception: current_major=-1
    for row in control:
        if row['id']==current_control: continue
        try: major=int(row['id'].split('-',1)[0][1:])
        except Exception: continue
        if major <= current_major:
            rollback=row['id']; break

refs=db_references()
fs_refs=filesystem_release_references('/opt/awh-hub', CONTROL) | filesystem_release_references('/var/www/awh-web', WEB)
recent={r['id'] for r in control[:KEEP_RECENT]} | {r['id'] for r in web[:KEEP_RECENT]}
all_ids=sorted({r['id'] for r in control}|{r['id'] for r in web})

states={}
for rid in all_ids:
    if rid==current_control or rid==current_web: state_name='ACTIVE'
    elif rid==rollback: state_name='ROLLBACK'
    elif rid in refs: state_name='DB_REFERENCED'
    elif rid in fs_refs: state_name='SYMLINK_REFERENCED'
    elif rid in recent: state_name='KEEP_RECENT'
    else: state_name='CANDIDATE_REVIEW'
    states[rid]=state_name

# Count actual allocated blocks by inode. A candidate inode is reclaimable only
# when every observed hard-link belongs to candidate releases and st_nlink proves
# there is no unobserved link elsewhere. This prevents the old logical-size
# overcount from shared Desktop/release payloads.
inodes={}; release_apparent={rid:0 for rid in all_ids}; observed_files=0; bounded=False

def observe_tree(root, owner):
    global observed_files, bounded
    if bounded or not root.is_dir() or root.is_symlink(): return
    for base, dirs, files in os.walk(root, topdown=True, followlinks=False):
        dirs[:] = [d for d in dirs if not os.path.islink(os.path.join(base,d))]
        for name in files:
            if observed_files >= MAX_FILES:
                bounded=True; return
            path=os.path.join(base,name)
            try: st=os.lstat(path)
            except OSError: continue
            if not stat.S_ISREG(st.st_mode): continue
            observed_files += 1
            if owner in release_apparent: release_apparent[owner] += max(0,int(st.st_size))
            key=(int(st.st_dev),int(st.st_ino))
            rec=inodes.setdefault(key,{'allocated':max(0,int(st.st_blocks))*512,'nlink':max(1,int(st.st_nlink)),'refs':0,'owners':set()})
            rec['refs'] += 1; rec['owners'].add(owner)

for rid in all_ids:
    observe_tree(CONTROL/rid, rid)
    observe_tree(WEB/rid, rid)
    if bounded: break
observe_tree(DESKTOP_OBJECTS, '__PROTECTED_DESKTOP_OBJECT_STORE__')

reclaimable=None; shared_protected=0; unobserved_links=0
if not bounded:
    reclaimable=0
    for rec in inodes.values():
        owners=rec['owners']; all_candidate=bool(owners) and all(states.get(owner)=='CANDIDATE_REVIEW' for owner in owners)
        all_links_observed=rec['refs'] >= rec['nlink']
        if all_candidate and all_links_observed:
            reclaimable += rec['allocated']
        elif any(states.get(owner)=='CANDIDATE_REVIEW' for owner in owners):
            shared_protected += rec['allocated']
            if not all_links_observed: unobserved_links += 1

rows=[]
for rid in all_ids:
    rows.append({'releaseId':rid,'state':states[rid],'control':(CONTROL/rid).is_dir() and not (CONTROL/rid).is_symlink(),'web':(WEB/rid).is_dir() and not (WEB/rid).is_symlink(),'apparentBytes':release_apparent.get(rid,0) if not bounded else None})

v=os.statvfs('/')
total=v.f_blocks*v.f_frsize
free=v.f_bfree*v.f_frsize
available=v.f_bavail*v.f_frsize
used=max(0,total-free)
projected=None if reclaimable is None or total<=0 else round(max(0,used-reclaimable)/total*100,1)
result={
 'schemaVersion':2,'generatedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'mode':'AUDIT_ONLY',
 'policy':{'keepRecentPerRoot':KEEP_RECENT,'candidateAction':'REVIEW_ONLY','purgeEnabled':False,'unknownRetained':True,'reclaimAccounting':'UNIQUE_ALLOCATED_INODES_WITH_ALL_LINKS_OBSERVED'},
 'pointers':{'control':current_control,'web':current_web,'match':bool(current_control and current_control==current_web),'rollback':rollback},
 'databaseReferences':sorted(refs),'filesystemReferences':sorted(fs_refs),
 'inventory':{'controlReleases':len(control),'webReleases':len(web),'candidateReleases':sum(v=='CANDIDATE_REVIEW' for v in states.values()),'observedRegularFiles':observed_files,'scanBounded':bounded,'maxObservedFiles':MAX_FILES},
 'disk':{'totalBytes':total,'usedBytes':used,'freeBytes':free,'availableBytes':available,'usedPercent':round(used/total*100,1) if total else None},
 'candidateReclaimableBytes':reclaimable,
 'candidateSharedProtectedBytesObserved':shared_protected if not bounded else None,
 'candidateInodesWithUnobservedLinks':unobserved_links if not bounded else None,
 'projectedUsedPercentAfterCandidateRemoval':projected,
 'releases':rows,
 'safety':{'mutated':False,'databaseReadOnly':True,'symlinksNotFollowed':True,'activeProtected':True,'rollbackProtected':True,'dbReferencesProtected':True,'filesystemReferencesProtected':True,'boundedScanNeverClaimsReclaimable':True}
}
print(json.dumps(result,ensure_ascii=False,separators=(',',':')))
PY
