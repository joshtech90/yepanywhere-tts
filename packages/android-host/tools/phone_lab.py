#!/usr/bin/env python3
"""Inspect, provision or verify only the separate on-phone YA Host Lab.

The original host is a protected build controller: no action stops, replaces,
clears or provisions it. Reports contain public signing identity and boolean/
HTTP witnesses, never signing private keys or local access credentials.
"""
import argparse
import json
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import time
import urllib.error
import urllib.request
import uuid
from lifecycle_control import control
from phone_toolchain import digest

MAIN = 'com.yepanywhere.host.experimental'
LAB = 'com.yepanywhere.host.lab'


class Phone:
    def __init__(self, args):
        self.serial = args.serial
        self.adb = ['adb', '-s', args.serial]
        self.work = args.work_dir.resolve()
        self.work.mkdir(parents=True, exist_ok=True)
        self.signer = ['java', '-Xmx256m', '-jar', str(self.work / 'sdk/android-16/lib/apksigner.jar')]

    def run(self, *words, **kwargs):
        return subprocess.run([*self.adb, *map(str, words)], check=True, timeout=180, **kwargs)

    def shell(self, *words, **kwargs):
        result = self.run('shell', '-T', shlex.join(list(map(str, words))), capture_output=True, **kwargs)
        return result.stdout

    def text(self, *words):
        return self.shell(*words).decode().strip()

    def installed(self, package):
        return 'package:' + package in self.text('pm', 'list', 'packages', package).splitlines()

    def certificate(self, apk):
        output = subprocess.check_output([*self.signer, 'verify', '--print-certs', str(apk)], text=True, timeout=30)
        return {name: re.search(pattern, output).group(1) for name, pattern in {
            'subject': r'Signer #1 certificate DN: (.+)',
            'sha256': r'Signer #1 certificate SHA-256 digest: (.+)',
        }.items()}

    def identity(self, package, port):
        remote = self.text('pm', 'path', package).removeprefix('package:')
        apk = self.work / (package + '.apk')
        self.run('pull', remote, apk, capture_output=True)
        uid = int(self.text('run-as', package, 'id', '-u'))
        if uid >= 100000:
            raise RuntimeError('This experiment only supports Android user 0')
        return {'package': package, 'port': port, 'uid': uid,
                'certificate': self.certificate(apk), 'apkSha256': digest(apk)}

    def inventory(self):
        result = {'buildHost': self.identity(MAIN, 13400),
                  'privateKeysInspected': False, 'originalSigningPrivateKeyLocated': False}
        if self.installed(LAB):
            result['labHost'] = self.identity(LAB, 13410)
        return result

    def declared_package(self, apk):
        remote = '/data/local/tmp/ya-phone-inspect-' + uuid.uuid4().hex
        try:
            self.shell('mkdir', '-p', remote)
            self.run('push', self.work / 'native-tools', remote + '/', capture_output=True)
            self.shell('chmod', '755', remote + '/native-tools/bin/aapt2')
            self.run('push', apk, remote + '/inspect.apk', capture_output=True)
            output = self.text('env', 'LD_LIBRARY_PATH=' + remote + '/native-tools/lib',
                               remote + '/native-tools/bin/aapt2', 'dump', 'badging', remote + '/inspect.apk')
            return re.search(r"^package: name='([^']+)'", output).group(1)
        finally:
            self.shell('rm', '-rf', remote)

    def install(self, update):
        apk = self.work / 'phone-lab/android-host-lab-debug.apk'
        provenance = json.loads((apk.parent / 'provenance.json').read_text())
        if provenance['applicationId'] != LAB or provenance['apkSha256'] != digest(apk) or self.declared_package(apk) != LAB:
            raise RuntimeError('Refusing an artifact that is not the recorded Lab APK')
        before = self.inventory()
        pid = self.text('pidof', MAIN)
        if 'labHost' in before:
            if not update or before['labHost']['certificate'] != self.certificate(apk):
                raise RuntimeError('Existing Lab needs --update and the same signing certificate')
            self.run('install', '-r', '--no-streaming', apk)
        else:
            if update:
                raise RuntimeError('--update requires an existing Lab installation')
            if shutil.disk_usage(self.work).free < 1.6 * 1024**3:
                raise RuntimeError('Need 1.6 GiB free before cloning an independent runtime')
            # The current launcher must consume the native app's distinct port.
            launcher = self.shell('run-as', MAIN, 'cat', 'files/runtime/opt/host/launch.mjs')
            if b'YEP_ANDROID_HOST_PORT' not in launcher:
                raise RuntimeError('Build host runtime predates explicit per-app ports')
            self.run('install', '--no-streaming', apk)
            self.shell('run-as', LAB, 'mkdir', '-p', 'files/runtime', 'files/state')
            command = (f'set -o pipefail; run-as {MAIN} tar -C files/runtime -cf - '
                       f'bin etc lib opt sbin usr var | run-as {LAB} tar -xof - -C files/runtime')
            self.run('shell', '-T', command, capture_output=True)
            self.shell('run-as', LAB, 'mkdir', '-p', *['files/runtime/' + name for name in
                       ('home/user', 'tmp', 'dev', 'proc', 'sys', 'run', 'root', 'sdcard', 'workspaces', 'storage')])
            self.shell('run-as', LAB, 'ln', '-s', 'user', 'files/runtime/home/host')
            self.shell('run-as', LAB, 'chmod', '1777', 'files/runtime/tmp')
        after = self.inventory()
        if before['buildHost'] != after['buildHost'] or self.text('pidof', MAIN) != pid:
            raise RuntimeError('Protected build host identity/process changed')
        if after['buildHost']['uid'] == after['labHost']['uid']:
            raise RuntimeError('Expected independent Android UIDs')
        return after

    def token(self, package):
        value = self.shell('run-as', package, 'cat', 'files/state/.local-access-token').decode().strip()
        if not re.fullmatch(r'[A-Za-z0-9_-]{43}', value):
            raise RuntimeError('Invalid local credential; value withheld')
        return value

    def start_lab(self):
        def command(*words):
            result = self.run('shell', '-T', shlex.join(words), capture_output=True)
            return (result.stdout + result.stderr).decode()
        control(self.serial, LAB, 'start', shell_command=command)

    def verify(self, restart):
        before = self.inventory()
        pid = self.text('pidof', MAIN)
        main_token, lab_token = self.token(MAIN), self.token(LAB)

        def health(port, token=None):
            headers = {'X-Desktop-Token': token} if token else {}
            request = urllib.request.Request(f'http://127.0.0.1:{port}/api/health', headers=headers)
            try:
                with urllib.request.urlopen(request, timeout=3) as response:
                    return response.status
            except urllib.error.HTTPError as error:
                return error.code
            except OSError:
                return None

        result = {'credentialsDistinct': main_token != lab_token,
                  'mainOwn': health(13400, main_token), 'labOwn': health(13410, lab_token),
                  'mainCross': health(13400, lab_token), 'labCross': health(13410, main_token)}
        if result != {'credentialsDistinct': True, 'mainOwn': 200, 'labOwn': 200, 'mainCross': 401, 'labCross': 401}:
            raise RuntimeError('Host readiness/authentication isolation failed; values withheld')
        if restart:
            self.shell('am', 'force-stop', LAB)
            deadline = time.monotonic() + 5
            while health(13410) is not None and time.monotonic() < deadline:
                time.sleep(0.2)
            if health(13410) is not None or health(13400, main_token) != 200 or self.text('pidof', MAIN) != pid:
                raise RuntimeError('Lab stop did not preserve the expected host states')
            self.start_lab()
            deadline = time.monotonic() + 45
            while time.monotonic() < deadline:
                if health(13400, main_token) != 200 or self.text('pidof', MAIN) != pid:
                    raise RuntimeError('Protected host lost readiness during Lab restart')
                if health(13410, lab_token) == 200:
                    break
                time.sleep(1)
            else:
                raise RuntimeError('Lab restart timed out')
            result['labRestartIsolationPassed'] = True
        if self.inventory()['buildHost'] != before['buildHost'] or self.text('pidof', MAIN) != pid:
            raise RuntimeError('Protected build host changed')
        return {'inventory': before, 'verification': result, 'providerInferenceTested': False}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--serial', required=True)
    parser.add_argument('--work-dir', type=Path, required=True)
    sub = parser.add_subparsers(dest='action', required=True)
    sub.add_parser('inventory')
    install = sub.add_parser('install')
    install.add_argument('--update', action='store_true', help='Update only an existing same-signer Lab; retain its state')
    verify = sub.add_parser('verify')
    verify.add_argument('--restart-lab', action='store_true', help='Force-stop/restart only the Lab and witness build-host continuity')
    args = parser.parse_args()
    phone = Phone(args)
    phone.run('get-state', capture_output=True)
    if args.action == 'inventory':
        result = phone.inventory()
    elif args.action == 'install':
        result = phone.install(args.update)
    else:
        result = phone.verify(args.restart_lab)
    output = phone.work / ('phone-lab-' + args.action + '.json')
    output.write_text(json.dumps(result, indent=2) + '\n')
    print('Saved public identity/verification report:', output)
