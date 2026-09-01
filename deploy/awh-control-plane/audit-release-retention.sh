#!/bin/sh
set -eu
LC_ALL=C
export LC_ALL
TARGET=${AWH_DEPLOY_TARGET:-awh-ready}
command -v ssh >/dev/null 2>&1 || { echo 'ssh is required' >&2; exit 1; }
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes "$TARGET" python3 - <<'PY'
import json
import os
from collections import defaultdict
from pathlib import Path

CONTROL = Path('/opt/awh-hub/control-releases')
WEB = Path('/var/www/awh-web/releases')
STORE = Path('/var/www/awh-web/desktop-artifacts')
CONTROL_POINTER = Path('/opt/awh-hub/control-plane-current')
WEB_POINTER = Path('/var/www/awh-web/current')
WANTED = {
    'downloads/AWH-macOS-x64.zip',
    'downloads/AWH-Windows-x64.zip',
    'downloads/SHA256SUMS.txt',
}

def pointer_id(path: Path) -> str:
    try:
        return Path(os.path.realpath(path)).name if path.is_symlink() else ''
    except OSError:
        return ''

def valid_release_dirs(root: Path):
    if not root.is_dir() or root.is_symlink():
        return []
    return [p for p in root.iterdir() if p.is_dir() and not p.is_symlink() and p.name.startswith('m')]
def collect(kind: str, root: Path):
    rows = []
    for release in valid_release_dirs(root):
        manifest = release / ('dist-web/release.json' if kind == 'control' else 'release.json')
        base = release / 'dist-web' if kind == 'control' else release
        if not manifest.is_file():
            continue
        try:
            data = json.loads(manifest.read_text())
        except Exception:
            continue
        for entry in data.get('files', []):
            relpath = entry.get('path', '')
            digest = entry.get('sha256', '')
            if relpath not in WANTED or not isinstance(digest, str) or len(digest) != 64:
                continue
            source = base / relpath
            target = STORE / f'{digest}-{Path(relpath).name}'
            if not source.is_file() or source.is_symlink() or not target.is_file() or target.is_symlink():
                continue
            source_stat = os.stat(source)
            target_stat = os.stat(target)
            rows.append({
                'kind': kind,
                'release': release.name,
                'size': source_stat.st_size,
                'source_key': (source_stat.st_dev, source_stat.st_ino),
                'source_links': source_stat.st_nlink,
                'store_key': (target_stat.st_dev, target_stat.st_ino),
            })
    return rows

rows = collect('control', CONTROL) + collect('web', WEB)
for row in rows:
    row['already_linked'] = row['source_key'] == row['store_key']
def physical_reclaim(scope: str):
    candidates = [
        row for row in rows
        if not row['already_linked'] and (scope == 'both' or row['kind'] == 'control')
    ]
    groups = defaultdict(list)
    for row in candidates:
        groups[row['source_key']].append(row)
    logical = sum(row['size'] for row in candidates)
    guaranteed = 0
    uncertain = 0
    for items in groups.values():
        size = items[0]['size']
        source_links = items[0]['source_links']
        if len(items) >= source_links:
            guaranteed += size
        else:
            uncertain += size
    return {
        'paths': len(candidates),
        'inodes': len(groups),
        'logical': logical,
        'guaranteed': guaranteed,
        'uncertain': uncertain,
    }

control = physical_reclaim('control')
both = physical_reclaim('both')
fs = os.statvfs('/')
total = fs.f_blocks * fs.f_frsize
free = fs.f_bavail * fs.f_frsize
used = total - free
predicted = max(0, used - both['guaranteed'])
print('RELEASE_RETENTION_AUDIT_SCHEMA=1')
print('CURRENT_CONTROL=' + pointer_id(CONTROL_POINTER))
print('CURRENT_WEB=' + pointer_id(WEB_POINTER))
print('POINTERS_MATCH=' + ('1' if pointer_id(CONTROL_POINTER) == pointer_id(WEB_POINTER) and pointer_id(CONTROL_POINTER) else '0'))
print('CONTROL_RELEASES=' + str(len(valid_release_dirs(CONTROL))))
print('WEB_RELEASES=' + str(len(valid_release_dirs(WEB))))
print('MATCHED_DESKTOP_PATHS=' + str(len(rows)))
print('ALREADY_STORE_LINK_PATHS=' + str(sum(1 for row in rows if row['already_linked'])))
print('CONTROL_LOGICAL_LINKABLE_BYTES=' + str(control['logical']))
print('CONTROL_GUARANTEED_RECLAIM_BYTES=' + str(control['guaranteed']))
print('CONTROL_UNCERTAIN_SHARED_BYTES=' + str(control['uncertain']))
print('BOTH_LOGICAL_LINKABLE_BYTES=' + str(both['logical']))
print('BOTH_GUARANTEED_RECLAIM_BYTES=' + str(both['guaranteed']))
print('BOTH_UNCERTAIN_SHARED_BYTES=' + str(both['uncertain']))
print('FS_TOTAL_BYTES=' + str(total))
print('FS_USED_BYTES=' + str(used))
print('FS_FREE_BYTES=' + str(free))
print('PREDICTED_USED_AFTER_BOTH_BYTES=' + str(predicted))
print('PREDICTED_USED_AFTER_BOTH_PERCENT=' + (f'{predicted / total * 100:.1f}' if total else 'UNKNOWN'))
PY
