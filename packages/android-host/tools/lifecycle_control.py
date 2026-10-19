"""ADB-only debug lifecycle. Never opens an activity or changes device policy."""
import os
from pathlib import Path
import re
import subprocess
import time


def control(serial, package, operation, timeout=45, *, shell_command=None):
    if package not in ('com.yepanywhere.host.experimental', 'com.yepanywhere.host.lab',
                       'com.yepanywhere.host.workspace.acceptance'):
        raise ValueError('Select an explicit supported host package')
    if operation not in ('start', 'stop', 'restart', 'status') or not 0 < timeout <= 120:
        raise ValueError('Select start/stop/restart/status and a timeout of 0–120 seconds')
    controller = Path(os.environ.get('MACHINE_CONTROL_ANDROID', Path.home() / 'code/machine-control/platforms/android/bin/android-device'))

    def shell(*words):
        if shell_command is None:
            result = subprocess.run([str(controller), '--serial', serial, 'shell', '--', *words],
                                    capture_output=True, text=True, timeout=20, check=True)
            output = result.stdout + result.stderr
        else:
            # The on-phone Lab tool reuses its already selected same-phone transport.
            output = shell_command(*words)
        # Android am/content can report errors while exiting successfully.
        if re.search(r'Error:|Exception|Permission Denial', output):
            raise RuntimeError(output.strip())
        return output.strip()

    def snapshot():
        output = shell('content', 'call', '--user', '0', '--uri',
                       'content://' + package + '.host-state', '--method', 'snapshot')
        phase = re.search(r'\bphase=(\w+)', output)
        generation = re.search(r'\bgeneration=([^,}\s]*)', output)
        if not phase:
            raise RuntimeError('No authoritative native host snapshot: ' + output)
        return phase.group(1), generation.group(1) if generation else '', output

    before = snapshot()
    if operation == 'status':
        print(before[2])
        return before
    # The shell identity has the background-start exemption and DUMP permission.
    # run-as here would lose both; foregrounding an activity is never a fallback.
    result = shell('am', 'startservice' if operation == 'stop' else 'start-foreground-service',
                   '--user', '0', '-n', package + '/com.yepanywhere.host.HostService',
                   '-a', 'host.' + operation)
    deadline = time.monotonic() + timeout
    current = before
    while time.monotonic() < deadline:
        current = snapshot()
        if current[0] == 'failed':
            raise RuntimeError(current[2])
        if (current[0] == ('stopped' if operation == 'stop' else 'ready')
                and (operation != 'restart' or current[1] != before[1])):
            print(current[2])
            return current
        time.sleep(.25)
    raise TimeoutError('Host ' + operation + ' did not finish: ' + result + '\n' + current[2])
