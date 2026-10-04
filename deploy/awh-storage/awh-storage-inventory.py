#!/usr/bin/env python3
import argparse
import grp
import json
import os
import subprocess
import tempfile
import time
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

def collect(rows, timeout_seconds: int):
    out = {}
    by_path = {}
    paths = []
    for key, path in rows:
        if Path(path).exists():
            out[key] = {"path": path, "bytes": None, "state": "PENDING"}
            by_path[os.path.realpath(path)] = key
            paths.append(path)
        else:
            out[key] = {"path": path, "bytes": 0, "state": "ABSENT"}
    if paths:
        command = ["/usr/bin/ionice", "-c3", "/usr/bin/nice", "-n", "19",
                   "/usr/bin/du", "-sx", "--block-size=1", "--", *paths]
        timed_out = False
        try:
            result = subprocess.run(command, check=False, capture_output=True,
                                    text=True, timeout=timeout_seconds)
            stdout = result.stdout
        except subprocess.TimeoutExpired as error:
            timed_out = True
            stdout = error.stdout or ""
            if isinstance(stdout, bytes):
                stdout = stdout.decode("utf-8", "replace")
        for line in stdout.splitlines():
            parts = line.split(maxsplit=1)
            if len(parts) != 2:
                continue
            try:
                size = int(parts[0])
            except ValueError:
                continue
            key = by_path.get(os.path.realpath(parts[1]))
            if key is not None:
                out[key] = {"path": out[key]["path"], "bytes": size, "state": "OK"}
        fallback = "TIMEOUT" if timed_out else "UNREADABLE"
        for key, item in out.items():
            if item["state"] == "PENDING":
                out[key] = {"path": item["path"], "bytes": None, "state": fallback}
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
