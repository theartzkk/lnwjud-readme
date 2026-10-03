#!/usr/bin/env python3
import argparse
import json
import os
import shutil
import sqlite3
import subprocess
import time
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TMP = Path(os.environ.get("AWH_TEMP_ROOT", "/tmp"))
DURABLE = Path(os.environ.get("AWH_DURABLE_WORKTREE_ROOT", "/var/lib/awh-remote/worktrees"))
CANONICAL_ROOT = Path(os.environ.get("AWH_CANONICAL_ROOT", "/srv/awh-git")).resolve()
DB = Path(os.environ.get("AWH_HUB_DB_PATH", "/var/lib/awh-hub/awh.sqlite"))
GOVERNANCE = Path(os.environ.get("AWH_REPOSITORY_GOVERNANCE", str(ROOT / "config/repository-governance-contract.json")))
STATE = Path(os.environ.get("AWH_TEMP_JANITOR_STATE", "/var/lib/awh-hub/temp-workspace-janitor.json"))
TARGET_FREE = int(os.environ.get("AWH_TMP_TARGET_FREE_BYTES", str(6 * 1024**3)))
PRESSURE_FREE = int(os.environ.get("AWH_TMP_PRESSURE_FREE_BYTES", str(6 * 1024**3)))
PRESSURE_TMP = int(os.environ.get("AWH_TMP_PRESSURE_BYTES", str(2 * 1024**3)))
NORMAL_AGE = int(os.environ.get("AWH_TMP_WORKSPACE_MIN_AGE_MINUTES", "720")) * 60
PRESSURE_AGE = int(os.environ.get("AWH_TMP_PRESSURE_MIN_AGE_MINUTES", "60")) * 60
KEEP_NEWEST = int(os.environ.get("AWH_TMP_KEEP_NEWEST_PER_REPO", "3"))
DURABLE_NORMAL_AGE = int(os.environ.get("AWH_DURABLE_WORKTREE_MIN_AGE_MINUTES", "4320")) * 60
DURABLE_PRESSURE_AGE = int(os.environ.get("AWH_DURABLE_PRESSURE_MIN_AGE_MINUTES", "180")) * 60
DURABLE_KEEP_NEWEST = int(os.environ.get("AWH_DURABLE_KEEP_NEWEST_PER_REPO", "2"))
MAX_DELETE = int(os.environ.get("AWH_TMP_MAX_DELETE_PER_RUN", "32"))
DURABLE_MAX_DELETE = int(os.environ.get("AWH_DURABLE_MAX_DELETE_PER_RUN", "16"))

ap = argparse.ArgumentParser()
ap.add_argument("--plan", action="store_true")
ap.add_argument("--apply", action="store_true")
ap.add_argument("--pressure", action="store_true")
args = ap.parse_args()
if args.plan and args.apply:
    raise SystemExit("JANITOR_ABORT: choose one mode")
apply = args.apply

def run(cmd):
    return subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)

def du(path):
    r = run(["/usr/bin/du", "-sb", str(path)])
    try:
        return int(r.stdout.split()[0])
    except Exception:
        return 0

def free_bytes():
    return shutil.disk_usage("/").free

def clean(path):
    r = run(["/usr/bin/git", "-C", str(path), "status", "--porcelain=v1", "--untracked-files=all"])
    return r.returncode == 0 and not r.stdout.strip()

def head(path):
    r = run(["/usr/bin/git", "-C", str(path), "rev-parse", "HEAD"])
    value = r.stdout.strip()
    return value if r.returncode == 0 and len(value) == 40 else None

def origin_repo(path):
    r = run(["/usr/bin/git", "-C", str(path), "remote", "get-url", "origin"])
    raw = r.stdout.strip()
    if raw.startswith("file://"):
        raw = raw[7:]
    try:
        resolved = Path(raw).resolve()
    except Exception:
        return None
    if resolved.parent != CANONICAL_ROOT or not resolved.name.endswith(".git") or not resolved.is_dir():
        return None
    return resolved

def head_in_origin(repo, sha):
    if run(["/usr/bin/git", f"--git-dir={repo}", "cat-file", "-e", f"{sha}^{{commit}}"]).returncode != 0:
        return False
    r = run(["/usr/bin/git", f"--git-dir={repo}", "for-each-ref", "--format=%(refname)", "--contains", sha, "refs/heads", "refs/tags"])
    return r.returncode == 0 and bool(r.stdout.strip())

def head_in_canonical_main(repo, sha):
    if run(["/usr/bin/git", f"--git-dir={repo}", "rev-parse", "--verify", "refs/heads/main"]).returncode != 0:
        return False
    return run(["/usr/bin/git", f"--git-dir={repo}", "merge-base", "--is-ancestor", sha, "refs/heads/main"]).returncode == 0

def open_files(path):
    if shutil.which("lsof") is None:
        return False
    r = run(["/usr/bin/lsof", "+D", str(path)])
    return r.returncode == 0 and bool(r.stdout.strip())

def cwd_users(path):
    target = str(path.resolve())
    users = []
    for proc in Path("/proc").iterdir():
        if not proc.name.isdigit():
            continue
        try:
            cwd = os.readlink(proc / "cwd")
            if cwd == target or cwd.startswith(target + "/"):
                users.append(proc.name)
        except OSError:
            pass
    return users

def governance():
    data = json.loads(GOVERNANCE.read_text())
    rows = data.get("repositories", {})
    by_dir = {}
    for _, row in rows.items():
        directory = row.get("directory")
        project_id = row.get("projectId")
        if isinstance(directory, str) and isinstance(project_id, str) and directory.endswith(".git"):
            by_dir[directory] = project_id.lower()
    return by_dir

def active_projects():
    result = set()
    try:
        if not DB.is_file():
            return None
    except OSError:
        return None
    try:
        con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
        sql = """
        SELECT DISTINCT e.project_id
        FROM control_task_executions e
        JOIN control_tasks t ON t.task_id=e.task_id
        LEFT JOIN control_execution_envelopes x ON x.execution_id=e.execution_id
        WHERE t.state NOT IN ('COMPLETED','FAILED','CANCELLED')
          AND e.state NOT IN ('COMPLETED','FAILED','CANCELLED')
          AND e.required_capability <> 'operator.project_mission'
          AND (
            e.state IN ('LEASED','RUNNING')
            OR (x.execution_id IS NOT NULL AND x.state IN ('OPEN','WAITING','ACTIVE','CONFLICT'))
          )
        """
        result = {str(row[0]).lower() for row in con.execute(sql).fetchall() if isinstance(row[0], str)}
        con.close()
        return result
    except sqlite3.Error:
        return None

def protected_projects():
    try:
        if not DB.is_file():
            return None
    except OSError:
        return None
    try:
        con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
        sql = """
        SELECT DISTINCT e.project_id
        FROM control_task_executions e
        JOIN control_tasks t ON t.task_id=e.task_id
        LEFT JOIN control_execution_envelopes x ON x.execution_id=e.execution_id
        WHERE t.state NOT IN ('COMPLETED','FAILED','CANCELLED')
          AND e.state NOT IN ('COMPLETED','FAILED','CANCELLED')
          AND (
            e.state IN ('LEASED','RUNNING','WAITING_FOR_CAPABILITY')
            OR (x.execution_id IS NOT NULL AND x.state IN ('OPEN','WAITING','ACTIVE','CONFLICT'))
          )
        """
        result = {str(row[0]).lower() for row in con.execute(sql).fetchall() if isinstance(row[0], str)}
        con.close()
        return result
    except sqlite3.Error:
        return None

mapping = governance()
active = active_projects()
protected = protected_projects()
tmp_bytes = du(TMP)
pressure = args.pressure or free_bytes() < PRESSURE_FREE or tmp_bytes > PRESSURE_TMP
min_age = PRESSURE_AGE if pressure else NORMAL_AGE
durable_min_age = DURABLE_PRESSURE_AGE if pressure else DURABLE_NORMAL_AGE
now = time.time()
rows = []
durable_rows = []

if TMP.is_dir():
    for path in TMP.iterdir():
        try:
            if not path.is_dir() or path.is_symlink() or not (path / ".git").is_dir():
                continue
            age = now - path.stat().st_mtime
            if age < min_age:
                continue
            repo = origin_repo(path)
            if repo is None:
                continue
            project_id = mapping.get(repo.name)
            if project_id is None or active is None or project_id in active:
                continue
            sha = head(path)
            if sha is None or not head_in_origin(repo, sha) or not clean(path):
                continue
            if any((path / ".git").glob("*.lock")) or open_files(path):
                continue
            pids = cwd_users(path)
            if pids:
                continue
            rows.append({
                "path": path,
                "repo": repo.name,
                "projectId": project_id,
                "head": sha,
                "mtime": path.stat().st_mtime,
                "bytes": du(path),
            })
        except OSError:
            continue

if DURABLE.is_dir() and protected is not None:
    for path in DURABLE.iterdir():
        try:
            if not path.is_dir() or path.is_symlink() or not (path / ".git").exists():
                continue
            age = now - path.stat().st_mtime
            if age < durable_min_age:
                continue
            repo = origin_repo(path)
            if repo is None:
                continue
            project_id = mapping.get(repo.name)
            if project_id is None or project_id in protected:
                continue
            sha = head(path)
            if sha is None or not head_in_canonical_main(repo, sha) or not clean(path):
                continue
            git_meta = path / ".git"
            if git_meta.is_dir() and any(git_meta.glob("*.lock")):
                continue
            if open_files(path) or cwd_users(path):
                continue
            durable_rows.append({
                "path": path,
                "repo": repo.name,
                "projectId": project_id,
                "head": sha,
                "mtime": path.stat().st_mtime,
                "bytes": du(path),
                "linkedWorktree": git_meta.is_file(),
            })
        except OSError:
            continue

by_repo = defaultdict(list)
for row in rows:
    by_repo[row["repo"]].append(row)

eligible = []
for repo, items in by_repo.items():
    items.sort(key=lambda row: row["mtime"], reverse=True)
    eligible.extend(items[KEEP_NEWEST:])

eligible.sort(key=lambda row: row["bytes"], reverse=True)
durable_by_repo = defaultdict(list)
for row in durable_rows:
    durable_by_repo[row["repo"]].append(row)
durable_eligible = []
for repo, items in durable_by_repo.items():
    items.sort(key=lambda row: row["mtime"], reverse=True)
    durable_eligible.extend(items[DURABLE_KEEP_NEWEST:])
durable_eligible.sort(key=lambda row: row["mtime"])

deleted = []
durable_deleted = []
reclaimed = 0
durable_reclaimed = 0
before = free_bytes()

if apply:
    for row in eligible[:MAX_DELETE]:
        if free_bytes() >= TARGET_FREE and du(TMP) <= PRESSURE_TMP:
            break
        path = row["path"]
        repo = origin_repo(path)
        sha = head(path)
        if repo is None or repo.name != row["repo"] or sha != row["head"]:
            continue
        fresh_active = active_projects()
        if fresh_active is None or row["projectId"] in fresh_active:
            continue
        if not clean(path) or not head_in_origin(repo, sha) or open_files(path) or cwd_users(path):
            continue
        shutil.rmtree(path)
        reclaimed += int(row["bytes"])
        deleted.append({k: v for k, v in row.items() if k not in ("path", "mtime")} | {"path": str(path)})

    for row in durable_eligible[:DURABLE_MAX_DELETE]:
        path = row["path"]
        repo = origin_repo(path)
        sha = head(path)
        fresh_protected = protected_projects()
        if repo is None or repo.name != row["repo"] or sha != row["head"]:
            continue
        if fresh_protected is None or row["projectId"] in fresh_protected:
            continue
        if not clean(path) or not head_in_canonical_main(repo, sha) or open_files(path) or cwd_users(path):
            continue
        if row["linkedWorktree"]:
            removed = run(["/usr/bin/git", f"--git-dir={repo}", "worktree", "remove", str(path)])
            if removed.returncode != 0 or path.exists():
                continue
            run(["/usr/bin/git", f"--git-dir={repo}", "worktree", "prune", "--expire", "now"])
        else:
            shutil.rmtree(path)
        durable_reclaimed += int(row["bytes"])
        durable_deleted.append({k: v for k, v in row.items() if k not in ("path", "mtime")} | {"path": str(path)})

result = {
    "schemaVersion": 1,
    "mode": "APPLY" if apply else "PLAN",
    "pressure": pressure,
    "activeProjectState": "KNOWN" if active is not None else "UNKNOWN_FAIL_CLOSED",
    "protectedProjectState": "KNOWN" if protected is not None else "UNKNOWN_FAIL_CLOSED",
    "candidateCount": len(eligible),
    "candidateBytes": sum(int(row["bytes"]) for row in eligible),
    "tempDeletedCount": len(deleted),
    "deletedCount": len(deleted) + len(durable_deleted),
    "tempReclaimedLogicalBytes": reclaimed,
    "reclaimedLogicalBytes": reclaimed + durable_reclaimed,
    "durableCandidateCount": len(durable_eligible),
    "durableCandidateBytes": sum(int(row["bytes"]) for row in durable_eligible),
    "durableDeletedCount": len(durable_deleted),
    "durableReclaimedLogicalBytes": durable_reclaimed,
    "freeBefore": before,
    "freeAfter": free_bytes(),
    "targetFreeBytes": TARGET_FREE,
    "tmpBytes": du(TMP),
    "keepNewestPerRepo": KEEP_NEWEST,
    "minAgeSeconds": min_age,
    "durableKeepNewestPerRepo": DURABLE_KEEP_NEWEST,
    "durableMinAgeSeconds": durable_min_age,
    "deleted": deleted,
    "durableDeleted": durable_deleted,
}

state_write = "SKIPPED_PLAN"
if apply:
    try:
        STATE.parent.mkdir(parents=True, exist_ok=True)
        tmp = Path(str(STATE) + ".tmp")
        tmp.write_text(json.dumps(result, separators=(",", ":")) + chr(10))
        os.chmod(tmp, 0o640)
        os.replace(tmp, STATE)
        state_write = "WRITTEN"
    except PermissionError:
        state_write = "SKIPPED_PERMISSION"
    except OSError:
        state_write = "SKIPPED_IO"
result["stateWrite"] = state_write
print(json.dumps(result, ensure_ascii=False, indent=2))
