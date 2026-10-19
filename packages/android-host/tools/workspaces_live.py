#!/usr/bin/env python3
"""End-to-end native host workspace acceptance on an explicitly selected Pixel.

Uses only the separately built -PworkspaceFixture app and two exclusively owned
UUID folders (three in --picker-only mode). Never clears or stages the signed-in
host. Private recovery leases retain exact owned resources on failure; --resume
replaces only those fixtures.
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

HOST = Path(__file__).resolve().parents[1]
APP = 'com.yepanywhere.host.workspace.acceptance'
JAVA = 'com.yepanywhere.host'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--device-file', type=Path, required=True)
    parser.add_argument('--machine-control', type=Path, required=True)
    parser.add_argument('--aar-checkout', type=Path)
    parser.add_argument('--picker-only', action='store_true', help='Native picker/naming acceptance without runtime or providers')
    parser.add_argument('--model', choices=('Pixel 7a','Pixel 9'), default='Pixel 7a')
    parser.add_argument('--resume', type=Path)
    args = parser.parse_args()
    if not args.picker_only and args.aar_checkout is None: parser.error('--aar-checkout is required for full acceptance')
    serial = json.loads(args.device_file.read_text())['serial']
    adb = ['adb', '-s', serial]
    run_id = args.resume.name if args.resume else uuid.uuid4().hex
    assert re.fullmatch('[a-f0-9]{32}', run_id)
    evidence = HOST/'.local/workspaces-live'/run_id; evidence.mkdir(mode=0o700, parents=True, exist_ok=bool(args.resume))
    trees = {'docs':'/sdcard/Documents/YAWorkspaces-'+run_id, 'downloads':'/sdcard/Download/YAWorkspaces-'+run_id}
    if args.picker_only:
        trees={alias:'/sdcard/'+parent+'/YA Shared '+run_id for alias,parent in (('docs','Documents'),('downloads','Download'),('third','Pictures'))}
    lease = evidence/'recovery.json'
    resources = {'application':APP, 'serial':serial, 'trees':trees, 'owned':[], 'installed':False, 'client':None, 'reverse':None, 'forward':None}
    if args.resume:
        resources = json.loads(lease.read_text())
        assert resources['application']==APP and resources['serial']==serial and resources['trees']==trees
        assert not resources['client'] and not resources['reverse'] and not resources['forward']
    def receipt(): lease.write_text(json.dumps(resources,indent=2)+'\n'); lease.chmod(0o600)
    receipt()
    registry = evidence/'targets.json'
    registry.write_text(json.dumps({'schema':'machine-control-targets/v0','includeDefaults':False,'targets':{'workspace-phone':{
        'platform':'android','profile':'android-handheld-adb','interface':'native','controllerPlatforms':['darwin','linux'],
        'launcher':'direct','command':[str(args.machine_control.resolve()/'platforms/android/bin/android-device'),'--serial',serial]}}}))
    registry.chmod(0o600)
    mc = [str(args.machine_control.resolve()/'bin/machine-control'),'--registry',str(registry),'--target','workspace-phone']
    apk = HOST/'.local/workspaces-fixture.apk'
    def run(*words, data=None, check=True, timeout=120):
        # ADB sends shell/exec-out arguments through the remote shell. Preserve
        # spaces in picked folder names instead of letting that shell split them.
        if words and words[0] in ('shell','exec-out'):
            prefix=list(words[:1]); command=list(words[1:])
            if command and command[0]=='-T': prefix.append(command.pop(0))
            if len(command)>1: command=[shlex.join(command)]
            words=(*prefix,*command)
        result = subprocess.run([*adb,*words],input=data,capture_output=True,timeout=timeout)
        if check and result.returncode:
            (evidence/'device-error.log').write_bytes(result.stdout+result.stderr)
            raise RuntimeError('Device operation failed; inspect private device-error.log')
        return result
    def shell(*words, **kwargs): return run('shell',shlex.join(words),**kwargs).stdout.decode().strip()
    def common(*words): return subprocess.check_output([*mc,*words],timeout=120)
    def read(path): return run('shell','-T','run-as',APP,'cat',path).stdout
    def write(path, data): run('shell','-T','run-as',APP,'tee',path,data=data)
    def aar(*words, body=None):
        return subprocess.check_output(['node',str(args.aar_checkout.resolve()/'src/cli.ts'),*words],input=body,text=True,cwd=args.aar_checkout,stderr=subprocess.PIPE,timeout=30)
    def nodes():
        remote = '/data/local/tmp/ya-workspaces-'+run_id+'.xml'
        try:
            shell('uiautomator','dump',remote)
            xml = run('exec-out','cat',remote).stdout; (evidence/'ui.xml').write_bytes(xml)
            return list(ET.fromstring(xml).iter('node'))
        finally: shell('rm','-f',remote)
    def tap(label, scroll=False):
        for attempt in range(8 if scroll else 1):
            matches = [n for n in nodes() if n.get('text','').casefold()==label.casefold() or n.get('resource-id','').endswith('/'+label)]
            matches = [n for n in matches if n.get('bounds')!='[0,0][0,0]']
            if matches:
                x1,y1,x2,y2 = map(int,re.findall(r'\d+',matches[-1].get('bounds')))
                if y2>y1 and x2>x1:
                    shell('input','tap',str((x1+x2)//2),str((y1+y2)//2)); return
            if scroll: shell('input','swipe','900','1900','900','650','220')
        raise AssertionError('Missing UI control '+label+'; inspect private ui.xml')
    def activity(alias='docs'):
        relative=trees[alias].removeprefix('/sdcard/'); uri='content://com.android.externalstorage.documents/document/'+urllib.parse.quote('primary:'+relative,safe='')
        shell('am','start','-W','-f','0x10008000','-n',APP+'/'+JAVA+'.HostActivity','--es','initialTree',uri)
        tap('Workspace folders')
    def records():
        if run('shell','run-as',APP,'test','-f','files/workspaces.json',check=False).returncode: return []
        return json.loads(read('files/workspaces.json'))
    def rename(old, new):
        activity(); tap('Rename '+old,True); tap('workspace_name')
        shell('input','keyevent','KEYCODE_MOVE_END',*(['KEYCODE_DEL']*len(old)))
        shell('input','text',new.replace(' ','%s')); tap('Save'); time.sleep(.3)
        assert any(r['name']==new for r in records())
    def choose(alias, reselect=False, keep_name=False):
        previous=records(); activity(alias)
        if reselect: tap('Reselect '+alias,True)
        else:
            assert not any(n.get('resource-id','').endswith('/workspace_name') for n in nodes())
            tap('Pick folder')
        assert any(n.get('text')==Path(trees[alias]).name for n in nodes()), 'Picker did not open exact owned folder'
        tap('Use this folder'); tap('Allow'); time.sleep(.3)
        if reselect: assert any(r['name']==alias for r in records()); return alias
        added=[r for r in records() if r['id'] not in {r['id'] for r in previous}]
        assert len(added)==1
        actual=added[0]['name']; base=Path(trees[alias]).name; used={r['name'] for r in previous}
        expected=base; suffix=0
        while expected in used:
            suffix+=1; expected=base[:48-len(str(suffix))-1]+'-'+str(suffix)
        assert actual==expected
        if not keep_name: rename(actual,alias)
        return actual
    def permission(enabled):
        activity(); tap('All-files access (optional)'); tap('Open settings')
        screen=nodes(); checks=[n for n in screen if n.get('checkable')=='true']
        assert len(checks)==1 and any(n.get('text')=='Allow access to manage all files' for n in screen)
        if (checks[0].get('checked')=='true') != enabled:
            x1,y1,x2,y2=map(int,re.findall(r'\d+',checks[0].get('bounds'))); shell('input','tap',str((x1+x2)//2),str((y1+y2)//2))
        assert [n.get('checked') for n in nodes() if n.get('checkable')=='true']==[str(enabled).lower()]
        activity()
    def action(operation, alias, enabled=False):
        shell('am','broadcast','--user','0','-n',APP+'/'+JAVA+'.WorkspaceAcceptanceReceiver','--es','op',operation,'--es','root',alias,'--ez','enabled',str(enabled).lower())
        assert json.loads(read('files/acceptance-action.json'))['ok']
    def stage():
        shell('run-as',APP,'mkdir','-p','files/runtime','files/state')
        with (HOST/'.local/runtime.tar').open('rb') as payload:
            r=subprocess.run([*adb,'shell','-T','run-as',APP,'tar','-xf','-','-C','files/runtime'],stdin=payload,capture_output=True,timeout=240)
            assert r.returncode==0
        shell('run-as',APP,'chmod','4755','files/runtime/usr/bin/sudo')
    def hashes():
        result={}
        for alias,tree in trees.items():
            for filename in run('exec-out','find',tree,'-type','f').stdout.decode().splitlines():
                assert filename.startswith(tree+'/')
                result[alias+'/'+filename[len(tree)+1:]]=hashlib.sha256(run('exec-out','cat',filename).stdout).hexdigest()
        return result
    def guest(*command, check=True):
        base=shell('run-as',APP,'pwd'); apkpath=shell('pm','path',APP).removeprefix('package:'); lib=apkpath.rsplit('/',1)[0]+'/lib/arm64'
        words=[lib+'/libproot.so','--kill-on-exit','--link2symlink','-i','1000:1000','-r',base+'/files/runtime','-b','/dev','-b','/proc','-b','/sys',
               '-b',base+'/cache/host-resolv.conf:/etc/resolv.conf','-b',base+'/files/state:/home/user','-b',base+'/files/workspace-view:/workspaces']
        # This auxiliary guest only runs the SAF CLI. Direct mappings are exercised
        # by the production HostService and real provider sessions, never invented
        # here from requested flags (which may lack current Android authority).
        words+=['-w','/home/user','/usr/bin/env','-i','HOME=/home/user','PATH=/usr/bin:/bin','YEP_ANDROID_SAF_SOCKET='+read('files/state/android-saf-socket').decode(),*command]
        env={'PROOT_LOADER':lib+'/libproot-loader.so','PROOT_TMP_DIR':base+'/cache','LD_LIBRARY_PATH':lib}
        script='\n'.join('export '+shlex.quote(k+'='+v) for k,v in env.items())+'\nexec '+shlex.join(words)
        result=run('shell',shlex.join(['run-as',APP,'/system/bin/sh','-c',script]),timeout=180,check=False)
        if check and result.returncode:
            (evidence/'guest-error.log').write_bytes(result.stdout+result.stderr); raise AssertionError('Guest command failed; inspect private guest-error.log')
        return result
    def saf(*words, check=True):
        result=guest('ya','saf',*words,check=check)
        return json.loads(result.stdout) if check else result
    def start():
        shell('am','start','-W','-f','0x10008000','-n',APP+'/'+JAVA+'.HostActivity'); tap('Start local host')
        for attempt in range(40):
            time.sleep(.5)
            if run('shell','run-as',APP,'test','-f','files/state/.local-access-token',check=False).returncode==0:
                try:
                    if api('/api/version')[0]==200: return
                except (OSError,urllib.error.URLError): pass
        (evidence/'host.log').write_bytes(read('files/host.log')); raise AssertionError('Fixture host did not become ready')
    def api(path, body=None):
        token=read('files/state/.local-access-token').decode().strip()
        request=urllib.request.Request('http://127.0.0.1:'+str(resources['forward'])+path,
            data=json.dumps(body).encode() if body is not None else None,
            headers={'x-desktop-token':token,'x-yep-anywhere':'true','content-type':'application/json'})
        try:
            with urllib.request.urlopen(request,timeout=35) as response: return response.status,json.load(response)
        except urllib.error.HTTPError as error: return error.code,json.load(error)
    success=False; summary={}; token=None
    try:
        (evidence/'target-status.json').write_bytes(common('target','status'))
        assert json.loads(common('target','doctor'))['ready']
        assert shell('getprop','ro.product.model')==args.model
        assert apk.is_file()
        if args.resume:
            common('testbed','--','stop',APP)
            if resources['installed']: run('uninstall',APP); resources['installed']=False; receipt()
            for alias in resources['owned']:
                assert run('exec-out','cat',trees[alias]+'/selection-witness.txt').stdout==run_id.encode(); shell('rm','-rf',trees[alias])
            resources['owned']=[]; receipt()
        else: assert not shell('pm','list','packages','--user','0',APP)
        for alias,tree in trees.items():
            assert run('shell','test','-e',tree,check=False).returncode==1
            shell('mkdir',tree); resources['owned'].append(alias); receipt()
            run('shell','-T','tee',tree+'/selection-witness.txt',data=run_id.encode())
        before={k:shell('settings','--user','0','get','secure',k) for k in ('enabled_accessibility_services','accessibility_enabled')}
        common('testbed','--','install',str(apk)); resources['installed']=True; receipt()
        if args.picker_only:
            expected=hashes()
            first=choose('docs',keep_name=True); second=choose('downloads',keep_name=True); third=choose('third',keep_name=True)
            assert first==Path(trees['docs']).name and second==first+'-1' and third==first+'-2'
            activity(); tap('Remove '+second,True); tap('Remove shortcut'); time.sleep(.3)
            assert choose('downloads',keep_name=True)==second
            before_cancel=records(); activity(); tap('Pick folder'); shell('input','keyevent','KEYCODE_BACK')
            assert records()==before_cancel
            # Picking the same identity again must neither duplicate it nor release its grant.
            activity(); tap('Pick folder'); tap('Use this folder'); tap('Allow'); time.sleep(.3)
            assert records()==before_cancel
            assert any('Folder already registered as '+first in n.get('text','') for n in nodes())
            rename(first,'docs'); choose('docs',reselect=True)
            assert any(r['name']=='docs' and r['id']==before_cancel[0]['id'] for r in records())
            common('testbed','--','stop',APP); activity()
            assert [r['name'] for r in records()]==['docs',third,second]
            assert hashes()==expected
            assert any('SAF: available via ya saf' in n.get('text','') for n in nodes())
            after={k:shell('settings','--user','0','get','secure',k) for k in before}; assert before==after
            common('testbed','--','screenshot',str(evidence/'workspaces.png'))
            instrument=run('shell','am','instrument','-w',APP+'/'+JAVA+'.WorkspaceTypingProbe')
            (evidence/'typing.log').write_bytes(instrument.stdout+instrument.stderr)
            assert b'WORKSPACE_TYPING_PASS' in instrument.stdout
            assert hashes()==expected
            summary.update(pickerFirst=True,displayNamePreserved=True,collisionSuffixes=['-1','-2'],firstFreeSuffix=True,
                cancelPreservedRegistry=True,duplicateRejected=True,renameReselectRestart=True,accessibilityUnchanged=True,typing=json.loads(read('files/typing.json')),
                independentlyVerifiedFiles=len(expected))
            success=True; return
        stage()
        resources['forward']=int(run('forward','tcp:0','tcp:13420').stdout); receipt()
        first=choose('docs',keep_name=True); second=choose('downloads',keep_name=True)
        assert second==first+'-1'
        rename(first,'docs'); rename(second,'downloads')
        instrument=run('shell','am','instrument','-w',APP+'/'+JAVA+'.WorkspaceTypingProbe')
        (evidence/'typing.log').write_bytes(instrument.stdout+instrument.stderr)
        assert b'WORKSPACE_TYPING_PASS' in instrument.stdout
        summary['typing']=json.loads(read('files/typing.json'))
        start(); roots=saf('roots')['roots']; assert len(roots)==2 and all(r['safAvailable'] and not r['directAvailable'] for r in roots)
        for alias in trees:
            (evidence/'upload.bin').write_bytes(b'HEAD'+bytes(4092)+b'TAIL')
            write('files/state/upload.bin',(evidence/'upload.bin').read_bytes())
            saf('mkdir',alias,'crud'); saf('put',alias,'crud/sample.bin','/home/user/upload.bin')
            saf('get',alias,'crud/sample.bin','/home/user/download.bin','--replace')
            assert read('files/state/download.bin')==(evidence/'upload.bin').read_bytes()
            assert saf('put',alias,'crud/sample.bin','/home/user/upload.bin',check=False).returncode!=0
            saf('rename',alias,'crud/sample.bin','renamed.bin'); saf('stat',alias,'crud/renamed.bin'); saf('rm',alias,'crud/renamed.bin'); saf('rm',alias,'crud','--recursive')
            assert saf('stat',alias,'../selection-witness.txt',check=False).returncode!=0
        summary['safWithoutBroadPermission']=True
        # A disconnected upload must not reach provider mutation.
        guest('python3','-c',"import os,socket,struct,json; s=socket.socket(socket.AF_UNIX); s.connect('\\0'+os.environ['YEP_ANDROID_SAF_SOCKET']); h=json.dumps({'op':'put','root':'docs','path':'selection-witness.txt','replace':True,'bytes':32}).encode(); s.sendall(struct.pack('!I',len(h))+h+b'partial'); s.shutdown(socket.SHUT_WR); assert s.recv(1)==b''; s.close()")
        assert run('exec-out','cat',trees['docs']+'/selection-witness.txt').stdout==run_id.encode()
        summary['incompleteUploadPreservedDestination']=True
        print('Both saved roots passed SAF CRUD/transfers without broad permission; sequential typing passed.',flush=True)
        permission(True)
        for alias in trees:
            activity(alias); tap('Direct access: '+alias,True)
        common('testbed','--','stop',APP); start(); assert all(r['mapped'] for r in saf('roots')['roots'])
        overview=json.loads(aar('owner-request','overview',body='{}'))
        accounts={p:next(a['id'] for a in overview['accounts'] if a['provider']==p and a['enabled']) for p in ('claude','codex')}
        client='ya-workspaces-'+run_id; created=aar('client','add',client,'--claude',accounts['claude'],'--codex',accounts['codex'])
        token=re.findall(r'\baar_[A-Za-z0-9_-]{43}\b',created)[0]; resources['client']=client; resources['token']=token; receipt()
        mappings=run('reverse','--list').stdout.decode(); port=next(p for p in range(18520,18620) if 'tcp:'+str(p) not in mappings)
        run('reverse','tcp:'+str(port),'tcp:8417'); resources['reverse']=port; receipt()
        write('files/state/development.json',json.dumps({'providerMode':'aar','aarEndpoint':'http://127.0.0.1:'+str(port),'aarToken':token}).encode())
        common('testbed','--','stop',APP); start()
        projects={}
        for alias in trees:
            status,body=api('/api/projects',{'path':'/workspaces/'+alias,'name':'Owned '+alias,'create':False}); assert status==200 or status==201,body
            projects[alias]=body.get('project',body)['id']
        for provider,alias in (('codex','docs'),('claude','downloads')):
            prompt=f'''This is an explicitly owned Android workspace acceptance test. Read selection-witness.txt in your current project using your file tools. It must contain {run_id}.
Use your normal file-edit tool to create /workspaces/docs/{provider}.txt and /workspaces/downloads/{provider}.txt containing exactly {provider}-{run_id} followed by a newline.
Then use your shell tool and Python 3 to write /workspaces/docs/{provider}.bin and /workspaces/downloads/{provider}.bin: b'HEAD' at offset 0, b'TAIL' at offset 4096 using os.pwrite, then os.fsync.
Verify your work. Do not modify any other files, initialize Git, use network commands, or add instructions. Finish once correct.'''
            status,session=api('/api/projects/'+projects[alias]+'/sessions',{'provider':provider,'model':'gpt-6.1-sol' if provider=='codex' else 'sonnet','mode':'bypassPermissions','message':prompt})
            assert status==200,session; (evidence/(provider+'-session.json')).write_text(json.dumps(session,indent=2))
            deadline=time.monotonic()+180
            while time.monotonic()<deadline:
                done=True
                for tree in trees.values():
                    text=run('exec-out','cat',tree+'/'+provider+'.txt',check=False)
                    binary=run('exec-out','cat',tree+'/'+provider+'.bin',check=False)
                    done &= text.returncode==0 and text.stdout==(provider+'-'+run_id+'\n').encode() and binary.returncode==0 and binary.stdout==b'HEAD'+bytes(4092)+b'TAIL'
                if done: break
                time.sleep(1)
            assert done,'Provider output mismatch; inspect fixture host logs/session'
            for attempt in range(40):
                _,state=api('/api/sessions/'+session['sessionId']+'/process')
                if not state.get('process') or state['process'].get('state') in ('idle','stopped','error','exited') or state['process'].get('status') in ('idle','stopped','error','exited'): break
                time.sleep(.5)
            summary[provider+'RealYaSession']=True
        expected=hashes(); (evidence/'hashes.json').write_text(json.dumps(expected,indent=2))
        print('Both real YA provider sessions wrote through both direct mappings; independent bytes match.',flush=True)
        activity(); common('testbed','--','screenshot',str(evidence/'workspaces.png'))
        common('testbed','--','stop',APP); start(); assert hashes()==expected and all(r['mapped'] for r in saf('roots')['roots'])
        summary['restart']=True
        action('revoke','docs'); assert saf('check','docs',check=False).returncode!=0; assert saf('stat','docs',check=False).returncode!=0
        assert saf('check','downloads')['path']=='/workspaces/downloads'; saf('stat','downloads')
        choose('docs',True); saf('check','docs'); summary['independentRootRepair']=True
        permission(False); start(); assert saf('check','downloads',check=False).returncode!=0; saf('stat','docs'); saf('stat','downloads'); assert hashes()==expected
        permission(True); common('testbed','--','stop',APP); start(); saf('check','docs'); summary['broadRevocationLeavesSaf']=True
        # Mapping change remains pending until the real controlled-restart UI applies it.
        action('direct','docs',False); assert saf('check','docs',check=False).returncode!=0
        activity(); tap('Apply mappings / restart host'); tap('Restart host')
        for attempt in range(40):
            time.sleep(.5)
            result=saf('roots',check=False)
            if result.returncode==0 and not next(r for r in json.loads(result.stdout)['roots'] if r['name']=='docs')['mapped']: break
        else: raise AssertionError('Controlled mapping restart did not apply')
        assert not next(r for r in saf('roots')['roots'] if r['name']=='docs')['mapped']; saf('check','downloads')
        action('direct','docs',True); common('testbed','--','stop',APP); start()
        summary['controlledMappingApply']=True
        print('Independent root repair, broad-off SAF access and controlled mapping restart passed.',flush=True)
        for mode in ('clear-data','reinstall'):
            common('testbed','--','stop',APP)
            if mode=='clear-data': assert shell('pm','clear','--user','0',APP)=='Success'
            else:
                run('uninstall',APP); resources['installed']=False; receipt()
                common('testbed','--','install',str(apk)); resources['installed']=True; receipt()
            assert hashes()==expected
            stage(); choose('docs'); choose('downloads'); start()
            assert len(saf('roots')['roots'])==2
            for alias in trees: saf('get',alias,'selection-witness.txt','/home/user/recovered.txt','--replace'); assert read('files/state/recovered.txt')==run_id.encode()
            permission(True)
            for alias in trees: action('direct',alias,True)
            common('testbed','--','stop',APP); start(); assert all(r['mapped'] for r in saf('roots')['roots']) and hashes()==expected
            summary[mode+'Recovery']=True; print(mode+' recovered both shortcuts with unchanged external hashes.',flush=True)
        # Real UI cancellation and registration-only rename/remove preserve files.
        activity(); tap('Pick folder'); shell('input','keyevent','KEYCODE_BACK')
        assert len(json.loads(read('files/workspaces.json')))==2
        rename('docs','docs2')
        assert saf('stat','docs',check=False).returncode!=0; saf('stat','docs2'); assert hashes()==expected
        activity(); tap('Remove docs2',True); tap('Remove shortcut'); time.sleep(.3)
        assert saf('stat','docs2',check=False).returncode!=0; saf('stat','downloads'); assert hashes()==expected
        choose('docs'); saf('stat','docs'); assert hashes()==expected
        summary['uiCancelRenameRemove']=True
        after={k:shell('settings','--user','0','get','secure',k) for k in before}; assert before==after
        summary.update(independentlyVerifiedFiles=len(expected),accessibilityUnchanged=True)
        success=True
    finally:
        errors=[]
        if resources['client']:
            try:
                aar('client','revoke',resources['client'])
                for provider in ('claude','codex'):
                    req=urllib.request.Request('http://127.0.0.1:8417/'+provider+('/v1/models' if provider=='claude' else '/models'),headers={'Authorization':'Bearer '+token})
                    try: urllib.request.urlopen(req,timeout=5).close(); raise AssertionError('Revoked grant accepted')
                    except urllib.error.HTTPError as error: assert error.code==401
                resources['client']=None; resources.pop('token',None); receipt()
            except Exception as error: errors.append('grant cleanup: '+type(error).__name__)
        for kind in ('reverse','forward'):
            if resources[kind]:
                try: run(kind,'--remove','tcp:'+str(resources[kind])); resources[kind]=None; receipt()
                except Exception as error: errors.append(kind+' cleanup: '+type(error).__name__)
        if resources['installed']:
            try: common('testbed','--','stop',APP)
            except Exception as error: errors.append('fixture stop: '+type(error).__name__)
        if success and not errors:
            assert hashes()==expected
            assert run('uninstall',APP).stdout.strip()==b'Success'; resources['installed']=False; receipt()
            for alias in resources['owned']:
                assert run('exec-out','cat',trees[alias]+'/selection-witness.txt').stdout==run_id.encode(); shell('rm','-rf',trees[alias]); assert run('shell','test','-e',trees[alias],check=False).returncode==1
            resources['owned']=[]; receipt(); summary['cleanupComplete']=True
            (evidence/'summary.json').write_text(json.dumps(summary,indent=2)+'\n'); lease.unlink(); print(json.dumps(summary,indent=2),flush=True)
        else: print('Fixture stopped; owned external files and private recovery receipt retained.',flush=True)
        if errors: raise RuntimeError('; '.join(errors))


if __name__=='__main__': main()
