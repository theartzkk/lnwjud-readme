#!/usr/bin/env python3
import os, re, sys, json, sqlite3, shutil, subprocess
from pathlib import Path
from datetime import datetime, timezone

APPLY="--apply" in sys.argv
PLAN="--plan" in sys.argv
if APPLY and PLAN:
    raise SystemExit("RETENTION_ABORT: choose only one of --plan or --apply")
NOW=datetime.now(timezone.utc)
DB=Path("/var/lib/awh-hub/awh.sqlite")
BACK=Path("/var/backups/awh-hub")
CFG=BACK/"config"
WEB=Path("/var/www/awh-web/releases")
CTL=Path("/opt/awh-hub/control-releases")
WEBPTR=Path("/var/www/awh-web/current")
CTLPTR=Path("/opt/awh-hub/control-plane-current")
STATE=Path("/var/lib/awh-hub/retention-last.json")
EVENTS=Path("/var/lib/awh-hub/retention-events.log")
REL_RE=re.compile(r"^(m\d+)-[0-9a-f]{12}(?:-r\d+)?$")
SCHED_RE=re.compile(r"^awh-(\d{8})T(\d{6})Z\.sqlite$")
PRE_RE=re.compile(r"^awh\.sqlite\.pre-(.+)$")

def fail(msg):
    raise SystemExit("RETENTION_ABORT: "+msg)

def size(path):
    try:
        if path.is_file() and not path.is_symlink():
            return path.stat().st_size
        total=0
        for root, _, files in os.walk(path):
            for name in files:
                p=Path(root)/name
                try:
                    if not p.is_symlink():
                        total+=p.stat().st_size
                except OSError:
                    pass
        return total
    except OSError:
        return 0

for p in (DB,BACK,WEB,CTL):
    if not p.exists():
        fail("missing authority "+str(p))
if not WEBPTR.is_symlink() or not CTLPTR.is_symlink():
    fail("current pointers invalid")

con=sqlite3.connect(DB)
try:
    active=con.execute("select count(*) from control_task_executions where state in ('LEASED','RUNNING')").fetchone()[0]
    if active:
        fail(f"{active} active executions")
except sqlite3.Error as e:
    fail("execution check failed: "+str(e))

protected=set()
for parent in (Path("/opt/awh-hub"),Path("/var/www/awh-web")):
    for link in parent.iterdir():
        try:
            if link.is_symlink():
                target=link.resolve()
                if target.parent in (WEB,CTL):
                    protected.add(target.name)
        except OSError:
            pass

try:
    tables=[r[0] for r in con.execute("select name from sqlite_master where type='table' and name not like 'sqlite_%'")]
    for table in tables:
        for col in con.execute(f'pragma table_info("{table}")').fetchall():
            name=str(col[1])
            if "release" not in name.lower():
                continue
            try:
                vals=con.execute(f'select distinct "{name}" from "{table}" where "{name}" is not null limit 500').fetchall()
                for (v,) in vals:
                    if isinstance(v,str) and ((WEB/v).exists() or (CTL/v).exists()):
                        protected.add(v)
            except sqlite3.Error:
                pass
finally:
    con.close()

pairs=[]
for p in WEB.iterdir():
    other=CTL/p.name
    m=REL_RE.fullmatch(p.name)
    if m and p.is_dir() and not p.is_symlink() and other.is_dir() and not other.is_symlink():
        pairs.append((max(p.stat().st_mtime,other.stat().st_mtime),p.name,m.group(1)))
pairs.sort(reverse=True)
release_keep=set(protected)
release_keep.update(name for _,name,_ in pairs[:6])
for major in {r[2] for r in pairs}:
    group=[r for r in pairs if r[2]==major]
    if group:
        release_keep.add(group[0][1])
release_candidates=[r for r in pairs if r[1] not in release_keep and NOW.timestamp()-r[0] > 3*86400]

scheduled=[]
for p in BACK.iterdir():
    m=SCHED_RE.fullmatch(p.name)
    manifest=Path(str(p)+".json")
    if m and p.is_file() and not p.is_symlink() and manifest.is_file() and not manifest.is_symlink():
        dt=datetime.strptime(m.group(1)+m.group(2),"%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)
        scheduled.append((dt,p,manifest))
scheduled.sort(reverse=True,key=lambda x:x[0])
if not scheduled:
    fail("no canonical scheduled backups")

cli="/opt/awh-hub/control-plane-current/hub/bin/backup.php"
for _,p,m in scheduled[:3]:
    r=subprocess.run(["/usr/bin/php","-d","pcre.jit=0",cli,"verify",str(p),str(m)],capture_output=True,text=True)
    if r.returncode or '"VERIFIED"' not in r.stdout:
        fail("backup verification failed: "+p.name)

scheduled_keep={x[1] for x in scheduled[:3]}
days=set(); weeks=set(); months=set()
for dt,p,_ in scheduled:
    age=(NOW-dt).total_seconds()/86400
    if age<=14 and dt.date() not in days:
        scheduled_keep.add(p); days.add(dt.date())
    yw=dt.isocalendar()[:2]
    if age<=56 and yw not in weeks:
        scheduled_keep.add(p); weeks.add(yw)
    mdiff=(NOW.year-dt.year)*12+NOW.month-dt.month
    ym=(dt.year,dt.month)
    if mdiff<=5 and ym not in months:
        scheduled_keep.add(p); months.add(ym)
scheduled_candidates=[r for r in scheduled if r[1] not in scheduled_keep]

pre=[]
for p in BACK.iterdir():
    m=PRE_RE.fullmatch(p.name)
    if not m or not p.is_file() or p.is_symlink() or p.name.endswith(("-wal","-shm")):
        continue
    rid=m.group(1)
    mm=re.match(r"^(m\d+)",rid)
    pre.append((p.stat().st_mtime,p,rid,mm.group(1) if mm else "other"))
pre.sort(reverse=True)
pre_keep={r[1] for r in pre[:3]}
for mt,p,rid,_ in pre:
    if NOW.timestamp()-mt <= 86400 or rid in release_keep or rid in protected:
        pre_keep.add(p)
for major in {r[3] for r in pre}:
    group=[r for r in pre if r[3]==major]
    if group:
        pre_keep.add(group[0][1])
pre_candidates=[r for r in pre if r[1] not in pre_keep]

manual=[]
for p in BACK.iterdir():
    if p.is_dir() and not p.is_symlink() and p.name.startswith("manual-"):
        manual.append((p.stat().st_mtime,p))
manual.sort(reverse=True)
manual_keep={p for _,p in manual[:3]}
day_seen=set(); month_seen=set()
for mt,p in manual:
    if (p/".retain").exists():
        manual_keep.add(p); continue
    dt=datetime.fromtimestamp(mt,timezone.utc)
    age=(NOW-dt).total_seconds()/86400
    if age<=7:
        manual_keep.add(p); continue
    if age<=30 and dt.date() not in day_seen:
        manual_keep.add(p); day_seen.add(dt.date()); continue
    mdiff=(NOW.year-dt.year)*12+NOW.month-dt.month
    ym=(dt.year,dt.month)
    if mdiff<=5 and ym not in month_seen:
        manual_keep.add(p); month_seen.add(ym)
manual_candidates=[r for r in manual if r[1] not in manual_keep]

items=[]
def add(path,kind,extra=None):
    row={"path":str(path),"kind":kind,"bytes":size(path),"mtime":datetime.fromtimestamp(path.stat().st_mtime,timezone.utc).isoformat()}
    if extra: row.update(extra)
    items.append(row)

for _,name,_ in release_candidates:
    add(WEB/name,"web-release",{"releaseId":name})
    add(CTL/name,"control-release",{"releaseId":name})
for _,p,m in scheduled_candidates:
    add(p,"scheduled-backup"); add(m,"scheduled-manifest")
for _,p,rid,_ in pre_candidates:
    add(p,"pre-release-backup",{"releaseId":rid})
    for suffix in ("-wal","-shm"):
        q=Path(str(p)+suffix)
        if q.is_file() and not q.is_symlink():
            add(q,"pre-release-companion",{"releaseId":rid})
for _,p in manual_candidates:
    add(p,"manual-backup")

stamp=NOW.strftime("%Y%m%dT%H%M%SZ")
manifest=CFG/f"retention-manifest-{stamp}.json"
payload={
    "schemaVersion":1,"generatedAt":NOW.isoformat(),"mode":"APPLY" if APPLY else ("PLAN" if PLAN else "DRY_RUN"),
    "current":{"web":WEBPTR.resolve().name,"control":CTLPTR.resolve().name},
    "protectedReleaseIds":sorted(protected),"releaseKeep":sorted(release_keep),
    "counts":{"releasePairs":len(release_candidates),"scheduledBackups":len(scheduled_candidates),"preReleaseBackups":len(pre_candidates),"manualBackups":len(manual_candidates),"items":len(items)},
    "candidateBytes":sum(x["bytes"] for x in items),"candidates":items
}
if not PLAN:
    CFG.mkdir(parents=True,exist_ok=True)
    manifest.write_text(json.dumps(payload,ensure_ascii=False,indent=2)+"\n")
    os.chmod(manifest,0o600)

deleted=0
reclaimed=0
if APPLY:
    live={WEBPTR.resolve().name,CTLPTR.resolve().name}
    if live != {payload["current"]["web"],payload["current"]["control"]}:
        fail("release pointers changed during run")
    for _,name,_ in release_candidates:
        if name in live or name in protected or name in release_keep:
            fail("release safety invariant: "+name)
        for root in (WEB,CTL):
            p=root/name
            if p.parent!=root or p.is_symlink() or not p.is_dir() or not REL_RE.fullmatch(name):
                fail("unsafe release "+str(p))
            reclaimed+=size(p)
            shutil.rmtree(p)
            deleted+=1
    for _,p,m in scheduled_candidates:
        for q in (p,m):
            if q.parent!=BACK or q.is_symlink() or not q.is_file():
                fail("unsafe scheduled backup "+str(q))
            reclaimed+=q.stat().st_size
            q.unlink()
            deleted+=1
    for _,p,_,_ in pre_candidates:
        for q in [p,Path(str(p)+"-wal"),Path(str(p)+"-shm")]:
            if not q.exists():
                continue
            if q.parent!=BACK or q.is_symlink() or not q.is_file():
                fail("unsafe pre-release backup "+str(q))
            reclaimed+=q.stat().st_size
            q.unlink()
            deleted+=1
    for _,p in manual_candidates:
        if p.parent!=BACK or p.is_symlink() or not p.is_dir() or not p.name.startswith("manual-"):
            fail("unsafe manual backup "+str(p))
        reclaimed+=size(p)
        shutil.rmtree(p)
        deleted+=1

v=os.statvfs("/")
free=v.f_bavail*v.f_frsize
total=v.f_blocks*v.f_frsize
result={
    "schemaVersion":1,
    "finishedAt":datetime.now(timezone.utc).isoformat(),
    "state":"APPLIED" if APPLY else ("PLAN" if PLAN else "PREVIEW"),
    "manifest":None if PLAN else str(manifest),
    "deletedItems":deleted,
    "reclaimedLogicalBytes":reclaimed,
    "disk":{
        "totalBytes":total,
        "freeBytes":free,
        "usedPercent":round((1-free/total)*100,1)
    },
    "counts":payload["counts"],
    "candidateBytes":payload["candidateBytes"]
}
if not PLAN:
    tmp=Path(str(STATE)+".tmp")
    tmp.write_text(json.dumps(result,ensure_ascii=False,separators=(",",":"))+"\n")
    os.chmod(tmp,0o640)
    os.replace(tmp,STATE)
    with EVENTS.open("a") as f:
        f.write(json.dumps(result,ensure_ascii=False,separators=(",",":"))+"\n")
    EVENTS.write_text("\n".join(EVENTS.read_text().splitlines()[-100:])+"\n")
    os.chmod(EVENTS,0o640)
print(json.dumps(result,ensure_ascii=False,indent=2))
