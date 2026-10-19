#!/usr/bin/env python3
"""Native state/notification acceptance in a disposable, mock-provider host.

Requires a prepared runtime and an unlocked explicitly selected phone. Only the
fixture app's data/permissions are changed; normal host credentials, folders,
tabs, Android accessibility and debugging configuration remain untouched.
"""
import argparse
import json
from pathlib import Path
import re
import shlex
import subprocess
import time
import uuid
import xml.etree.ElementTree as ET

HOST = Path(__file__).resolve().parents[1]
APP = 'com.yepanywhere.host.workspace.acceptance'
JAVA = 'com.yepanywhere.host'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--serial', required=True)
    args = parser.parse_args()
    evidence = HOST / '.local' / ('controls-' + uuid.uuid4().hex)
    evidence.mkdir(mode=0o700)
    adb = ['adb', '-s', args.serial]
    native = [str(HOST.parents[2] / 'machine-control/platforms/android/bin/android-device'), '--serial', args.serial]
    installed = False
    remote = '/data/local/tmp/ya-controls-' + evidence.name + '.xml'

    def run(words, data=None, timeout=60):
        result = subprocess.run(words, input=data, capture_output=True, timeout=timeout)
        if result.returncode:
            (evidence / 'operation-error.log').write_bytes(result.stdout + result.stderr)
            raise RuntimeError('Operation failed; inspect private evidence')
        return result.stdout

    def shell(*words, **kwargs):
        return run([*adb, 'shell', '-T', shlex.join(words)], **kwargs)

    def nodes():
        shell('uiautomator', 'dump', remote)
        data = shell('cat', remote)
        (evidence / 'ui.xml').write_bytes(data)
        return list(ET.fromstring(data).iter('node'))

    def find(prefix):
        return [node for node in nodes() if node.get('text', '').casefold().startswith(prefix.casefold())]

    def tap(prefix):
        matches = find(prefix)
        assert len(matches) == 1, 'Control not uniquely identified: ' + prefix
        node = matches[0]
        assert node.get('enabled') == 'true', 'Control disabled: ' + prefix
        x1, y1, x2, y2 = map(int, re.findall(r'\d+', node.get('bounds')))
        assert x2 > x1 and y2 > y1, 'Control offscreen: ' + prefix
        shell('input', 'tap', str((x1 + x2) // 2), str((y1 + y2) // 2))

    def wait(check, seconds=60):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            if check():
                return
            time.sleep(.1)
        raise AssertionError('Observation deadline expired')

    def activity(name='HostActivity'):
        shell('am', 'start', '-W', '-f', '0x10008000', '-n', APP + '/' + JAVA + '.HostActivity')
        if name == 'WorkspacesActivity':
            tap('Workspace folders')

    def capture(name):
        run([*native, 'screenshot', str(evidence / (name + '.png'))])

    def read(path):
        return shell('run-as', APP, 'cat', path)

    try:
        doctor = json.loads(run([*native, 'doctor', '--json']))
        assert doctor['ready'] and doctor['states']['interaction'] == 'unlocked'
        assert not shell('pm', 'list', 'packages', APP).strip(), 'Existing fixture must be recovered before running'
        run([*native, 'install', str(HOST / '.local/controls-fixture.apk')])
        installed = True
        (evidence / 'recovery.json').write_text(json.dumps({'app': APP, 'serial': args.serial}))
        shell('run-as', APP, 'mkdir', '-p', 'files/runtime', 'files/state')
        with (HOST / '.local/runtime.tar').open('rb') as payload:
            result = subprocess.run([*adb, 'shell', '-T', shlex.join(['run-as', APP, 'tar', '-xf', '-', '-C', 'files/runtime'])], stdin=payload, capture_output=True, timeout=300)
            assert result.returncode == 0, 'Fixture runtime extraction failed'
        shell('run-as', APP, 'chmod', '4755', 'files/runtime/usr/bin/sudo')
        shell('run-as', APP, 'tee', 'files/state/development.json', data=b'{"providerMode":"mock"}')
        shell('pm', 'grant', APP, 'android.permission.POST_NOTIFICATIONS')
        for probe, marker, output in [('HostControlsProbe', b'HOST_CONTROLS_PASS', 'host-controls'), ('WorkspaceTypingProbe', b'WORKSPACE_TYPING_PASS', 'typing')]:
            shell('am', 'force-stop', APP)
            result = shell('am', 'instrument', '-w', APP + '/' + JAVA + '.' + probe, timeout=300)
            (evidence / (output + '.log')).write_bytes(result)
            if marker not in result:
                capture('probe-failure')
                (evidence / 'host-error.log').write_bytes(shell('run-as', APP, 'cat', 'files/host.log'))
                raise AssertionError('Native probe failed: ' + probe)
            facts = json.loads(read('files/' + output + '.json'))
            (evidence / (output + '.json')).write_text(json.dumps(facts, indent=2))
        shell('am', 'force-stop', APP)
        activity('WorkspacesActivity')
        assert find('All-files access: Off')
        tap('All-files access: Off'); tap('Open settings')
        checks = [node for node in nodes() if node.get('checkable') == 'true']
        assert len(checks) == 1 and checks[0].get('checked') == 'false'
        x1, y1, x2, y2 = map(int, re.findall(r'\d+', checks[0].get('bounds')))
        shell('input', 'tap', str((x1 + x2) // 2), str((y1 + y2) // 2))
        shell('input', 'keyevent', 'KEYCODE_BACK')
        assert find('All-files access: Allowed'), 'Settings return did not refresh permission state'
        tap('All-files access: Allowed')
        assert any(node.get('checkable') == 'true' for node in nodes()), 'Manage access repeated consent dialog'
        shell('input', 'keyevent', 'KEYCODE_BACK')
        tap('Start host with mappings')
        wait(lambda: bool(find('Mappings up to date')))
        capture('workspace-mapped')
        # Revocation may make Android kill the app. Follow the actual lifecycle
        # authority: restart a surviving host, or explicitly start a stopped one.
        tap('All-files access: Allowed')
        check = [node for node in nodes() if node.get('checkable') == 'true'][0]
        x1, y1, x2, y2 = map(int, re.findall(r'\d+', check.get('bounds')))
        shell('input', 'tap', str((x1 + x2) // 2), str((y1 + y2) // 2))
        shell('input', 'keyevent', 'KEYCODE_BACK')
        assert find('All-files access: Off')
        if find('Restart to apply changes'):
            revocation_recovery = 'restart'
            tap('Restart to apply changes'); tap('Restart host')
        else:
            revocation_recovery = 'start-after-permission-change'
            tap('Start host with mappings')
        wait(lambda: bool(find('Mappings up to date')))
        capture('workspace-revoked')
        activity()
        wait(lambda: bool(find('Manage Claude')) and not any('Checking sign-in' in node.get('text', '') for node in nodes()))
        capture('menu-ready')
        tap('Stop local host'); tap('Cancel')
        assert find('Local host running'), 'Cancel stopped host'
        tap('Stop local host'); tap('Stop host')
        wait(lambda: bool(find('Start local host')))
        capture('menu-stopped')
        (evidence / 'summary.json').write_text(json.dumps({'passed': True, 'permissionSettingsRoundTrip': True, 'mappingApplyConverged': True, 'revocationRecovery': revocation_recovery, 'stopConfirmation': True}, indent=2))
        print('Native controls acceptance passed; private evidence: ' + str(evidence))
    finally:
        shell('rm', '-f', remote)
        if installed:
            run([*native, 'stop', APP])
            shell('pm', 'uninstall', APP)
            (evidence / 'recovery.json').unlink(missing_ok=True)


if __name__ == '__main__':
    main()
