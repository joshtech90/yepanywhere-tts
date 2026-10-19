#!/usr/bin/env python3
"""Physical local-workspace acceptance. Mutates only a new disposable app/tree.

Requires a prebuilt fixture APK, verified YA runtime, explicit private device
selection and an existing authorized AAR checkout for both real providers.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import xml.etree.ElementTree as ET

HERE = Path(__file__).resolve().parent
HOST = HERE.parent
APP = 'com.yepanywhere.host.workspace.spike'
JAVA = 'com.yepanywhere.host.workspacespike'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--device-file', type=Path, required=True, help='Private JSON with explicitly selected serial')
    parser.add_argument('--machine-control', type=Path, required=True)
    parser.add_argument('--aar-checkout', type=Path, required=True)
    parser.add_argument('--resume', type=Path, help='Private failed-run directory; replaces only its fixture APK')
    parser.add_argument('--recovery-only', action='store_true', help='With --resume, retain proved bytes and continue permission/reset acceptance')
    args = parser.parse_args()
    assert not args.recovery_only or args.resume, '--recovery-only requires --resume'
    serial = json.loads(args.device_file.read_text())['serial']
    adb = ['adb', '-s', serial]
    run_id = args.resume.name if args.resume else uuid.uuid4().hex
    assert re.fullmatch('[a-f0-9]{32}', run_id), 'Invalid run identity'
    evidence = HOST/'.local/workspace-spike'/run_id; evidence.mkdir(mode=0o700, exist_ok=bool(args.resume))
    tree = '/sdcard/Documents/YAWorkspaceSpike-'+run_id
    initial = 'content://com.android.externalstorage.documents/document/'+urllib.parse.quote('primary:Documents/YAWorkspaceSpike-'+run_id, safe='')
    mc = args.machine_control.resolve(); aar_root = args.aar_checkout.resolve()
    apk = HERE/'build/outputs/apk/debug/workspace-spike-debug.apk'
    registry = evidence/'targets.json'
    registry.write_text(json.dumps({'schema':'machine-control-targets/v0', 'includeDefaults':False, 'targets':{
        'workspace-phone':{'platform':'android','profile':'android-handheld-adb','interface':'native', 'controllerPlatforms':['darwin','linux'],
                           'launcher':'direct','command':[str(mc/'platforms/android/bin/android-device'),'--serial',serial]}}}))
    registry.chmod(0o600)
    control = [str(mc/'bin/machine-control'), '--registry', str(registry), '--target', 'workspace-phone']
    recovery = {'serial':serial, 'tree':tree, 'application':APP, 'ownedTree':False, 'installed':False, 'reversePort':None, 'client':None}
    lease = evidence/'recovery.json'
    if args.resume:
        previous = json.loads(lease.read_text())
        assert previous['serial'] == serial and previous['application'] == APP and previous['tree'] == tree
        assert not previous['client'] and not previous['reversePort'], 'Clean inference authority before resuming'
        recovery = previous
    def receipt():
        lease.write_text(json.dumps(recovery, indent=2)+'\n'); lease.chmod(0o600)
    receipt()
    def run(*words, data=None, timeout=120, check=True):
        result = subprocess.run([*adb,*words], input=data, capture_output=True, timeout=timeout)
        if check and result.returncode != 0:
            (evidence/'device-error.log').write_bytes(result.stdout+result.stderr)
            raise RuntimeError('Device command failed; inspect private device-error.log')
        return result
    def shell(*words, **kwargs): return run('shell', shlex.join(words), **kwargs).stdout.decode().strip()
    def read(path): return run('shell','-T','run-as',APP,'cat',path).stdout
    def write(path, data):
        run('shell','-T','run-as',APP,'tee',path,data=data)
        shell('run-as',APP,'chmod','600',path)
    def common(*words):
        r = subprocess.run([*control,*words], capture_output=True, text=True, check=True, timeout=120)
        return r.stdout
    def aar(*words, body=None):
        return subprocess.check_output(['node',str(aar_root/'src/cli.ts'),*words],input=body,text=True,cwd=aar_root,stderr=subprocess.PIPE,timeout=30)
    def nodes():
        remote = '/data/local/tmp/ya-workspace-'+run_id+'.xml'
        try:
            shell('uiautomator','dump',remote)
            xml = run('exec-out','cat',remote).stdout
            (evidence/'latest-ui.xml').write_bytes(xml)
            return list(ET.fromstring(xml).iter('node'))
        finally: shell('rm','-f',remote)
    def tap(label):
        matches = [n for n in nodes() if n.get('text','').casefold() == label.casefold() or n.get('content-desc','').casefold() == label.casefold()]
        assert matches, 'Missing UI control '+label+'; inspect private latest-ui.xml'
        x1,y1,x2,y2 = map(int,re.findall(r'\d+',matches[-1].get('bounds')))
        shell('input','tap',str((x1+x2)//2),str((y1+y2)//2))
    def activity():
        shell('am','start','-W','-f','0x10008000','-n',APP+'/'+JAVA+'.WorkspaceActivity','--es','initialTree',initial)
    def selection():
        activity()
        return json.loads(read('files/selection.json'))
    def permission(enabled):
        activity(); tap('All-files access')
        screen = nodes(); switches = [n for n in screen if n.get('checkable') == 'true']
        assert any(n.get('text') == 'Allow access to manage all files' for n in screen)
        assert any(n.get('text') == 'YA Workspace Spike' for n in screen)
        assert len(switches) == 1, 'Expected exact all-files permission switch'
        if (switches[0].get('checked') == 'true') != enabled:
            node = switches[0]; x1,y1,x2,y2 = map(int,re.findall(r'\d+',node.get('bounds')))
            shell('input','tap',str((x1+x2)//2),str((y1+y2)//2))
        screen = nodes(); switches = [n for n in screen if n.get('checkable') == 'true']
        assert len(switches) == 1 and (switches[0].get('checked') == 'true') == enabled
        activity()
    def choose():
        activity(); tap('Choose local folder')
        assert any(n.get('text') == 'YAWorkspaceSpike-'+run_id for n in nodes()), 'Picker did not open the exact owned folder'
        tap('Use this folder'); tap('Allow'); activity()
    def stage():
        shell('run-as',APP,'mkdir','-p','files/runtime','files/state')
        with (HOST/'.local/runtime.tar').open('rb') as payload:
            result = subprocess.run([*adb,'shell','-T','run-as',APP,'tar','-xf','-','-C','files/runtime'],stdin=payload,capture_output=True,timeout=240)
            assert result.returncode == 0, 'Runtime extraction failed'
        write('files/state/probe.py',(HERE/'probe.py').read_bytes())
    def instrument(phase, accepted=True):
        started = time.monotonic()
        result = run('shell','am','instrument','-w','-e','phase',phase,'-e','sentinel',run_id,APP+'/'+JAVA+'.WorkspaceProbe',timeout=450,check=False)
        (evidence/('instrument-'+phase+'-'+str(time.monotonic_ns())+'.log')).write_bytes(result.stdout+result.stderr)
        passed = b'WORKSPACE_PASS '+phase.encode() in result.stdout
        assert passed == accepted, 'Unexpected instrumentation result; inspect private evidence'
        if not accepted: assert b'WORKSPACE_REFUSED' in result.stdout, 'Expected explicit refusal, not a crash'
        if accepted and phase != 'authority':
            (evidence/('guest-'+phase+'.log')).write_bytes(read('files/state/probe-'+phase+'.log'))
        return round(time.monotonic()-started, 2)
    def external_hashes():
        # Independent Android shell reader, outside the app UID, PRoot and provider output.
        result = {}
        names = run('exec-out','find',tree,'-type','f').stdout.decode().splitlines()
        for name in sorted(names):
            relative = name[len(tree)+1:]
            assert name.startswith(tree+'/') and relative
            result[relative] = hashlib.sha256(run('exec-out','cat',name).stdout).hexdigest()
        return result
    success = False; token = None; expected = None; summary = {}
    try:
        doctor = json.loads(common('target','doctor')); assert doctor['ready']
        assert shell('getprop','ro.product.model') == 'Pixel 7a', 'Refusing another model'
        before = {key:shell('settings','--user','0','get','secure',key) for key in ('enabled_accessibility_services','accessibility_enabled')}
        if args.recovery_only:
            assert recovery['installed'] and recovery['ownedTree']
            assert run('exec-out','cat',tree+'/selection-witness.txt').stdout == run_id.encode()
            expected = json.loads((evidence/'hashes.json').read_text())
            facts = json.loads((evidence/'semantics.json').read_text())
            assert external_hashes() == expected, 'External bytes changed since provider acceptance'
            assert json.loads((evidence/'providers.json').read_text())
            common('testbed','--','install',str(apk))
            write('files/state/probe.py',(HERE/'probe.py').read_bytes())
            write('files/state/expected.json',json.dumps(expected).encode())
            summary['continuedPriorProviderEvidence']=True
            print('Retained provider evidence and independently reverified all external hashes.',flush=True)
        else:
            if not args.resume:
                assert not shell('pm','list','packages','--user','0',APP), 'Refusing an existing fixture installation'
                assert run('shell','test','-e',tree,check=False).returncode == 1, 'Fixture tree already exists'
            else:
                assert run('exec-out','cat',tree+'/selection-witness.txt').stdout == run_id.encode()
                # The receipt and sentinel authorize replacing only this failed fixture tree.
                shell('rm','-rf',tree)
                shell('run-as',APP,'rm','-rf','files/state')
                shell('run-as',APP,'mkdir','files/state')
            assert apk.is_file() and (HOST/'.local/runtime.tar').is_file()
            shell('mkdir',tree)
            recovery['ownedTree']=True; receipt()
            run('shell','-T','tee',tree+'/selection-witness.txt',data=run_id.encode())
            common('testbed','--','install',str(apk)); recovery['installed']=True; receipt()
            if args.resume:
                write('files/state/probe.py',(HERE/'probe.py').read_bytes())
            else: stage()
            print('Installed disposable fixture and staged shared Alpine payload.',flush=True)
            common('testbed','--','launch',APP)
            if args.resume: permission(False)
            choose(); unavailable = selection(); assert not unavailable['available'] and 'All-files' in unavailable['reason']
            instrument('verify',accepted=False)
            permission(True); selected = selection(); assert selected['available']
            common('testbed','--','screenshot',str(evidence/'ready.png'))
            print('Actual folder selection and separate all-files consent completed.',flush=True)
            summary['semanticsSeconds'] = instrument('semantics')
            facts = json.loads(read('files/state/semantics.json')); (evidence/'semantics.json').write_text(json.dumps(facts,indent=2)+'\n')
            expected = json.loads(read('files/state/expected.json')); assert external_hashes() == expected
            print('Filesystem semantics passed with independently verified external hashes.',flush=True)
            overview = json.loads(aar('owner-request','overview',body='{}'))
            assert overview['origin'] == 'http://127.0.0.1:8417'
            accounts = {p:next(a['id'] for a in overview['accounts'] if a['provider']==p and a['enabled']) for p in ('claude','codex')}
            name = 'ya-workspace-spike-'+run_id
            created = aar('client','add',name,'--claude',accounts['claude'],'--codex',accounts['codex'])
            token = re.findall(r'\baar_[A-Za-z0-9_-]{43}\b',created)[0]
            recovery['client']=name; recovery['token']=token; receipt()
            mappings = run('reverse','--list').stdout.decode()
            port = next(p for p in range(18520,18620) if 'tcp:'+str(p) not in mappings)
            run('reverse','tcp:'+str(port),'tcp:8417'); recovery['reversePort']=port; receipt()
            write('files/state/inference.json',json.dumps({'endpoint':'http://127.0.0.1:'+str(port),'token':token}).encode())
            summary['providersSeconds'] = instrument('providers')
            (evidence/'providers.json').write_bytes(read('files/state/providers.json'))
            for provider in ('codex','claude'):
                for filename in ('events.json','stderr.log'):
                    (evidence/(provider+'-'+filename)).write_bytes(read('files/state/'+provider+'/'+filename))
            expected = json.loads(read('files/state/expected.json')); assert external_hashes() == expected
            (evidence/'hashes.json').write_text(json.dumps(expected,indent=2)+'\n')
            print('Both real providers wrote external text and random-access files; independent hashes match.',flush=True)
        common('testbed','--','stop',APP); activity(); instrument('verify')
        summary['restartVerified']=True
        activity(); tap('Revoke folder grant'); assert not selection()['available']; instrument('verify',accepted=False)
        assert external_hashes() == expected
        instrument('authority'); raw = json.loads(read('files/authority.json'))
        assert raw == {'rawReadable':True,'allFiles':True}
        summary['safRevocationLeavesRawAuthority']=raw
        choose(); assert selection()['available']; instrument('verify')
        summary['safRevocationRepair']=True
        permission(False); assert not selection()['available']; instrument('verify',accepted=False)
        assert external_hashes() == expected
        instrument('authority'); raw = json.loads(read('files/authority.json'))
        assert raw == {'rawReadable':False,'allFiles':False}
        summary['allFilesRevocationRemovesRawAuthority']=raw
        permission(True); assert selection()['available']; instrument('verify')
        summary['allFilesRevocationRepair']=True
        for recovery_mode in ('clear-data','reinstall'):
            common('testbed','--','stop',APP)
            if recovery_mode == 'clear-data': assert shell('pm','clear','--user','0',APP) == 'Success'
            else:
                assert run('uninstall',APP).stdout.strip() == b'Success'
                recovery['installed']=False; receipt()
                common('testbed','--','install',str(apk)); recovery['installed']=True; receipt()
            assert run('shell','run-as',APP,'test','-e','files/selection.json',check=False).returncode == 1
            assert external_hashes() == expected
            stage(); choose()
            if not selection()['available']: permission(True)
            assert selection()['available']
            write('files/state/expected.json',json.dumps(expected).encode())
            instrument('verify'); assert external_hashes() == expected
            summary[recovery_mode+'Recovery']=True
            print(recovery_mode+' recovery passed with identical external hashes.',flush=True)
        after = {key:shell('settings','--user','0','get','secure',key) for key in before}; assert before == after
        summary.update(independentlyVerifiedFiles=len(expected), accessibilityUnchanged=True, semantics=facts)
        success = True
    finally:
        errors = []
        if recovery['client']:
            try:
                aar('client','revoke',recovery['client'])
                for provider in ('claude','codex'):
                    path = 'v1/models' if provider=='claude' else 'models'
                    request = urllib.request.Request('http://127.0.0.1:8417/'+provider+'/'+path,headers={'Authorization':'Bearer '+token})
                    try:
                        urllib.request.urlopen(request,timeout=5).close(); raise RuntimeError('Revoked grant accepted')
                    except urllib.error.HTTPError as error: assert error.code == 401
                recovery['client']=None; recovery.pop('token',None); receipt()
            except Exception as error: errors.append('inference revocation: '+type(error).__name__)
        if recovery['reversePort']:
            try:
                run('reverse','--remove','tcp:'+str(recovery['reversePort'])); recovery['reversePort']=None; receipt()
            except Exception as error: errors.append('owned reverse cleanup: '+type(error).__name__)
        if recovery['installed']:
            try: common('testbed','--','stop',APP)
            except Exception as error: errors.append('fixture stop: '+type(error).__name__)
        if success and not errors:
            assert read('files/selection.json')
            assert external_hashes() == expected
            assert run('uninstall',APP).stdout.strip() == b'Success'
            recovery['installed']=False; receipt()
            # Delete only the exclusively created UUID tree after checking its sentinel.
            assert run('exec-out','cat',tree+'/selection-witness.txt').stdout == run_id.encode()
            shell('rm','-rf',tree)
            assert run('shell','test','-e',tree,check=False).returncode == 1
            recovery['ownedTree']=False; receipt()
            summary['cleanupComplete']=True
            (evidence/'summary.json').write_text(json.dumps(summary,indent=2)+'\n'); lease.unlink()
            print(json.dumps(summary,indent=2),flush=True)
        else:
            print('Private recovery receipt retained; fixture stopped and external files preserved.',flush=True)
        if errors: raise RuntimeError('; '.join(errors))


if __name__ == '__main__': main()
