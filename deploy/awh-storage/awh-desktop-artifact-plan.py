#!/usr/bin/env python3
import hashlib, json, os, re, sys, time
from pathlib import Path

STORE=Path('/var/www/awh-web/desktop-artifacts')
WEB=Path('/var/www/awh-web/releases')
CTL=Path('/opt/awh-hub/control-releases')
NAME=re.compile(r'^([0-9a-f]{64})-(AWH-(?:macOS|Windows)-x64\.zip|SHA256SUMS\.txt)$')
MIN_AGE_DAYS=14

def fail(msg): raise SystemExit('ARTIFACT_PLAN_ABORT: '+msg)
def actual_size(p):
    try: return p.stat().st_size
    except OSError: return 0

if not STORE.is_dir() or STORE.is_symlink(): fail('store missing')
for root in (WEB,CTL):
    if not root.is_dir() or root.is_symlink(): fail('release root missing '+str(root))

# release.json is the authoritative promise for rehydration even when a release
# currently lacks the hard-linked download object.
manifest_refs=set()
manifest_files=0
for root in (WEB,CTL):
    for manifest in root.glob('*/release.json'):
        if not manifest.is_file() or manifest.is_symlink(): continue
        try:
            data=json.loads(manifest.read_text(errors='strict'))
        except Exception:
            continue
        manifest_files+=1
        for row in data.get('files',[]):
            if not isinstance(row,dict): continue
            path=row.get('path'); digest=str(row.get('sha256') or '').lower()
            if path in ('downloads/AWH-macOS-x64.zip','downloads/AWH-Windows-x64.zip','downloads/SHA256SUMS.txt') and re.fullmatch(r'[0-9a-f]{64}',digest):
                manifest_refs.add((digest,Path(path).name))

now=time.time(); rows=[]
for p in sorted(STORE.iterdir(),key=lambda x:x.name):
    if not p.is_file() or p.is_symlink(): continue
    m=NAME.fullmatch(p.name)
    if not m: continue
    digest,name=m.groups(); st=p.stat(); age_days=max(0,(now-st.st_mtime)/86400)
    ref=(digest,name) in manifest_refs
    linked=st.st_nlink>1
    status='REFERENCED' if (ref or linked) else 'ORPHAN'
    reclaimable=status=='ORPHAN' and age_days>=MIN_AGE_DAYS
    rows.append({'name':name,'digest':digest,'bytes':st.st_size,'links':st.st_nlink,'ageDays':round(age_days,1),'manifestReferenced':ref,'state':status,'reclaimable':reclaimable})

summary={
 'schemaVersion':1,'mode':'PLAN','manifestFilesScanned':manifest_files,'objects':len(rows),
 'referencedObjects':sum(r['state']=='REFERENCED' for r in rows),'orphanObjects':sum(r['state']=='ORPHAN' for r in rows),
 'reclaimableObjects':sum(r['reclaimable'] for r in rows),'logicalBytes':sum(r['bytes'] for r in rows),
 'orphanBytes':sum(r['bytes'] for r in rows if r['state']=='ORPHAN'),
 'reclaimableBytes':sum(r['bytes'] for r in rows if r['reclaimable']),
 'minimumAgeDays':MIN_AGE_DAYS,
 'candidates':[{'name':r['name'],'digest':r['digest'],'bytes':r['bytes'],'ageDays':r['ageDays']} for r in rows if r['reclaimable']]
}
print(json.dumps(summary,ensure_ascii=False,separators=(',',':')))
