#!/usr/bin/env python3
import argparse
import grp
import json
import os
import subprocess
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_OUTPUT = Path("/var/lib/awh-hub/storage-inventory.json")
ROOTS = [
    ("awhRemote", "/var/lib/awh-remote"),
    ("awhHub", "/var/lib/awh-hub"),
    ("awhRootDeploy", "/var/lib/awh-root-deploy"),
    ("awhGovernor", "/var/lib/awh-vps-governor"),
    ("bayProduction", "/var/lib/bay-production"),
    ("bayProductionShadow", "/var/lib/bay-production-shadow"),
    ("bayAssessment", "/var/lib/bay-assessment"),
    ("bayAssessmentStaging", "/var/lib/bay-assessment-staging"),
    ("bayGithubRunner", "/var/lib/bay-github-runner"),
    ("bayBackup", "/var/lib/baybackup"),
    ("managedSites", "/srv/awh-sites"),
    ("canonicalGit", "/srv/awh-git"),
    ("systemBackups", "/var/backups"),
    ("web", "/var/www"),
    ("logs", "/var/log"),
    ("mysql", "/var/lib/mysql"),
    ("tmp", "/tmp"),
]
AWH_REMOTE_BREAKDOWN = [
    ("worktrees", "/var/lib/awh-remote/worktrees"),
    ("operatorStaging", "/var/lib/awh-remote/operator-staging"),
    ("candidates", "/var/lib/awh-remote/candidates"),
    ("local", "/var/lib/awh-remote/.local"),
    ("cache", "/var/lib/awh-remote/.cache"),
    ("npm", "/var/lib/awh-remote/.npm"),
]

def _measure(path: str, timeout_seconds: int) -> tuple[str, int | None]:
    command = ["/usr/bin/ionice", "-c3", "/usr/bin/nice", "-n", "19",
               "/usr/bin/du", "-sx", "--block-size=1", "--", path]
    try:
        result = subprocess.run(command, check=False, capture_output=True,
                                text=True, timeout=timeout_seconds)
    except subprocess.TimeoutExpired:
        return "TIMEOUT", None
    if result.returncode != 0:
        return "UNREADABLE", None
    line = result.stdout.strip().splitlines()
    if len(line) != 1:
        return "UNREADABLE", None
    parts = line[0].split(maxsplit=1)
    if len(parts) != 2:
        return "UNREADABLE", None
    try:
        return "OK", int(parts[0])
    except ValueError:
        return "UNREADABLE", None


def collect(rows, timeout_seconds: int):
    out = {}
    pending = []
    for key, path in rows:
        if Path(path).exists():
            out[key] = {"path": path, "bytes": None, "state": "PENDING"}
            pending.append((key, path))
        else:
            out[key] = {"path": path, "bytes": 0, "state": "ABSENT"}

    # Measure roots independently so one large tree cannot starve every category
    # that follows it. Keep the scan bounded and low-priority; the hourly cache
    # means this never becomes foreground release work.
    per_path_timeout = max(2, min(timeout_seconds, 8))
    if pending:
        workers = min(2, len(pending))
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {
                pool.submit(_measure, path, per_path_timeout): (key, path)
                for key, path in pending
            }
            for future in as_completed(futures):
                key, path = futures[future]
                try:
                    state, size = future.result()
                except Exception:
                    state, size = "UNREADABLE", None
                out[key] = {"path": path, "bytes": size, "state": state}

    total = sum(int(item["bytes"] or 0) for item in out.values() if item["state"] == "OK")
    complete = all(item["state"] in {"OK", "ABSENT"} for item in out.values())
    return out, total, complete

def fs_bytes() -> dict:
    st = os.statvfs("/")
    total = st.f_blocks * st.f_frsize
    free = st.f_bavail * st.f_frsize
    return {"totalBytes": total, "freeBytes": free, "usedBytes": max(0, total - free)}

def atomic_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=path.name + ".", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(name, 0o640)
        if os.geteuid() == 0:
            os.chown(name, 0, grp.getgrnam("awh-hub").gr_gid)
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT))
    parser.add_argument("--max-age-seconds", type=int, default=3600)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    output = Path(args.output)
    if not args.force and output.is_file() and args.max_age_seconds > 0:
        age = max(0, time.time() - output.stat().st_mtime)
        if age < args.max_age_seconds:
            return 0

    filesystem = fs_bytes()
    categories, attributed, complete = collect(ROOTS, 18)
    remote_breakdown, _, remote_complete = collect(AWH_REMOTE_BREAKDOWN, 10)
    used = int(filesystem["usedBytes"])
    unattributed = max(0, used - attributed)
    payload = {
        "schemaVersion": 1,
        "checkedAt": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
        "filesystem": filesystem,
        "categories": categories,
        "awhRemoteBreakdown": remote_breakdown,
        "attributedBytes": attributed,
        "unattributedBytes": unattributed,
        "inventoryComplete": bool(complete and remote_complete),
        "unattributedMeaning": "filesystem overhead, protected or uncategorized data; never assume it is reclaimable",
    }
    atomic_json(output, payload)
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
