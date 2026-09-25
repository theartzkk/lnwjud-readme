import importlib.util
import sys
sys.dont_write_bytecode=True
from collections import namedtuple
from pathlib import Path

engine=Path(__file__).resolve().parents[2] / 'deploy' / 'learnlab' / 'awh-learnlab-release-engine.py'
spec=importlib.util.spec_from_file_location('awh_learnlab_release_engine',engine)
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

Disk=namedtuple('usage','total used free')
orig=mod.shutil.disk_usage
try:
    mod.shutil.disk_usage=lambda _: Disk(10*1024**3, int(8.9*1024**3), int(1.1*1024**3))
    ok=mod.storage_gate()
    assert ok['usedPercent']==89
    mod.shutil.disk_usage=lambda _: Disk(10*1024**3, int(9.0*1024**3), int(1.0*1024**3))
    try:
        mod.storage_gate()
        raise AssertionError('90% did not block')
    except mod.ReleaseError as exc:
        assert exc.code=='LEARNLAB_RELEASE_STORAGE_BLOCKED'
    mod.shutil.disk_usage=lambda _: Disk(10*1024**3, int(9.5*1024**3), int(0.5*1024**3))
    try:
        mod.storage_gate()
        raise AssertionError('95% did not block')
    except mod.ReleaseError as exc:
        assert exc.code=='LEARNLAB_RELEASE_STORAGE_BLOCKED'
finally:
    mod.shutil.disk_usage=orig
print('AWH LearnLab release storage gate: PASS')
