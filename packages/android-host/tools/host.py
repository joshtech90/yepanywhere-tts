#!/usr/bin/env python3
"""Build one app-private Alpine payload for both Android and Linux.

Runtime binaries/keys/builds are local only. Downloads are hash verified;
Alpine checks package signatures offline. YA comes from this checkout.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import tarfile
import tempfile
import time
import urllib.request
import uuid
import zipfile
from lifecycle_control import control

PACKAGE = Path(__file__).resolve().parents[1]
REPO = PACKAGE.parents[1]
LOCAL = PACKAGE / '.local'
APP = 'com.yepanywhere.host.experimental'
IMAGE = 'ya-android-host:local'


def run(*args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def fetch(entry, cache=None):
    directory = LOCAL / 'downloads'
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / entry['name']
    if not target.exists() and cache:
        matches = list(cache.rglob(entry.get('cacheName', entry['name'])))
        if matches:
            shutil.copyfile(matches[0], target)
    if not target.exists():
        run('curl', '-fsSL', '--retry', '2', '-o', str(target), entry['url'])
    if hashlib.file_digest(target.open('rb'), 'sha256').hexdigest() != entry['sha256']:
        raise RuntimeError('Download hash mismatch: ' + entry['name'])
    return target


def prepare(cache, skip_build):
    source_revision = subprocess.check_output(['git', '-C', str(REPO), 'rev-parse', 'HEAD'], text=True).strip()
    LOCAL.mkdir(parents=True, exist_ok=True)
    context = LOCAL / 'context'
    context.mkdir(exist_ok=True)
    entries = json.loads((PACKAGE / 'runtime/artifacts.json').read_text())['artifacts']
    downloads = {e['name']: fetch(e, cache) for e in entries}
    for name in ['alpine.tar.gz', 'codex-package.tar.gz']:
        shutil.copyfile(downloads[name], context / name)
    native = LOCAL / 'jni/arm64-v8a'
    native.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(downloads['buddy.apk']) as archive:
        for name in ['libproot.so', 'libproot-loader.so', 'libtalloc.so', 'libandroid-shmem.so']:
            (native / name).write_bytes(archive.read('lib/arm64-v8a/' + name))
    notices = LOCAL / 'notices'
    notices.mkdir(exist_ok=True)
    for name, path in downloads.items():
        if name.startswith('notice-'):
            shutil.copyfile(path, notices / name.removeprefix('notice-'))
    claude = context / 'claude'
    claude.mkdir(exist_ok=True)
    with tarfile.open(downloads['claude.tgz']) as archive:
        for name in ['claude', 'LICENSE.md']:
            (claude / name).write_bytes(archive.extractfile('package/' + name).read())
    if hashlib.file_digest((claude / 'claude').open('rb'), 'sha256').hexdigest() != '58dd401b704351f4b70a0bb6faecbc1eb1405057b4dd4cf48a7beae93b4ca143':
        raise RuntimeError('Claude executable hash mismatch')
    apks = context / 'apks'
    apks.mkdir(exist_ok=True)
    expected = set()
    for entry in json.loads((PACKAGE / 'runtime/alpine-packages.json').read_text())['packages']:
        entry = {**entry, 'name': entry['url'].rsplit('/', 1)[1]}
        expected.add(entry['name'])
        shutil.copyfile(fetch(entry, cache), apks / entry['name'])
    for path in apks.iterdir():
        if path.name not in expected:
            path.unlink()
    if not skip_build:
        version = subprocess.check_output(['git', '-C', str(REPO), 'describe', '--tags', '--always', '--match', 'v[0-9]*.[0-9]*.[0-9]*'], text=True).strip().removeprefix('v')
        if not re.fullmatch(r'\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?', version):
            version = '0.0.0-dev.' + version
        # Vite and the assembled backend must report the same source build.
        build_env = {k: v for k, v in os.environ.items() if not k.lower().startswith('npm_')}
        run('pnpm', 'build:bundle', cwd=REPO, env={**build_env, 'NPM_VERSION': version})
    bundle = REPO / 'dist/npm-package'
    if not (bundle / 'dist/index.js').is_file():
        raise RuntimeError('Build this checkout with pnpm build:bundle first')
    yep = context / 'yep'
    yep.mkdir(exist_ok=True)
    for name in ['dist', 'client-dist', 'bundled']:
        if (yep / name).exists():
            shutil.rmtree(yep / name)
        shutil.copytree(bundle / name, yep / name)
    shutil.copyfile(bundle / 'LICENSE', yep / 'LICENSE')
    package = json.loads((bundle / 'package.json').read_text())
    # Read only the fixed server importer shape, not the ambient node_modules:
    # a checkout can have stale installed SDKs even when its lock is current.
    # Refuse missing entries rather than silently resolving a newer version.
    lock = (REPO / 'pnpm-lock.yaml').read_text()
    importer = lock.split('\n  packages/server:\n', 1)[1]
    importer = re.split(r'\n  \S', importer, maxsplit=1)[0]
    dependencies = importer.split('\n    devDependencies:', 1)[0]
    versions = {name.strip("'"): version.strip("'").split('(')[0]
                for name, version in re.findall(r'^      (.+):\n        specifier: [^\n]+\n        version: ([^\n]+)', dependencies, re.M)}
    for name in package['dependencies']:
        if package['dependencies'][name].startswith('file:'):
            continue
        if name not in versions:
            raise RuntimeError('Missing locked server dependency: ' + name)
        package['dependencies'][name] = versions[name]
    previous = json.loads((yep / 'package.json').read_text()) if (yep / 'package.json').exists() else None
    if previous and previous.get('dependencies') != package['dependencies']:
        (yep / 'package-lock.json').unlink(missing_ok=True)
    (yep / 'package.json').write_text(json.dumps(package, indent=2) + '\n')
    env = {k: v for k, v in os.environ.items() if not k.lower().startswith('npm_')}
    run('npm', '--prefix', str(yep), 'ci' if (yep / 'package-lock.json').exists() else 'install',
        '--ignore-scripts', '--omit=dev', '--omit=optional', '--no-audit', '--no-fund', env=env)
    if not (yep / 'node_modules/bcrypt/prebuilds/linux-arm64/bcrypt.musl.node').is_file():
        raise RuntimeError('Missing Linux ARM64/musl bcrypt prebuild')
    shutil.copytree(PACKAGE / 'runtime', context / 'runtime', dirs_exist_ok=True)
    shutil.copyfile(downloads['notice-sudo-LICENSE.md'], context / 'runtime/sudo-LICENSE.md')
    shutil.copyfile(PACKAGE / 'runtime/Dockerfile', context / 'Dockerfile')
    run('docker', 'build', '--platform=linux/arm64', '-t', IMAGE, str(context))
    container = subprocess.check_output(['docker', 'create', IMAGE], text=True).strip()
    try:
        run('docker', 'export', '-o', str(LOCAL / 'runtime.tar'), container)
    finally:
        run('docker', 'rm', container, stdout=subprocess.DEVNULL)
    info = {'sourceRevision': source_revision,
            'buildVersion': package['version'],
            'sourceDirty': bool(subprocess.check_output(['git', '-C', str(REPO), 'status', '--porcelain'], text=True)),
            'workspaceLockSha256': hashlib.sha256(lock.encode()).hexdigest(),
            'payloadSha256': hashlib.file_digest((LOCAL / 'runtime.tar').open('rb'), 'sha256').hexdigest(),
            'npmLockSha256': hashlib.file_digest((yep / 'package-lock.json').open('rb'), 'sha256').hexdigest()}
    (LOCAL / 'runtime-info.json').write_text(json.dumps(info, indent=2) + '\n')
    print('Prepared shared Linux/Android payload; runtime-info.json records source and payload identity.')


def device(serial, action):
    controller = Path(os.environ.get('MACHINE_CONTROL_ANDROID', Path.home() / 'code/machine-control/platforms/android/bin/android-device'))
    result = subprocess.run([str(controller), '--serial', serial, 'doctor', '--json'], capture_output=True, text=True)
    doctor = json.loads(result.stdout)
    # Provisioning needs authorized ADB and decrypted app storage, not an
    # unlocked display. Overall doctor readiness also includes UI interaction.
    if (any(doctor.get('states', {}).get(name) != 'ready' for name in ['connection', 'boot', 'administration'])
            or doctor.get('extensions', {}).get('userStorage') != 'unlocked'):
        raise RuntimeError('Selected device needs authorized ADB, completed boot and unlocked user storage')
    if action == 'install':
        run(str(controller), '--serial', serial, 'install', str(PACKAGE / 'app/build/outputs/apk/debug/app-debug.apk'))
        return
    adb = ['adb', '-s', serial]
    if action == 'check-user':
        # Debug-only integration probe. Exercise the installed Android PRoot,
        # not Docker or a workstation provider profile. No server is started.
        apk = subprocess.check_output([*adb, 'shell', 'pm', 'path', APP], text=True).strip()
        if not apk.startswith('package:') or '\n' in apk:
            raise RuntimeError('Expected one installed host APK')
        lib = apk.removeprefix('package:').rsplit('/', 1)[0] + '/lib/arm64'
        base = subprocess.check_output([*adb, 'shell', 'run-as', APP, 'pwd'], text=True).strip()
        uts = [subprocess.check_output([*adb, 'shell', 'uname', flag], text=True).strip()
               for flag in ['-s', '-r', '-v', '-m']]
        kernel = '\\' + '\\'.join([uts[0], 'ya-phone', *uts[1:], 'localdomain', '-1', ''])
        command = [lib + '/libproot.so', '--kill-on-exit', '--link2symlink', '-i', '1000:1000', '-k', kernel,
                   '-r', base + '/files/runtime', '-b', '/dev', '-b', '/proc', '-b', '/sys',
                   '-b', base + '/files/runtime/opt/host/hosts:/etc/hosts',
                   '-b', base + '/files/runtime/opt/host/hostname:/etc/hostname',
                   '-b', base + '/files/state:/home/user', '-w', '/home/user',
                   '/usr/bin/env', '-i', 'HOME=/home/user', 'USER=user', 'LOGNAME=user',
                   'HOSTNAME=ya-phone', 'SHELL=/bin/bash', 'PATH=/usr/bin:/bin:/usr/sbin:/sbin',
                   '/usr/bin/node', '/opt/host/check-user.mjs']
        environment = {'PROOT_LOADER': lib + '/libproot-loader.so',
                       'PROOT_TMP_DIR': base + '/cache', 'LD_LIBRARY_PATH': lib}
        script = '\n'.join('export ' + shlex.quote(key + '=' + value) for key, value in environment.items())
        # An APK installation path can contain '='; Android env would mistake
        # that executable path for another assignment. Exec through sh instead.
        script += '\nexec ' + shlex.join(command)
        run(*adb, 'shell', shlex.join(['run-as', APP, '/system/bin/sh', '-c', script]))
        return
    run(*adb, 'shell', 'am', 'force-stop', APP)
    # Runtime replacement never touches state (sessions, sign-in and pairing).
    run(*adb, 'shell', 'run-as', APP, 'rm', '-rf', 'files/runtime.next')
    run(*adb, 'shell', 'run-as', APP, 'mkdir', '-p', 'files/runtime.next', 'files/state')
    with (LOCAL / 'runtime.tar').open('rb') as payload:
        run(*adb, 'shell', '-T', 'run-as', APP, 'tar', '-xf', '-', '-C', 'files/runtime.next', stdin=payload)
    # Android tar strips setuid bits when extracting as the app identity.
    # PRoot needs sudo's marker to emulate the guest-root transition; the
    # actual executable is still owned by the unprivileged Android app UID.
    run(*adb, 'shell', 'run-as', APP, 'chmod', '4755', 'files/runtime.next/usr/bin/sudo')
    run(*adb, 'shell', 'run-as', APP, 'rm', '-rf', 'files/runtime.previous')
    # The selected app is stopped, so there are no live roots to replace.
    exists = subprocess.run([*adb, 'shell', 'run-as', APP, 'test', '-d', 'files/runtime'], capture_output=True).returncode
    if exists == 0:
        run(*adb, 'shell', 'run-as', APP, 'mv', 'files/runtime', 'files/runtime.previous')
    elif exists != 1:
        raise RuntimeError('Cannot inspect installed runtime')
    run(*adb, 'shell', 'run-as', APP, 'mv', 'files/runtime.next', 'files/runtime')
    print('Runtime staged; app-private state preserved. Start it with host.py control --serial DEVICE start.')


def smoke():
    """Real Alpine server, protected loopback API, durable SQLite, no inference."""
    name = 'ya-host-smoke-' + uuid.uuid4().hex
    volume = name + '-state'
    with tempfile.TemporaryDirectory(prefix='ya-host-') as directory:
        home = Path(directory)
        (home / 'development.json').write_text('{"providerMode":"mock"}')
        try:
            # A private named volume also works on Linux where container UID
            # 1000 cannot share a mode-0700 host fixture directory.
            run('docker', 'volume', 'create', volume, stdout=subprocess.DEVNULL)
            run('docker', 'create', '--name', name, '--hostname', 'ya-phone', '--mount', f'type=volume,src={volume},dst=/home/user', IMAGE, stdout=subprocess.DEVNULL)
            run('docker', 'cp', str(home / 'development.json'), name + ':/home/user/development.json')
            run('docker', 'start', name, stdout=subprocess.DEVNULL)
            run('docker', 'exec', name, 'node', '/opt/host/check-user.mjs')
            result = []
            for generation in range(2):
                if generation:
                    run('docker', 'restart', name, stdout=subprocess.DEVNULL)
                deadline = time.monotonic() + 60
                while time.monotonic() < deadline:
                    probe = subprocess.run(['docker', 'exec', '-e', 'REQUIRE_SAVED='+('true' if generation else 'false'), name, 'node', '-e', """
const fs=require('node:fs');
const token=fs.readFileSync('/home/user/.local-access-token','utf8').trim();
(async()=>{
 const url='http://127.0.0.1:13400';
 const headers={'x-desktop-token':token,'x-yep-anywhere':'true'};
 const denied=await fetch(url+'/api/projects'); if(denied.status!==401)throw Error('local auth floor');
 const version=await (await fetch(url+'/api/version',{headers})).json();
 if(version.sqlite?.state!=='ready')throw Error('sqlite not ready');
 const inventory=await (await fetch(url+'/api/host-agent-processes',{headers})).json();
 if(inventory.enabled!==false)throw Error('external process inventory enabled');
 const html=await fetch(url); if(!html.ok)throw Error('frontend missing');
 const list=await (await fetch(url+'/api/projects',{headers})).json();
 const saved=list.projects?.some(p=>p.path==='/home/user/smoke-project');
 if(!saved){
   if(process.env.REQUIRE_SAVED==='true')throw Error('project lost on restart');
   const added=await fetch(url+'/api/projects',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({path:'/home/user/smoke-project',name:'Persistent host smoke',create:true})});
   if(!added.ok)throw Error('project registration failed');
 }
 console.log(JSON.stringify({sqlite:version.sqlite.state,externalInventory:inventory.enabled,unauthorizedStatus:denied.status,frontendStatus:html.status,persistedProjectVerified:!!saved}));
})().catch(()=>process.exit(1));
"""], capture_output=True, text=True)
                    if probe.returncode == 0:
                        result.append(json.loads(probe.stdout)); break
                    time.sleep(0.5)
                else:
                    raise RuntimeError('Alpine readiness failed; inspect the private smoke log')
            LOCAL.mkdir(exist_ok=True)
            (LOCAL / 'smoke.json').write_text(json.dumps({'beforeRestart': result[0], 'afterRestart': result[1]}, indent=2) + '\n')
            print(json.dumps(result, indent=2))
        finally:
            log = subprocess.run(['docker', 'logs', name], capture_output=True)
            LOCAL.mkdir(exist_ok=True)
            (LOCAL / 'smoke.log').write_bytes(log.stdout + log.stderr)
            try:
                subprocess.run(['docker', 'rm', '-f', name], capture_output=True)
            finally:
                run('docker', 'volume', 'rm', volume, stdout=subprocess.DEVNULL)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='action', required=True)
    prepare_parser = sub.add_parser('prepare')
    prepare_parser.add_argument('--cache', type=Path, help='Optional verified existing downloads cache')
    prepare_parser.add_argument('--skip-build', action='store_true', help='Use an already-built bundle from this checkout')
    sub.add_parser('smoke')
    for name in ['install', 'stage', 'check-user']:
        command = sub.add_parser(name); command.add_argument('--serial', required=True)
    command = sub.add_parser('control', help='Headless debug host lifecycle through authorized ADB')
    command.add_argument('--serial', required=True)
    command.add_argument('--package', choices=[APP, 'com.yepanywhere.host.lab', 'com.yepanywhere.host.workspace.acceptance'], default=APP)
    command.add_argument('--timeout', type=float, default=45)
    command.add_argument('operation', choices=['start', 'stop', 'restart', 'status'])
    args = parser.parse_args()
    if args.action == 'prepare': prepare(args.cache, args.skip_build)
    elif args.action == 'smoke': smoke()
    elif args.action == 'control': control(args.serial, args.package, args.operation, args.timeout)
    else: device(args.serial, args.action)


if __name__ == '__main__': main()
