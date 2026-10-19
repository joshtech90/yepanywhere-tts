"""Physical fixture payload; creates files only in a fresh owned UUID directory."""
import errno
import fcntl
import hashlib
import json
import os
from pathlib import Path
import socket
import sqlite3
import struct
import subprocess

run = os.environ['YA_STORAGE_RUN']
assert len(run) == 32 and all(c in '0123456789abcdef' for c in run)

def native(message):
    with socket.socket(socket.AF_UNIX) as s:
        s.settimeout(10); s.connect('\0'+os.environ['YEP_ANDROID_SAF_SOCKET'])
        header = json.dumps(message).encode(); s.sendall(struct.pack('!I',len(header))+header); s.shutdown(socket.SHUT_WR)
        def receive(size):
            data=b''
            while len(data)<size:
                part=s.recv(size-len(data)); assert part; data+=part
            return data
        return json.loads(receive(struct.unpack('!I',receive(4))[0]))

check=native({'op':'check-shared'}); roots=native({'op':'roots'})
assert roots['ok'] and roots['result']['roots']==[], 'No folder registrations are permitted in this fixture'
for invalid in ['../escape','not-a-known-volume','primary']:
    assert not native({'op':'check-volume','volume':invalid})['ok']
try: Path('/storage/not-a-known-volume').mkdir()
except PermissionError: pass
else: raise AssertionError('Protected /storage accepted a private fallback')
external=os.environ.get('YA_STORAGE_EXTERNAL_PATH','')
volume_check=native({'op':'check-volume','volume':external.split('/')[-1]}) if external else None
if os.environ['YA_STORAGE_ALLOWED']!='true':
    assert not check['ok'] and not roots['result']['sharedStorage']['mapped']
    try: Path('/sdcard/YAStorage-'+run).mkdir()
    except PermissionError: pass
    else: raise AssertionError('Unavailable /sdcard accepted a write')
    if external:
        assert not volume_check['ok']
        try: (Path(external)/('YAStorage-'+run)).mkdir()
        except PermissionError: pass
        else: raise AssertionError('Unavailable removable volume accepted a write')
    print(json.dumps({'blockedWithoutPermission':True,'nativeAdmissionRejected':True})); raise SystemExit
if os.environ.get('YA_STORAGE_INVALIDATED')=='true':
    assert check=={'ok':True,'result':{'path':'/sdcard'}}, 'Media transitions must not disable primary storage'
    assert external and not volume_check['ok'] and 'restart' in volume_check['message']
    assert any(v['path']==external and not v['mapped'] and 'restart' in v['reason'] for v in roots['result']['volumes'])
    if os.environ.get('YA_STORAGE_DISAPPEAR')=='true':
        assert Path('/storage/fixture-missing').is_dir()
        Path('/control/source').rename('/control/detached')
        try: Path('/storage/fixture-missing/fallback').write_bytes(b'forbidden')
        except OSError: pass
        else: raise AssertionError('Detached mapping accepted private writes')
        try: Path('/storage/fixture-missing').mkdir()
        except OSError: pass
        else: raise AssertionError('Detached mapping became a writable directory')
        assert not (Path('/control/detached')/'fallback').exists()
    print(json.dumps({'missingSourceHasNoPrivateFallback':True,'sameRuntimeMediaTransitionRejected':True,'primaryStillAvailable':True}));raise SystemExit
assert check=={'ok':True,'result':{'path':'/sdcard'}} and roots['result']['sharedStorage']['mapped']
if external:
    assert volume_check=={'ok':True,'result':{'path':external}}
    assert any(v['path']==external and v['mapped'] for v in roots['result']['volumes'])
paths=['/sdcard']+([external] if external else [])
results={}
for mount in paths:
    directory=Path(mount)/('YAStorage-'+run)
    existed=directory.exists()
    if existed:
        assert (directory/'ownership.txt').read_text()==run
        assert (directory/'result.bin').read_bytes()==b'HEAD'+bytes(4092)+b'TAIL'
    else:
        directory.mkdir(); (directory/'ownership.txt').write_text(run)
    with (directory/'next.bin').open('wb') as output:
        os.pwrite(output.fileno(),b'HEAD',0); os.pwrite(output.fileno(),b'TAIL',4096); os.fsync(output.fileno())
    os.replace(directory/'next.bin',directory/'result.bin')
    assert (directory/'result.bin').read_bytes()==b'HEAD'+bytes(4092)+b'TAIL'
    facts={'recoveredExistingBytes':existed,'positionalWritesRenameReplaceFsync':True}
    try:
        fd=os.open(directory,os.O_RDONLY)
        try: os.fsync(fd); facts['directoryFsync']=True
        finally: os.close(fd)
    except OSError as e: facts['directoryFsyncErrno']=e.errno
    with (directory/'lock').open('a+b') as lock:
        for name,operation in [('flock',lambda:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)),('recordLock',lambda:fcntl.lockf(lock,fcntl.LOCK_EX|fcntl.LOCK_NB))]:
            try: operation(); facts[name]=True
            except OSError as e: facts[name+'Errno']=e.errno
    try:
        (directory/'link').symlink_to('result.bin'); facts['symlink']=True; (directory/'link').unlink()
    except OSError as e: facts['symlinkErrno']=e.errno
    (directory/'result.bin').chmod(0o700); facts['modeAfterChmod']=oct((directory/'result.bin').stat().st_mode&0o777)
    case=directory/'CaseCheck';case.write_bytes(b'case');facts['caseSensitive']=not (directory/'casecheck').exists();case.unlink()
    try:
        db=sqlite3.connect(directory/'probe.sqlite',timeout=2)
        try:
            facts['sqliteJournalMode']=db.execute('pragma journal_mode=WAL').fetchone()[0]
            db.execute('create table if not exists sample (value text)');db.execute('insert into sample values (?)',(run,));db.commit()
            assert db.execute('select value from sample order by rowid desc limit 1').fetchone()[0]==run
        finally: db.close()
        facts['sqliteRoundtrip']=True
    except sqlite3.Error as e: facts['sqliteError']=str(e)
    git=['git','-c','safe.directory='+str(directory),'-c','core.filemode=false','-c','core.createObject=rename',
         '-c','user.name=Storage Probe','-c','user.email=fixture@example.invalid','-C',str(directory)]
    try:
        for args in (['init','--quiet'],['add','ownership.txt','result.bin']):
            subprocess.run([*git,*args],check=True,capture_output=True,timeout=10)
        changed=subprocess.run([*git,'diff','--cached','--quiet'],capture_output=True,timeout=10)
        assert changed.returncode in (0,1)
        if changed.returncode: subprocess.run([*git,'commit','--quiet','-m','Owned storage fixture'],check=True,capture_output=True,timeout=10)
        assert subprocess.run([*git,'status','--porcelain','--untracked-files=no'],capture_output=True,timeout=10).stdout==b''
        facts['gitRoundtrip']=True
    except subprocess.CalledProcessError as e: facts['gitError']=e.stderr.decode(errors='replace')[:300]
    facts['hashes']={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in directory.iterdir() if p.is_file()}
    results[mount]=facts
print(json.dumps({'nativeAdmissionAccepted':True,'withoutSafGrants':True,'filesystems':results}))
