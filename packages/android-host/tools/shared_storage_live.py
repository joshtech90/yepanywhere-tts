#!/usr/bin/env python3
"""Physical primary-storage acceptance and optional removable-volume investigation.

Only the separately identified workspace fixture app and fresh YAStorage-<UUID>
directories are mutable. Device selectors, volume identities, recovery receipts,
raw inventories and logs stay under ignored .local. Never formats/ejects a card.
"""
import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import time
import uuid
import xml.etree.ElementTree as ET

HOST=Path(__file__).resolve().parents[1]
APP='com.yepanywhere.host.workspace.acceptance'


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--device-file',type=Path,required=True)
    parser.add_argument('--registry',type=Path,required=True)
    parser.add_argument('--target',required=True)
    parser.add_argument('--model',required=True)
    parser.add_argument('--external',action='store_true')
    parser.add_argument('--ui',action='store_true',help='Verify real host start, native mapped-volume status and 16-root sequential typing')
    parser.add_argument('--headless-permission',action='store_true',help='Set only the disposable fixture all-files app-op; no UI/keyguard changes')
    parser.add_argument('--resume',type=Path)
    args=parser.parse_args()
    assert not (args.ui and args.headless_permission), 'Native UI acceptance requires an unlocked display'
    serial=json.loads(args.device_file.read_text())['serial'];adb=['adb','-s',serial]
    run_id=args.resume.name if args.resume else uuid.uuid4().hex
    assert re.fullmatch('[a-f0-9]{32}',run_id)
    evidence=HOST/'.local/shared-storage-live'/run_id;evidence.mkdir(parents=True,mode=0o700,exist_ok=bool(args.resume))
    lease=evidence/'recovery.json'
    resource=json.loads(lease.read_text()) if args.resume else {'serial':serial,'app':APP,'installed':False,'paths':[]}
    assert resource['serial']==serial and resource['app']==APP
    def receipt():lease.write_text(json.dumps(resource,indent=2));lease.chmod(0o600)
    receipt()
    mc=[str(HOST.parents[2]/'machine-control/bin/machine-control'),'--registry',str(args.registry.resolve()),'--target',args.target]
    def execute(words,data=None,timeout=120,check=True):
        r=subprocess.run(words,input=data,capture_output=True,timeout=timeout)
        if check and r.returncode:
            (evidence/'operation-error.log').write_bytes(r.stdout+r.stderr);raise RuntimeError('Operation failed; private error log retained')
        return r
    def shell(*words,**kw):return execute([*adb,'shell',shlex.join(words)],**kw)
    def common(*words):return execute([*mc,*words]).stdout
    def read(path):return shell('run-as',APP,'cat',path).stdout
    transfer=None
    def stage():
        nonlocal transfer
        if transfer is None:
            info=json.loads((HOST/'.local/runtime-info.json').read_text())
            raw=HOST/'.local/runtime.tar'
            with raw.open('rb') as payload:assert hashlib.file_digest(payload,'sha256').hexdigest()==info['payloadSha256']
            transfer=HOST/'.local'/('storage-transfer-'+info['payloadSha256']+'.tar.gz')
            if not transfer.exists():
                temporary=transfer.with_suffix('.next')
                with raw.open('rb') as payload,gzip.open(temporary,'wb',compresslevel=1) as output:shutil.copyfileobj(payload,output,1024*1024)
                temporary.replace(transfer)
            with gzip.open(transfer,'rb') as payload:assert hashlib.file_digest(payload,'sha256').hexdigest()==info['payloadSha256']
        shell('run-as',APP,'mkdir','-p','files/runtime','files/state')
        with transfer.open('rb') as payload:
            r=subprocess.run([*adb,'shell','-T',shlex.join(['run-as',APP,'tar','-xzf','-','-C','files/runtime'])],stdin=payload,capture_output=True,timeout=240)
            assert r.returncode==0,'Fixture runtime extraction failed'
        shell('run-as',APP,'chmod','4755','files/runtime/usr/bin/sudo')
        shell('run-as',APP,'tee','files/storage-probe.py',data=(HOST/'test/shared_storage_probe.py').read_bytes())
    def probe(op='probe',external=False,label='probe'):
        r=shell('am','instrument','-w','-e','op',op,'-e','run',run_id,'-e','external',str(external).lower(),APP+'/com.yepanywhere.host.SharedStorageProbe')
        (evidence/(label+'.log')).write_bytes(r.stdout+r.stderr)
        if b'SHARED_STORAGE_PASS' not in r.stdout:
            (evidence/'guest-error.log').write_bytes(shell('run-as',APP,'cat','files/storage-probe-error.log',check=False).stdout)
            raise AssertionError('Native storage probe failed; private logs retained')
        facts=json.loads(read('files/storage-probe.json'));(evidence/(label+'.json')).write_text(json.dumps(facts,indent=2));return facts
    def nodes():
        remote='/data/local/tmp/ya-storage-'+run_id+'.xml'
        try:
            shell('uiautomator','dump',remote)
            data=shell('cat',remote).stdout;(evidence/'ui.xml').write_bytes(data)
            return list(ET.fromstring(data).iter('node'))
        finally:shell('rm','-f',remote)
    def tap_label(prefix):
        control=next(n for n in nodes() if n.get('text','').startswith(prefix))
        x1,y1,x2,y2=map(int,re.findall(r'\d+',control.get('bounds')));shell('input','tap',str((x1+x2)//2),str((y1+y2)//2))
    def permission(enabled):
        if args.headless_permission:
            shell('appops','set','--uid',APP,'MANAGE_EXTERNAL_STORAGE','allow' if enabled else 'default');return
        shell('am','start','-W','-a','android.settings.MANAGE_APP_ALL_FILES_ACCESS_PERMISSION','-d','package:'+APP)
        controls=[n for n in nodes() if n.get('checkable')=='true']
        assert len(controls)==1,'All-files Settings toggle not uniquely identified'
        control=controls[0]
        if control.get('checked')!=str(enabled).lower():
            x1,y1,x2,y2=map(int,re.findall(r'\d+',control.get('bounds')));shell('input','tap',str((x1+x2)//2),str((y1+y2)//2))
        assert [n.get('checked') for n in nodes() if n.get('checkable')=='true']==[str(enabled).lower()]
    def verify(facts):
        for mount,observed in facts['probe']['filesystems'].items():
            path=next(p['path'] for p in resource['paths'] if p['mount']==mount)
            assert shell('cat',path+'/ownership.txt').stdout==run_id.encode()
            assert shell('cat',path+'/result.bin').stdout==b'HEAD'+bytes(4092)+b'TAIL'
            for name,digest in observed['hashes'].items():assert hashlib.sha256(shell('cat',path+'/'+name).stdout).hexdigest()==digest
    def remove_owned():
        for item in resource['paths']:
            path=item['path'];assert Path(path).name=='YAStorage-'+run_id
            if shell('test','-e',path,check=False).returncode==0:
                assert shell('cat',path+'/ownership.txt').stdout==run_id.encode()
                shell('rm','-rf',path);assert shell('test','-e',path,check=False).returncode==1
    success=False
    try:
        doctor_result=execute([*mc,'target','doctor'],check=False)
        (evidence/'doctor.json').write_bytes(doctor_result.stdout)
        doctor=json.loads(doctor_result.stdout)
        if args.headless_permission:
            assert all(doctor['states'][s]=='ready' for s in ('connection','boot','administration'))
            assert doctor['extensions']['userStorage']=='unlocked'
        else: assert doctor['ready']
        assert shell('getprop','ro.product.model').stdout.decode().strip()==args.model
        apk=HOST/'.local/shared-storage/fixture.apk'
        sdk=Path(os.environ.get('ANDROID_HOME',Path.home()/'Library/Android/sdk'))
        aapt=sorted(sdk.glob('build-tools/*/aapt'))[-1]
        assert 'A: package="'+APP+'"' in execute([str(aapt),'dump','xmltree',str(apk),'AndroidManifest.xml']).stdout.decode()
        if args.resume:
            common('testbed','--','stop',APP);remove_owned()
            if resource['installed']:execute([*adb,'uninstall',APP]);resource['installed']=False;receipt()
            resource['paths']=[];receipt()
        else:assert not shell('pm','list','packages','--user','0',APP).stdout.strip(),'Fixture package already exists'
        common('testbed','--','install',str(apk));resource['installed']=True;receipt()
        initial=probe('inventory',label='inventory-before');assert not initial['allFiles'] and initial['persistedGrants']==0
        chosen=[v for v in initial['volumes'] if v['primary']]
        assert len(chosen)==1
        resource['paths']=[{'mount':'/sdcard','path':chosen[0]['directory']+'/YAStorage-'+run_id}]
        if args.external:
            chosen=[v for v in initial['volumes'] if v['removable'] and v['state']=='mounted']
            assert len(chosen)==1
            resource['paths'].append({'mount':'/storage/'+chosen[0]['uuid'],'path':chosen[0]['directory']+'/YAStorage-'+run_id})
        receipt()
        for item in resource['paths']:assert shell('test','-e',item['path'],check=False).returncode==1
        stage();assert probe(external=args.external,label='blocked-before')['probe']['blockedWithoutPermission']
        permission(True)
        first=probe(external=args.external,label='enabled');assert first['allFiles'] and first['persistedGrants']==0;verify(first)
        second=probe(external=args.external,label='process-restart');verify(second)
        assert all(p['recoveredExistingBytes'] for p in second['probe']['filesystems'].values())
        if args.external:
            transition=probe(op='transition',external=True,label='media-transition')
            assert transition['transition']['sameRuntimeMediaTransitionRejected'] and transition['transition']['primaryStillAvailable']
            verify(transition);second=transition
        permission(False);assert probe(external=args.external,label='revoked')['probe']['blockedWithoutPermission'];verify(second)
        common('testbed','--','stop',APP);assert shell('pm','clear','--user','0',APP).stdout.strip()==b'Success'
        # Data clear erases the fixture runtime/registry, never external bytes.
        verify(second);stage();permission(True)
        recovered=probe(external=args.external,label='data-clear-recovery');verify(recovered)
        assert recovered['persistedGrants']==0 and all(p['recoveredExistingBytes'] for p in recovered['probe']['filesystems'].values())
        if args.ui:
            typed=shell('am','instrument','-w',APP+'/com.yepanywhere.host.WorkspaceTypingProbe')
            (evidence/'typing.log').write_bytes(typed.stdout+typed.stderr)
            assert b'WORKSPACE_TYPING_PASS' in typed.stdout
            (evidence/'typing.json').write_bytes(read('files/typing.json'))
            common('testbed','--','launch',APP);tap_label('Start local host')
            deadline=time.monotonic()+60
            while time.monotonic()<deadline:
                if any(n.get('text','')=='Local host running' for n in nodes()):break
                time.sleep(.25)
            else:
                (evidence/'host-error.log').write_bytes(shell('run-as',APP,'cat','files/host.log',check=False).stdout)
                raise AssertionError('Fixture host did not become ready; private host-error.log retained')
            tap_label('Workspace folders')
            deadline=time.monotonic()+30
            while time.monotonic()<deadline:
                texts=[n.get('text','') for n in nodes()]
                primary=any('/sdcard' in t and 'mapped for this runtime' in t for t in texts)
                removable=any('/storage/' in t and 'mapped for this runtime' in t for t in texts)
                if primary and (not args.external or removable):break
                time.sleep(.25)
            else:raise AssertionError('Native status did not confirm production host mappings')
            common('testbed','--','screenshot',str(evidence/'mapped-volumes.png'))
        summary={'model':args.model,'permissionRoute':'fixture app-op' if args.headless_permission else 'Android Settings','primaryNoPickerNoSafGrant':True,'blockedAndRevocationPassed':True,'processRestartAndDataClearRecovery':True,
                 'independentBytesAndHashes':True,'removableMapped':args.external,'nativeHostUiPassed':args.ui,
                 'filesystems':{k:{n:v for n,v in f.items() if n not in ('hashes','gitError','sqliteError')} for k,f in recovered['probe']['filesystems'].items()}}
        (evidence/'summary.json').write_text(json.dumps(summary,indent=2));success=True
    finally:
        if resource['installed']:common('testbed','--','stop',APP)
        if success:
            remove_owned();execute([*adb,'uninstall',APP]);resource['installed']=False;resource['paths']=[];receipt();lease.unlink()
            summary['cleanupComplete']=True;(evidence/'summary.json').write_text(json.dumps(summary,indent=2));print(json.dumps(summary,indent=2))
        else:print('Stopped fixture; exact resources and private recovery receipt retained.')


if __name__=='__main__':main()
