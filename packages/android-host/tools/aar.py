#!/usr/bin/env python3
"""Temporary USB development authentication; never copies upstream credentials.

start provisions a revocable grant and inference reverse; it does not start an
agent. stop revokes first, stops only the experimental app, and removes its
temporary configuration/tunnel. The private lease survives cleanup failures.
"""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import urllib.error
import urllib.request
import uuid

from host import APP, LOCAL

LEASE = LOCAL / 'aar-lease.json'


def aar(checkout, *args):
    return subprocess.check_output(['node', str(checkout / 'src/cli.ts'), *args],
                                   text=True, cwd=checkout, stderr=subprocess.PIPE)


def stop(serial, lease):
    if serial != lease['serial']:
        raise RuntimeError('Selected device differs from the private lease')
    checkout = Path(lease['checkout'])
    try:
        aar(checkout, 'client', 'revoke', lease['client'])
    except subprocess.CalledProcessError:
        rows = aar(checkout, 'client', 'list').splitlines()
        if not any(lease['client'] in row.split('\t') and 'revoked' in row.split('\t') for row in rows):
            raise RuntimeError('Could not verify gateway revocation') from None
    for provider in ['claude', 'codex']:
        path = 'v1/models' if provider == 'claude' else 'models'
        request = urllib.request.Request(f'http://127.0.0.1:8417/{provider}/{path}',
                                         headers={'Authorization': 'Bearer ' + lease['token']})
        try:
            urllib.request.urlopen(request, timeout=5).close()
            raise RuntimeError('Revoked grant was accepted')
        except urllib.error.HTTPError as error:
            if error.code != 401:
                raise RuntimeError('Unexpected revocation verification status') from None
    adb = ['adb', '-s', serial]
    subprocess.run([*adb, 'shell', 'am', 'force-stop', APP], check=True, capture_output=True)
    subprocess.run([*adb, 'shell', 'run-as', APP, 'rm', '-f', 'files/state/development.json'], check=True, capture_output=True)
    mappings = subprocess.check_output([*adb, 'reverse', '--list'], text=True)
    if lease.get('reverseOwned') and 'tcp:18417' in mappings:
        subprocess.run([*adb, 'reverse', '--remove', 'tcp:18417'], check=True, capture_output=True)
    LEASE.unlink(missing_ok=True)
    print('Development grant revoked (401 verified); host stopped; temporary config and tunnel removed.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['start', 'stop'])
    parser.add_argument('--serial', required=True)
    parser.add_argument('--aar-checkout', type=Path)
    parser.add_argument('--claude-account')
    parser.add_argument('--codex-account')
    args = parser.parse_args()
    if args.action == 'stop':
        if LEASE.exists():
            stop(args.serial, json.loads(LEASE.read_text()))
        else:
            print('No active AAR development lease.')
        return
    if not all([args.aar_checkout, args.claude_account, args.codex_account]):
        parser.error('start requires an AAR checkout and explicit Claude/Codex subscription accounts')
    if LEASE.exists():
        raise RuntimeError('Stop the existing development lease first')
    controller = Path(os.environ.get('MACHINE_CONTROL_ANDROID', Path.home() / 'code/machine-control/platforms/android/bin/android-device'))
    if not json.loads(subprocess.check_output([str(controller), '--serial', args.serial, 'doctor', '--json']))['ready']:
        raise RuntimeError('Selected device is not ready')
    adb = ['adb', '-s', args.serial]
    if 'tcp:18417' in subprocess.check_output([*adb, 'reverse', '--list'], text=True):
        raise RuntimeError('Refusing to replace an existing inference reverse')
    result = subprocess.run([*adb, 'shell', 'run-as', APP, 'test', '-e', 'files/state/development.json'], capture_output=True)
    if result.returncode != 1:
        raise RuntimeError('Development configuration already exists or app is unavailable')
    client = 'android-host-dev-' + uuid.uuid4().hex
    checkout = args.aar_checkout.resolve()
    output = aar(checkout, 'client', 'add', client,
                 '--claude', args.claude_account, '--codex', args.codex_account)
    matches = re.findall(r'\baar_[A-Za-z0-9_-]{43}\b', output)
    if not matches:
        aar(checkout, 'client', 'revoke', client)
        raise RuntimeError('Router did not return a gateway grant')
    token = matches[0]
    lease = {'serial': args.serial, 'checkout': str(checkout), 'client': client, 'token': token, 'reverseOwned': False}
    LOCAL.mkdir(parents=True, exist_ok=True)
    # Persist recovery before mutating phone state; never print the credential.
    try:
        descriptor = os.open(LEASE, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except BaseException:
        # A concurrent setup may own the lease; revoke only our new client.
        aar(checkout, 'client', 'revoke', client)
        raise
    with os.fdopen(descriptor, 'w') as file:
        json.dump(lease, file)
    try:
        subprocess.run([*adb, 'shell', 'am', 'force-stop', APP], check=True, capture_output=True)
        subprocess.run([*adb, 'shell', 'run-as', APP, 'mkdir', '-p', 'files/state'], check=True, capture_output=True)
        payload = json.dumps({'providerMode': 'aar', 'aarToken': token})
        subprocess.run([*adb, 'shell', '-T', 'run-as', APP, 'tee', 'files/state/development.json'],
                       input=payload.encode(), stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, check=True)
        subprocess.run([*adb, 'shell', 'run-as', APP, 'chmod', '600', 'files/state/development.json'], check=True, capture_output=True)
        subprocess.run([*adb, 'reverse', 'tcp:18417', 'tcp:8417'], check=True, capture_output=True)
        lease['reverseOwned'] = True
        with LEASE.open('w') as file:
            json.dump(lease, file)
        print('AAR development mode ready. Start the host from its launcher; run aar.py stop afterward.')
    except BaseException:
        stop(args.serial, lease)
        raise


if __name__ == '__main__':
    main()
