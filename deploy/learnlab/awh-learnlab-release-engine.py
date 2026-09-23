#!/usr/bin/env python3
from __future__ import annotations
import argparse, datetime as dt, hashlib, json, os, pwd, grp, re, shutil
import subprocess, sys, time, urllib.request, zipfile
from pathlib import Path

GIT_DIR=Path("/srv/awh-git/bay-learnlab.git")
LIVE_LINK=Path("/var/www/bay-staging/current")
RELEASE_ROOT=Path("/var/www/bay-staging/releases")
RUNTIME_ROOT=Path("/srv/bay-learnlab/runtime")
CHANNEL_ROOT=Path("/srv/bay-learnlab/channels")
NGINX=Path("/etc/nginx/sites-enabled/kruart-domain-aliases-tls.conf")
BACKUP_ROOT=Path("/var/backups/learnlab-releases")
WORK_ROOT=Path("/var/lib/awh-hub/learnlab-release-work")
DB=Path("/var/lib/awh-hub/awh.sqlite")
ALLOWED=("learnlab/prototype/","learnlab/shared/","learnlab/teacher/","learnlab/server/")
DENIED={"learnlab/server/host-adapter.php"}
SHA_RE=re.compile(r"^[0-9a-f]{40}$")
VER_RE=re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?$")
UUID_RE=re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
MAX_FILE=64*1024*1024

class ReleaseError(RuntimeError):
    def __init__(self,code,msg):
        super().__init__(msg); self.code=code

def fail(code,msg): raise ReleaseError(code,msg)
def now(): return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()

def run(cmd,cwd=None,timeout=120,check=True):
    if not cmd or not os.path.isabs(cmd[0]): fail("LEARNLAB_RELEASE_COMMAND_BLOCKED","absolute command required")
    p=subprocess.run(["/usr/bin/timeout","--signal=TERM",str(max(1,timeout)),*cmd],
        cwd=str(cwd) if cwd else None,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
    if check and p.returncode:
        fail("LEARNLAB_RELEASE_COMMAND_FAILED",f"{cmd[0]} exit={p.returncode}: {(p.stdout or '')[-1600:]}")
    return p

def git(args,timeout=60,check=True):
    return run(["/usr/bin/git","-c",f"safe.directory={GIT_DIR}",f"--git-dir={GIT_DIR}",*args],timeout=timeout,check=check)

def read_json(path):
    try: value=json.loads(Path(path).read_text(encoding="utf-8"))
    except Exception as e: fail("LEARNLAB_RELEASE_JSON_INVALID",f"{path}: {e}")
    if not isinstance(value,dict): fail("LEARNLAB_RELEASE_JSON_INVALID",str(path))
    return value

def write_json(path,value,mode=0o600):
    path=Path(path); path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_name(f".{path.name}.tmp-{os.getpid()}")
    tmp.write_text(json.dumps(value,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    os.chmod(tmp,mode); os.replace(tmp,path)

def validate_args(execution,release,base,version,epoch):
    if os.geteuid()!=0: fail("LEARNLAB_RELEASE_ROOT_REQUIRED","root authority required")
    execution=execution.lower()
    if not UUID_RE.fullmatch(execution): fail("LEARNLAB_RELEASE_EXECUTION_INVALID","execution id")
    release=release.lower()
    base=base.lower()
    if not SHA_RE.fullmatch(release): fail("LEARNLAB_RELEASE_SHA_INVALID","release sha")
    if not SHA_RE.fullmatch(base): fail("LEARNLAB_RELEASE_BASE_INVALID","base sha")
    if not VER_RE.fullmatch(version): fail("LEARNLAB_RELEASE_VERSION_INVALID","version")
    if epoch<1 or epoch>1000000: fail("LEARNLAB_RELEASE_EPOCH_INVALID","cache epoch")
    return execution,release,base,version,epoch

def storage_gate():
    u=shutil.disk_usage("/")
    pct=int(round(u.used/u.total*100)) if u.total else 100
    blocked=pct>=90 or u.free<200*1024*1024
    state=Path("/var/lib/awh-hub/storage-guard.json")
    try:
        if state.is_file():
            try: blocked=blocked or read_json(state).get("releaseBlocked") is True
            except ReleaseError: pass
    except OSError:
        pass
    if blocked: fail("LEARNLAB_RELEASE_STORAGE_BLOCKED",f"used={pct}% free={u.free}")
    return {"usedPercent":pct,"freeBytes":u.free,"totalBytes":u.total}

def current_baseline(base,epoch):
    for name in ("pilot","stable"):
        d=read_json(CHANNEL_ROOT/f"{name}.json")
        if str(d.get("release_revision","")).lower()!=base: fail("LEARNLAB_RELEASE_BASE_MOVED",name)
        if int(d.get("cache_epoch",-1))+1!=epoch: fail("LEARNLAB_RELEASE_EPOCH_MOVED",name)

def canonical_main(release):
    head=git(["rev-parse","refs/heads/main"]).stdout.strip().lower()
    if head!=release: fail("LEARNLAB_RELEASE_SOURCE_MOVED",head)

def diff_rows(base,release):
    out=git(["diff","--name-status","--no-renames",base,release,"--"]).stdout
    rows=[]
    for raw in out.splitlines():
        if not raw.strip(): continue
        parts=raw.split("\t")
        if len(parts)!=2 or parts[0] not in {"A","M","D"}: fail("LEARNLAB_RELEASE_DIFF_UNSUPPORTED",raw)
        status,path=parts
        if path in DENIED or not path.startswith(ALLOWED): fail("LEARNLAB_RELEASE_DIFF_OUT_OF_SCOPE",path)
        if ".." in Path(path).parts or "\x00" in path: fail("LEARNLAB_RELEASE_DIFF_UNSAFE",path)
        rows.append((status,path))
    if not rows: fail("LEARNLAB_RELEASE_EMPTY","no changes")
    return rows

def clone_source(work,release):
    src=work/"source"
    if src.exists(): shutil.rmtree(src)
    run(["/usr/bin/git","clone","--no-hardlinks","--single-branch","--branch","main",f"file://{GIT_DIR}",str(src)],timeout=180)
    head=run(["/usr/bin/git","-C",str(src),"rev-parse","HEAD"],timeout=20).stdout.strip().lower()
    if head!=release: fail("LEARNLAB_RELEASE_SOURCE_MISMATCH",head)
    dirty=run(["/usr/bin/git","-C",str(src),"status","--porcelain=v1","--untracked-files=all"],timeout=20).stdout.strip()
    if dirty: fail("LEARNLAB_RELEASE_SOURCE_DIRTY",dirty)
    return src

def object_sha(repo,revision,path):
    p=run(["/usr/bin/git","-C",str(repo),"rev-parse",f"{revision}:{path}"],timeout=20,check=False)
    v=p.stdout.strip().lower()
    return v if p.returncode==0 and re.fullmatch(r"[0-9a-f]{40}",v) else None

def file_blob(path): return run(["/usr/bin/git","hash-object",str(path)],timeout=20).stdout.strip().lower()

def validate_live(src,live,rows,base):
    for status,path in rows:
        old=object_sha(src,base,path); f=live/path
        if status=="A":
            if old is not None or f.exists(): fail("LEARNLAB_RELEASE_LIVE_DRIFT",path)
        elif old is None or not f.is_file() or f.is_symlink() or file_blob(f)!=old:
            fail("LEARNLAB_RELEASE_LIVE_DRIFT",path)

def ensure_parent(path,uid,gid):
    missing=[]; p=path.parent
    while not p.exists(): missing.append(p); p=p.parent
    for d in reversed(missing): d.mkdir(mode=0o755); os.chown(d,uid,gid)

def candidate_overlay(src,live,candidate,rows,release):
    run(["/bin/cp","-al",str(live),str(candidate)],timeout=240)
    uid=pwd.getpwnam("bay-staging").pw_uid; gid=grp.getgrnam("www-data").gr_gid
    for status,path in rows:
        dst=candidate/path
        if status=="D":
            if dst.exists() or dst.is_symlink(): dst.unlink()
            continue
        source=src/path
        if not source.is_file() or source.is_symlink() or source.stat().st_size>MAX_FILE:
            fail("LEARNLAB_RELEASE_SOURCE_FILE_INVALID",path)
        ensure_parent(dst,uid,gid)
        tmp=dst.with_name(f".{dst.name}.new-{os.getpid()}")
        shutil.copy2(source,tmp); os.chown(tmp,uid,gid); os.chmod(tmp,0o644); os.replace(tmp,dst)
        want=object_sha(src,release,path)
        if want is None or file_blob(dst)!=want: fail("LEARNLAB_RELEASE_CANDIDATE_MISMATCH",path)

def node_path():
    for p in sorted(Path("/opt/awh-tools/remote-desktop").glob("node-v*-linux-x64/bin/node"),reverse=True):
        if p.is_file(): return str(p)
    return "/usr/bin/node"

def validate_candidate(candidate,rows):
    node=node_path()
    for status,path in rows:
        if status=="D": continue
        f=candidate/path
        if path.endswith(".php"): run(["/usr/bin/php","-l",str(f)],timeout=30)
        elif path.endswith(".js"): run([node,"--check",str(f)],timeout=30)
        elif path.endswith(".json"): read_json(f)
    for req in ("learnlab/prototype/index.html","learnlab/server/api.php","learnlab/teacher/index.php"):
        if not (candidate/req).is_file(): fail("LEARNLAB_RELEASE_CANDIDATE_INCOMPLETE",req)

def product_zip(src,work,version,release):
    out=work/"runtime-publication-source.zip"
    manifest={"artifact_kind":"runtime-publication-source","id":"bay-learnlab",
      "provenance_note":"AWH LearnLab FILE_ONLY canonical release",
      "source_repository":"theartzkk/bay-learnlab","source_revision":release,"type":"product","version":version}
    def add(z,name,data):
        i=zipfile.ZipInfo(name,(1980,1,1,0,0,0)); i.compress_type=zipfile.ZIP_DEFLATED
        i.external_attr=(0o100644&0xffff)<<16; z.writestr(i,data)
    with zipfile.ZipFile(out,"w",compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
        add(z,"manifest.json",(json.dumps(manifest,ensure_ascii=False,sort_keys=True,indent=2)+"\n").encode())
        for group in ("prototype","shared"):
            base=src/"learnlab"/group
            if not base.is_dir(): fail("LEARNLAB_RELEASE_RUNTIME_SOURCE_MISSING",group)
            for p in sorted(base.rglob("*")):
                if p.is_file() and not p.is_symlink():
                    add(z,"payload/"+p.relative_to(src).as_posix(),p.read_bytes())
    return out,hashlib.sha256(out.read_bytes()).hexdigest()

def publish_runtime(src,work,version,release):
    product,sha=product_zip(src,work,version,release)
    pub=f"{version}-{release[:7]}-student-runtime"
    helper=src/"ops/learnlab-runtime/publish-immutable-runtime.py"
    args=["/usr/bin/python3",str(helper),"--product-zip",str(product),"--runtime-root",str(RUNTIME_ROOT),
      "--publication-id",pub,"--source-revision",release]
    dry=json.loads(run(args,timeout=120).stdout)
    if dry.get("dry_run") is not True or dry.get("source_revision")!=release: fail("LEARNLAB_RELEASE_RUNTIME_DRY_INVALID",str(dry))
    run([*args,"--apply"],timeout=180)
    runtime=RUNTIME_ROOT/pub; att=read_json(runtime/".runtime-publication.json")
    if att.get("source_revision")!=release or att.get("product_artifact_sha256")!=sha:
        fail("LEARNLAB_RELEASE_RUNTIME_ATTESTATION_FAILED",pub)
    return pub,runtime,sha

def backup_state(execution,release):
    stamp=dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    b=BACKUP_ROOT/f"{stamp}-{release[:7]}-{execution[:8]}"; b.mkdir(parents=True,mode=0o700)
    for name in ("pilot.json","stable.json"): shutil.copy2(CHANNEL_ROOT/name,b/name)
    shutil.copy2(NGINX,b/"nginx.conf"); (b/"current-target.txt").write_text(str(LIVE_LINK.resolve())+"\n")
    run(["/usr/bin/sqlite3",str(DB),f".backup '{b/'awh.sqlite'}'"],timeout=120); os.chmod(b/"awh.sqlite",0o600)
    return b

def switch_current(candidate):
    tmp=LIVE_LINK.with_name(f".current.learnlab-{os.getpid()}")
    if tmp.exists() or tmp.is_symlink(): tmp.unlink()
    tmp.symlink_to(candidate); os.replace(tmp,LIVE_LINK)
    if LIVE_LINK.resolve()!=candidate.resolve(): fail("LEARNLAB_RELEASE_POINTER_FAILED",str(candidate))

def publish_channels(src,version,release,epoch,pub):
    helper=src/"ops/learnlab-runtime/publish-channel.py"
    url=f"https://learn.kruart.online/learnlab/runtime/{pub}/prototype/"
    for ch in ("pilot","stable"):
        run(["/usr/bin/python3",str(helper),"--root",str(CHANNEL_ROOT),"--channel",ch,
          "--runtime-version",version,"--runtime-url",url,"--revision",release,
          "--min-launcher-version","1.1.0","--api-contract","learnlab.api.v1",
          "--cache-epoch",str(epoch),"--release-notes",f"AWH FILE_ONLY {release[:12]}","--apply"],timeout=60)
    return url

def sync_nginx(src):
    helper=src/"ops/learnlab-runtime/sync-production-entrypoint.py"
    args=["/usr/bin/python3",str(helper),"--manifest",str(CHANNEL_ROOT/"stable.json"),"--config",str(NGINX)]
    run(args,timeout=30); run([*args,"--apply"],timeout=30); run(["/usr/sbin/nginx","-t"],timeout=30)
    run(["/bin/systemctl","reload","nginx"],timeout=30)

def get_url(url):
    last=None
    for _ in range(3):
        try:
            req=urllib.request.Request(url,headers={"User-Agent":"AWH-LearnLab-Release/1"})
            with urllib.request.urlopen(req,timeout=12) as r: return r.status,r.geturl(),r.read(2*1024*1024)
        except Exception as e: last=e; time.sleep(.5)
    fail("LEARNLAB_RELEASE_SMOKE_FAILED",f"{url}: {last}")

def smoke(url,release):
    status,final,_=get_url("https://learn.kruart.online/student")
    if status!=200 or final!=url: fail("LEARNLAB_RELEASE_STUDENT_SMOKE_FAILED",f"{status} {final}")
    status,_,_=get_url(url)
    if status!=200: fail("LEARNLAB_RELEASE_STUDENT_SMOKE_FAILED",str(status))
    status,_,body=get_url("https://learn.kruart.online/teacher")
    if status!=200 or b"worksheet-studio.php" not in body: fail("LEARNLAB_RELEASE_TEACHER_SMOKE_FAILED",str(status))
    if str(read_json(CHANNEL_ROOT/"stable.json").get("release_revision","")).lower()!=release:
        fail("LEARNLAB_RELEASE_CHANNEL_SMOKE_FAILED","stable")

def vault_zip(runtime,work):
    out=work/"vault-runtime.zip"; items=[]
    with zipfile.ZipFile(out,"w",compression=zipfile.ZIP_STORED) as z:
        for p in sorted(runtime.rglob("*")):
            if not p.is_file() or p.is_symlink(): continue
            rel=p.relative_to(runtime).as_posix(); data=p.read_bytes()
            i=zipfile.ZipInfo(rel,(1980,1,1,0,0,0)); i.compress_type=zipfile.ZIP_STORED
            i.external_attr=(0o100640&0xffff)<<16; z.writestr(i,data)
            items.append({"path":rel,"sha256":hashlib.sha256(data).hexdigest(),"sizeBytes":len(data)})
    items.sort(key=lambda x:x["path"]); raw=json.dumps({"schemaVersion":1,"files":items},separators=(",",":")).encode()
    return out,hashlib.sha256(raw).hexdigest(),len(items),sum(x["sizeBytes"] for x in items)

def rollback(execution):
    work=WORK_ROOT/execution; state=read_json(work/"release-state.json"); b=Path(state["backup"])
    if BACKUP_ROOT.resolve() not in b.resolve().parents: fail("LEARNLAB_RELEASE_ROLLBACK_UNSAFE",str(b))
    target=Path((b/"current-target.txt").read_text().strip()).resolve()
    if RELEASE_ROOT.resolve() not in target.parents: fail("LEARNLAB_RELEASE_ROLLBACK_UNSAFE",str(target))
    tmp=LIVE_LINK.with_name(f".current.rollback-{os.getpid()}"); tmp.symlink_to(target); os.replace(tmp,LIVE_LINK)
    for name in ("pilot.json","stable.json"): shutil.copy2(b/name,CHANNEL_ROOT/name)
    shutil.copy2(b/"nginx.conf",NGINX); run(["/usr/sbin/nginx","-t"],timeout=30); run(["/bin/systemctl","reload","nginx"],timeout=30)
    for key,root in (("runtime",RUNTIME_ROOT),("candidate",RELEASE_ROOT)):
        p=Path(state.get(key,""))
        if p.exists() and root.resolve() in p.resolve().parents: shutil.rmtree(p)
    state["state"]="ROLLED_BACK"; state["rolledBackAt"]=now(); write_json(work/"release-state.json",state)
    return state

def apply_release(execution,release,base,version,epoch):
    storage=storage_gate(); canonical_main(release); current_baseline(base,epoch)
    live=LIVE_LINK.resolve()
    if RELEASE_ROOT.resolve() not in live.parents: fail("LEARNLAB_RELEASE_LIVE_POINTER_INVALID",str(live))
    rows=diff_rows(base,release); work=WORK_ROOT/execution
    if work.exists(): shutil.rmtree(work)
    work.mkdir(parents=True,mode=0o700); src=clone_source(work,release); validate_live(src,live,rows,base)
    candidate=RELEASE_ROOT/f"bay-staging-learnlab-{version}-{release[:7]}-exact"
    if candidate.exists(): fail("LEARNLAB_RELEASE_CANDIDATE_EXISTS",str(candidate))
    backup=backup_state(execution,release)
    state={"schemaVersion":1,"state":"PREPARED","executionId":execution,"releaseSha":release,"baseReleaseSha":base,
      "runtimeVersion":version,"cacheEpoch":epoch,"candidate":str(candidate),"runtime":"","backup":str(backup),
      "diff":[{"status":s,"path":p} for s,p in rows],"storage":storage,"preparedAt":now()}
    write_json(work/"release-state.json",state)
    try:
        candidate_overlay(src,live,candidate,rows,release); validate_candidate(candidate,rows)
        pub,runtime,product_sha=publish_runtime(src,work,version,release)
        state.update({"state":"RUNTIME_PUBLISHED","runtime":str(runtime),"publicationId":pub,"productArtifactSha256":product_sha})
        write_json(work/"release-state.json",state)
        switch_current(candidate); url=publish_channels(src,version,release,epoch,pub); sync_nginx(src); smoke(url,release)
        archive,content_sha,count,content_bytes=vault_zip(runtime,work)
        state.update({"state":"LIVE_SMOKE_PASSED","runtimeUrl":url,"vaultArchive":str(archive),
          "vaultContentSha256":content_sha,"vaultFileCount":count,"vaultContentBytes":content_bytes,"liveAt":now()})
        write_json(work/"release-state.json",state); return state
    except Exception:
        try: rollback(execution)
        except Exception as e: print("ROLLBACK_ERROR:"+str(e),file=sys.stderr)
        raise

def finalize(execution):
    work=WORK_ROOT/execution; state=read_json(work/"release-state.json"); state["state"]="COMPLETED"; state["finalizedAt"]=now()
    b=Path(state["backup"])
    if b.is_dir(): write_json(b/"release-evidence.json",state)
    for p in (work/"source",work/"runtime-publication-source.zip",work/"vault-runtime.zip"):
        if p.is_dir(): shutil.rmtree(p)
        elif p.exists(): p.unlink()
    write_json(work/"release-state.json",state); return state

def main():
    p=argparse.ArgumentParser(); m=p.add_mutually_exclusive_group(required=True)
    m.add_argument("--apply",action="store_true"); m.add_argument("--rollback",action="store_true"); m.add_argument("--finalize",action="store_true")
    p.add_argument("--execution-id",required=True); p.add_argument("--release-sha",default=""); p.add_argument("--base-sha",default="")
    p.add_argument("--runtime-version",default=""); p.add_argument("--cache-epoch",type=int,default=0); a=p.parse_args()
    if os.geteuid()!=0: fail("LEARNLAB_RELEASE_ROOT_REQUIRED","root")
    ex=a.execution_id.lower()
    if not UUID_RE.fullmatch(ex): fail("LEARNLAB_RELEASE_EXECUTION_INVALID",ex)
    if a.rollback: result=rollback(ex)
    elif a.finalize: result=finalize(ex)
    else:
        _,release,base,version,epoch=validate_args(ex,a.release_sha,a.base_sha,a.runtime_version,a.cache_epoch)
        result=apply_release(ex,release,base,version,epoch)
    print(json.dumps({"ok":True,"result":result},ensure_ascii=False,separators=(",",":"))); return 0

if __name__=="__main__":
    try: raise SystemExit(main())
    except ReleaseError as e:
        print(json.dumps({"ok":False,"code":e.code,"message":str(e)},ensure_ascii=False,separators=(",",":")),file=sys.stderr)
        raise SystemExit(1)
    except Exception as e:
        print(json.dumps({"ok":False,"code":"LEARNLAB_RELEASE_ENGINE_FAILED","message":str(e)},ensure_ascii=False,separators=(",",":")),file=sys.stderr)
        raise SystemExit(1)

