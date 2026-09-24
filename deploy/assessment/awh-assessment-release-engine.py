#!/usr/bin/env python3
import argparse, datetime as dt, hashlib, json, os, re, shutil, subprocess, sys, tarfile, time, urllib.request
from pathlib import Path

def ep(name, default): return Path(os.environ.get(name, default))
CANON=ep('AWH_ASSESSMENT_CANONICAL_GIT','/srv/awh-git/bay-assessment.git')
LEGACY=ep('AWH_ASSESSMENT_LEGACY_GIT','/home/bayadmin/.awh/source/git/bay-assessment.git')
HANDOFF=ep('AWH_ASSESSMENT_HANDOFF','/var/lib/awh-remote/handoff/bay-assessment-0.3.0-rc.16-crud-20260923')
PROD=ep('AWH_ASSESSMENT_PROD_ROOT','/var/www/bay-assessment')
STAGE=ep('AWH_ASSESSMENT_STAGE_ROOT','/var/www/bay-assessment-staging')
PROD_STATE=ep('AWH_ASSESSMENT_PROD_STATE','/var/lib/bay-assessment')
STAGE_STATE=ep('AWH_ASSESSMENT_STAGE_STATE','/var/lib/bay-assessment-staging')
BACKUPS=ep('AWH_ASSESSMENT_BACKUP_ROOT','/var/backups/bay-assessment')
WORK=ep('AWH_ASSESSMENT_WORK_ROOT','/var/lib/awh-hub/assessment-release-work')
MANIFEST=ep('AWH_ASSESSMENT_CANDIDATE_MANIFEST','/var/lib/awh-hub/assessment-release-candidate.json')
PROD_URL=os.environ.get('AWH_ASSESSMENT_PROD_URL','https://assessment.kruart.online')
STAGE_URL=os.environ.get('AWH_ASSESSMENT_STAGE_URL','https://assessment-staging.kruart.online')
COMMIT_DATE='2026-09-23T12:00:00+00:00'
COMMIT_MESSAGE='Release BAY Assessment 0.3.0-rc.16: safe edit/delete lifecycle controls'
SHA40=re.compile(r'^[0-9a-f]{40}$'); SHA64=re.compile(r'^[0-9a-f]{64}$')
VER=re.compile(r'^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?$')

class ReleaseError(RuntimeError):
    def __init__(self,code,detail=''): self.code=code; self.detail=detail; super().__init__(code+(' '+detail if detail else ''))

def run(args,cwd=None,env=None,timeout=180,check=True):
    p=subprocess.run(args,cwd=cwd,env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=timeout)
    if check and p.returncode: raise ReleaseError('ASSESSMENT_RELEASE_COMMAND_FAILED',(p.stdout or '')[-900:])
    return p

def read_json(path):
    try: return json.loads(path.read_text())
    except Exception as e: raise ReleaseError('ASSESSMENT_RELEASE_JSON_INVALID',str(path)) from e

def sha256(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''): h.update(b)
    return h.hexdigest()

def share_with_parent_group(path):
    if path.is_symlink(): raise ReleaseError('ASSESSMENT_RELEASE_MANIFEST_PERMISSION_FAILED',str(path))
    parent=path.parent.stat(); current=path.stat()
    if current.st_gid!=parent.st_gid: os.chown(path,-1,parent.st_gid)
    if (path.stat().st_mode & 0o777)!=0o640: os.chmod(path,0o640)

def atomic_json(path,obj,share_parent_group=False):
    path.parent.mkdir(parents=True,exist_ok=True)
    raw=(json.dumps(obj,ensure_ascii=False,sort_keys=True,separators=(',',':'))+'\n').encode()
    tmp=path.with_name('.'+path.name+'.tmp-'+str(os.getpid())); tmp.write_bytes(raw); os.chmod(tmp,0o640)
    if share_parent_group: share_with_parent_group(tmp)
    os.replace(tmp,path)
    return hashlib.sha256(raw).hexdigest()

def current_link(root):
    link=root/'current'
    if not link.is_symlink(): raise ReleaseError('ASSESSMENT_RELEASE_POINTER_INVALID',str(link))
    real=link.resolve()
    if not real.is_dir() or root.resolve() not in real.parents: raise ReleaseError('ASSESSMENT_RELEASE_POINTER_INVALID',str(real))
    return real

def package_version(root):
    v=read_json(root/'package.json').get('version','')
    if not isinstance(v,str) or not VER.match(v): raise ReleaseError('ASSESSMENT_RELEASE_VERSION_INVALID',str(root))
    return v

def handoff_meta():
    sums={}
    for line in (HANDOFF/'SHA256SUMS').read_text().splitlines():
        m=re.match(r'^([0-9a-f]{64})\s+(.+)$',line.strip())
        if m:sums[m.group(2)]=m.group(1)
    for name in ['changes-from-prod-b4d3c26998a7.patch','candidate-source.tar.gz','candidate.json','owner-promote.sh']:
        p=HANDOFF/name
        if not p.is_file() or sums.get(name)!=sha256(p): raise ReleaseError('ASSESSMENT_RELEASE_HANDOFF_INVALID',name)
    meta=read_json(HANDOFF/'candidate.json'); tests=meta.get('tests') or {}
    if meta.get('schemaVersion')!=1 or meta.get('product')!='BAY Assessment' or meta.get('schemaCheck')!='PASS' or meta.get('integrity')!='ok' or tests.get('passed')!=36 or tests.get('failed')!=0:
        raise ReleaseError('ASSESSMENT_RELEASE_HANDOFF_QA_INVALID')
    return meta

def git_env():
    e=os.environ.copy()
    e.update({'GIT_AUTHOR_NAME':'AWH Agent','GIT_AUTHOR_EMAIL':'awh-agent@local','GIT_COMMITTER_NAME':'AWH Agent','GIT_COMMITTER_EMAIL':'awh-agent@local',
              'GIT_AUTHOR_DATE':COMMIT_DATE,'GIT_COMMITTER_DATE':COMMIT_DATE,'LC_ALL':'C','LANG':'C'})
    return e

def runtime_sha(prod,fallback=None):
    p=prod/'SOURCE_SHA'
    if p.is_file():
        v=p.read_text().strip().lower()
        if SHA40.match(v): return v
    m=re.search(r'-([0-9a-f]{12})$',prod.name)
    if fallback and SHA40.match(fallback) and m and fallback.startswith(m.group(1)): return fallback
    raise ReleaseError('ASSESSMENT_RELEASE_SOURCE_IDENTITY_UNAVAILABLE',prod.name)

def bootstrap_workspace(dest):
    meta=handoff_meta()
    if not LEGACY.is_dir(): raise ReleaseError('ASSESSMENT_RELEASE_LEGACY_SOURCE_MISSING')
    base=run(['/usr/bin/git','--git-dir='+str(LEGACY),'rev-parse','refs/heads/main']).stdout.strip().lower()
    if not SHA40.match(base) or not base.startswith(str(meta.get('expectedCanonicalMainPrefix','')).lower()): raise ReleaseError('ASSESSMENT_RELEASE_BASE_MOVED',base)
    shutil.rmtree(dest,ignore_errors=True)
    run(['/usr/bin/git','clone','--no-hardlinks',str(LEGACY),str(dest)],timeout=180)
    run(['/usr/bin/git','-C',str(dest),'checkout','--detach',base])
    patch=HANDOFF/'changes-from-prod-b4d3c26998a7.patch'
    run(['/usr/bin/git','-C',str(dest),'apply','--check',str(patch)]); run(['/usr/bin/git','-C',str(dest),'apply',str(patch)])
    version=package_version(dest)
    if version!=meta.get('candidateVersion'): raise ReleaseError('ASSESSMENT_RELEASE_VERSION_MISMATCH',version)
    run(['/usr/bin/git','-C',str(dest),'add','-A'])
    run(['/usr/bin/git','-C',str(dest),'commit','-m',COMMIT_MESSAGE],env=git_env())
    release=run(['/usr/bin/git','-C',str(dest),'rev-parse','HEAD']).stdout.strip().lower()
    if not SHA40.match(release): raise ReleaseError('ASSESSMENT_RELEASE_CANDIDATE_INVALID')
    return {'base':base,'release':release,'version':version,'mode':'LEGACY_MIGRATION'}

def canonical_candidate(dest=None):
    if not CANON.is_dir(): return None
    release=run(['/usr/bin/git','--git-dir='+str(CANON),'rev-parse','refs/heads/main']).stdout.strip().lower()
    raw=run(['/usr/bin/git','--git-dir='+str(CANON),'show',release+':package.json']).stdout
    try: version=json.loads(raw)['version']
    except Exception as e: raise ReleaseError('ASSESSMENT_RELEASE_CANONICAL_INVALID','package.json') from e
    if not SHA40.match(release) or not isinstance(version,str) or not VER.match(version): raise ReleaseError('ASSESSMENT_RELEASE_CANONICAL_INVALID')
    if dest is not None:
        shutil.rmtree(dest,ignore_errors=True); run(['/usr/bin/git','clone','--no-hardlinks',str(CANON),str(dest)],timeout=180); run(['/usr/bin/git','-C',str(dest),'checkout','--detach',release])
    return {'release':release,'version':version,'mode':'CANONICAL_GIT'}

def candidate():
    WORK.mkdir(parents=True,exist_ok=True); prod=current_link(PROD); current_ver=package_version(prod)
    info=canonical_candidate()
    if info:
        base=runtime_sha(prod); info['base']=base
    else:
        info=bootstrap_workspace(WORK/'candidate-preview'); base=runtime_sha(prod,info['base'])
        if base!=info['base']: raise ReleaseError('ASSESSMENT_RELEASE_BASE_MISMATCH')
    obj={'schemaVersion':1,'product':'BAY Assessment','ready':info['release']!=base,'releaseSha':info['release'],'baseReleaseSha':base,
         'runtimeVersion':info['version'],'currentRuntimeVersion':current_ver,'sourceMode':info['mode'],
         'qa':'36/36 PASS' if info['mode']=='LEGACY_MIGRATION' else 'CANONICAL_SOURCE_READY','observedAt':dt.datetime.now(dt.timezone.utc).isoformat()}
    if MANIFEST.is_file():
        try:
            old=json.loads(MANIFEST.read_text())
            keys=('releaseSha','baseReleaseSha','runtimeVersion','sourceMode','ready','qa')
            if all(old.get(k)==obj.get(k) for k in keys):
                share_with_parent_group(MANIFEST)
                return old,sha256(MANIFEST)
        except Exception: pass
    return obj,atomic_json(MANIFEST,obj,share_parent_group=True)

def copy_modules(src,dst):
    source=src/'node_modules'; target=dst/'node_modules'
    if not source.is_dir(): raise ReleaseError('ASSESSMENT_RELEASE_DEPENDENCIES_MISSING')
    shutil.rmtree(target,ignore_errors=True); run(['/bin/cp','-a',str(source),str(target)],timeout=240)

def qa(work,prod):
    copy_modules(prod,work)
    for f in ['src/server.mjs','src/submission-service.mjs','src/exam-service.mjs','src/question-service.mjs','src/curriculum-service.mjs',
              'src/blueprint-service.mjs','src/score-entry-service.mjs','public/assets/api.js','public/assets/app.js','tests/api-flow.test.mjs']:
        run(['/usr/bin/node','--check',str(work/f)],timeout=30)
    run(['/usr/bin/npm','run','check'],cwd=str(work),timeout=900)
    shutil.rmtree(work/'node_modules',ignore_errors=True)

def backup_state(state,label,execution):
    BACKUPS.mkdir(parents=True,exist_ok=True); out=BACKUPS/(dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+label+'-'+execution[:8]); out.mkdir(mode=0o700)
    dbs=list(state.glob('*.sqlite'))+list(state.glob('*.db'))
    if not dbs: raise ReleaseError('ASSESSMENT_RELEASE_DATABASE_MISSING',label)
    for db in dbs:
        if run(['/usr/bin/sqlite3',str(db),'PRAGMA quick_check;']).stdout.strip()!='ok': raise ReleaseError('ASSESSMENT_RELEASE_DATABASE_INVALID',str(db))
        dest=out/db.name; run(['/usr/bin/sqlite3',str(db),f".backup '{dest}'"],timeout=120)
        if run(['/usr/bin/sqlite3',str(dest),'PRAGMA quick_check;']).stdout.strip()!='ok': raise ReleaseError('ASSESSMENT_RELEASE_BACKUP_INVALID',str(dest))
    return out

def build_release(work,root,sha,version,prod):
    dest=root/'releases'/(dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+sha[:12])
    if dest.exists(): raise ReleaseError('ASSESSMENT_RELEASE_EXISTS',str(dest))
    dest.mkdir(parents=True); archive=WORK/('archive-'+sha[:12]+'.tar')
    with archive.open('wb') as out:
        p=subprocess.Popen(['/usr/bin/git','-C',str(work),'archive',sha],stdout=out)
        if p.wait(): raise ReleaseError('ASSESSMENT_RELEASE_ARCHIVE_FAILED')
    with tarfile.open(archive,'r') as t:
        root_real=dest.resolve()
        for m in t.getmembers():
            target=(dest/m.name).resolve()
            if target!=root_real and root_real not in target.parents: raise ReleaseError('ASSESSMENT_RELEASE_ARCHIVE_UNSAFE')
        t.extractall(dest)
    archive.unlink(missing_ok=True); copy_modules(prod,dest); (dest/'SOURCE_SHA').write_text(sha+'\n'); (dest/'VERSION').write_text(version+'\n')
    return dest

def switch(root,target):
    link=root/'current'; tmp=root/('.current-assessment-'+str(os.getpid())); tmp.unlink(missing_ok=True); tmp.symlink_to(target); os.replace(tmp,link)
    if link.resolve()!=target.resolve(): raise ReleaseError('ASSESSMENT_RELEASE_POINTER_FAILED',str(root))

def restart(service): run(['/bin/systemctl','restart',service],timeout=90)

def health(url):
    for _ in range(15):
        try:
            with urllib.request.urlopen(url+'/api/health',timeout=8) as r: data=json.loads(r.read().decode())
            if data.get('ok') is True and data.get('service')=='BAY Assessment': break
        except Exception: pass
        time.sleep(1)
    else: raise ReleaseError('ASSESSMENT_RELEASE_HEALTH_FAILED',url)
    with urllib.request.urlopen(url+'/assets/app.js',timeout=10) as r: app=r.read().decode(errors='ignore')
    for marker in ['data-campaign-delete','data-delete-assignment','data-delete-exam','data-delete-session','data-delete-score-batch']:
        if marker not in app: raise ReleaseError('ASSESSMENT_RELEASE_UI_MARKER_MISSING',marker)

def normalize_canonical_permissions():
    if not CANON.is_dir(): return
    run(['/bin/chown','-R','bayadmin:bayadmin',str(CANON)])
    run(['/usr/bin/find',str(CANON),'-type','d','-exec','/bin/chmod','g+rwx,g+s','{}','+'])
    run(['/usr/bin/find',str(CANON),'-type','f','-exec','/bin/chmod','g+rw','{}','+'])
    run(['/usr/bin/find',str(CANON),'-type','d','-exec','/usr/bin/setfacl','-m','g::rwx,m::rwx,d:g::rwx,d:m::rwx','{}','+'])
    run(['/usr/bin/find',str(CANON),'-type','f','-exec','/usr/bin/setfacl','-m','g::rw,m::rw','{}','+'])
    safe=run(['/usr/bin/git','config','--system','--get-all','safe.directory'],check=False).stdout.splitlines()
    if str(CANON) not in safe: run(['/usr/bin/git','config','--system','--add','safe.directory',str(CANON)])
    run(['/usr/bin/git','--git-dir='+str(CANON),'config','core.sharedRepository','group'])

def create_canonical(work,sha):
    if CANON.exists():
        normalize_canonical_permissions()
        return False
    tmp=CANON.with_name('.bay-assessment.git.tmp-'+str(os.getpid())); shutil.rmtree(tmp,ignore_errors=True)
    run(['/usr/bin/git','clone','--bare',str(work),str(tmp)],timeout=180); run(['/usr/bin/git','--git-dir='+str(tmp),'update-ref','refs/heads/main',sha])
    run(['/usr/bin/git','--git-dir='+str(tmp),'symbolic-ref','HEAD','refs/heads/main']); run(['/usr/bin/git','--git-dir='+str(tmp),'config','core.sharedRepository','group'])
    os.rename(tmp,CANON)
    normalize_canonical_permissions()
    return True

def state_path(execution): return WORK/execution/'state.json'

def rollback(execution):
    p=state_path(execution)
    if not p.is_file(): return {'rolledBack':False,'reason':'NO_STATE'}
    s=read_json(p); errors=[]
    for root,key,service in [(PROD,'prodOld','bay-assessment.service'),(STAGE,'stageOld','bay-assessment-staging.service')]:
        try:
            old=s.get(key)
            if isinstance(old,str) and Path(old).is_dir(): switch(root,Path(old)); restart(service)
        except Exception as e: errors.append(str(e))
    if s.get('canonicalCreated') is True:
        try:
            if CANON.is_dir() and run(['/usr/bin/git','--git-dir='+str(CANON),'rev-parse','refs/heads/main']).stdout.strip().lower()==s.get('releaseSha'): shutil.rmtree(CANON)
        except Exception as e: errors.append(str(e))
    return {'rolledBack':not errors,'errors':errors}

def apply(a):
    m,digest=candidate()
    if digest!=a.manifest_sha or m.get('releaseSha')!=a.release_sha or m.get('baseReleaseSha')!=a.base_sha or m.get('runtimeVersion')!=a.runtime_version:
        raise ReleaseError('ASSESSMENT_RELEASE_TARGET_MOVED')
    root=WORK/a.execution_id; shutil.rmtree(root,ignore_errors=True); root.mkdir(parents=True,mode=0o700); work=root/'source'
    c=canonical_candidate(work)
    if c:
        if c['release']!=a.release_sha: raise ReleaseError('ASSESSMENT_RELEASE_SOURCE_MOVED')
    else:
        b=bootstrap_workspace(work)
        if b['release']!=a.release_sha or b['base']!=a.base_sha: raise ReleaseError('ASSESSMENT_RELEASE_BOOTSTRAP_MISMATCH')
    prod_old=current_link(PROD); stage_old=current_link(STAGE)
    if runtime_sha(prod_old,a.base_sha)!=a.base_sha: raise ReleaseError('ASSESSMENT_RELEASE_PRODUCTION_MOVED')
    qa(work,prod_old)
    stage_backup=backup_state(STAGE_STATE,'staging',a.execution_id); prod_backup=backup_state(PROD_STATE,'production',a.execution_id)
    s={'executionId':a.execution_id,'releaseSha':a.release_sha,'prodOld':str(prod_old),'stageOld':str(stage_old),
       'stageBackup':str(stage_backup),'prodBackup':str(prod_backup),'canonicalCreated':False}; atomic_json(state_path(a.execution_id),s)
    try:
        s['canonicalCreated']=create_canonical(work,a.release_sha); atomic_json(state_path(a.execution_id),s)
        stage_new=build_release(work,STAGE,a.release_sha,a.runtime_version,prod_old); s['stageNew']=str(stage_new); atomic_json(state_path(a.execution_id),s)
        switch(STAGE,stage_new); restart('bay-assessment-staging.service'); health(STAGE_URL)
        prod_new=build_release(work,PROD,a.release_sha,a.runtime_version,prod_old); s['prodNew']=str(prod_new); atomic_json(state_path(a.execution_id),s)
        switch(PROD,prod_new); restart('bay-assessment.service'); health(PROD_URL)
        db=PROD_STATE/'assessment.sqlite'
        if run(['/usr/bin/sqlite3',str(db),'PRAGMA quick_check;']).stdout.strip()!='ok': raise ReleaseError('ASSESSMENT_RELEASE_DATABASE_POSTCHECK_FAILED')
        if run(['/usr/bin/git','--git-dir='+str(CANON),'rev-parse','refs/heads/main']).stdout.strip().lower()!=a.release_sha: raise ReleaseError('ASSESSMENT_RELEASE_CANONICAL_POSTCHECK_FAILED')
        return {'state':'LIVE_SMOKE_PASSED','executionId':a.execution_id,'releaseSha':a.release_sha,'runtimeVersion':a.runtime_version,
                'stagingRelease':str(stage_new),'productionRelease':str(prod_new),'stagingBackup':str(stage_backup),'productionBackup':str(prod_backup),
                'canonicalCreated':s['canonicalCreated']}
    except Exception:
        rollback(a.execution_id); raise

def finalize(execution):
    root=WORK/execution; result={'finalized':True}
    if state_path(execution).is_file(): result['state']=read_json(state_path(execution))
    if (root/'source').is_dir(): shutil.rmtree(root/'source',ignore_errors=True)
    for p in WORK.glob('archive-*.tar'): p.unlink(missing_ok=True)
    return result

def main():
    ap=argparse.ArgumentParser(); g=ap.add_mutually_exclusive_group(required=True)
    for name in ['candidate','apply','rollback','finalize']: g.add_argument('--'+name,action='store_true')
    ap.add_argument('--execution-id'); ap.add_argument('--release-sha'); ap.add_argument('--base-sha'); ap.add_argument('--runtime-version'); ap.add_argument('--manifest-sha')
    a=ap.parse_args()
    try:
        if a.candidate:
            m,d=candidate(); result={'state':'CANDIDATE_READY','candidate':m,'manifestSha256':d}
        elif a.apply:
            if not all([a.execution_id,a.release_sha,a.base_sha,a.runtime_version,a.manifest_sha]) or not SHA40.match(a.release_sha) or not SHA40.match(a.base_sha) or not SHA64.match(a.manifest_sha): raise ReleaseError('ASSESSMENT_RELEASE_ARGUMENT_INVALID')
            result=apply(a)
        elif a.rollback:
            if not a.execution_id: raise ReleaseError('ASSESSMENT_RELEASE_ARGUMENT_INVALID')
            result=rollback(a.execution_id)
        else:
            if not a.execution_id: raise ReleaseError('ASSESSMENT_RELEASE_ARGUMENT_INVALID')
            result=finalize(a.execution_id)
        print(json.dumps({'ok':True,'result':result},ensure_ascii=False,separators=(',',':'))); return 0
    except ReleaseError as e:
        print(json.dumps({'ok':False,'code':e.code,'detail':e.detail},ensure_ascii=False,separators=(',',':'))); return 1
    except Exception as e:
        print(json.dumps({'ok':False,'code':'ASSESSMENT_RELEASE_ENGINE_FAILED','detail':str(e)[:400]},ensure_ascii=False,separators=(',',':'))); return 1

if __name__=='__main__': sys.exit(main())
