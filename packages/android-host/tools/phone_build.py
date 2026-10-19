#!/usr/bin/env python3
"""Build the isolated YA Host Lab APK on ARM64 Alpine; never install an APK.

Javac, D8 and apksigner run in the guest. AAPT2 and zipalign run as Android
shell on the explicitly selected same-phone ADB device. This does not rebuild
the Linux/server payload or replace the Gradle release pipeline.
"""
import argparse
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import time
import uuid
import xml.etree.ElementTree as ET
import zipfile
from phone_toolchain import digest, fetch, prepare

HOST = Path(__file__).resolve().parents[1]
REPO = HOST.parents[1]
LAB = 'com.yepanywhere.host.lab'
PORT = 13410
NS = 'http://schemas.android.com/apk/res/android'


def build(args):
    work = args.work_dir.resolve()
    work.mkdir(parents=True, exist_ok=True)
    storage = args.machine_control_root / 'platforms/android/storage/src/main/java'
    if not storage.is_dir() or not args.keystore.is_file():
        raise RuntimeError('Supply the MC storage checkout and an existing private debug keystore')
    started = time.monotonic()
    lock = prepare(work)
    out = work / 'phone-lab'
    if out.exists():
        shutil.rmtree(out)
    out.mkdir()
    source = out / 'source'
    shutil.copytree(HOST / 'app/src/main', source)
    # Identity changes belong only to this staging tree; normal app sources stay intact.
    strings = source / 'res/values/strings.xml'
    tree = ET.parse(strings)
    for node in tree.getroot().findall('string'):
        if node.get('name') == 'host_heading':
            node.text = 'YA Host Lab · Test app'
        elif node.get('name') == 'host_web_title':
            node.text = 'YA Host Lab'
    tree.write(strings, encoding='utf-8', xml_declaration=True)
    icon = source / 'res/drawable/host_lab_icon.xml'
    icon.parent.mkdir(exist_ok=True)
    icon.write_text('''<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="48dp" android:height="48dp" android:viewportWidth="48" android:viewportHeight="48">
  <path android:fillColor="#7C3AED" android:pathData="M10,0L38,0Q48,0 48,10L48,38Q48,48 38,48L10,48Q0,48 0,38L0,10Q0,0 10,0Z" />
  <path android:fillColor="#FFFFFF" android:pathData="M18,12L22,12L22,15L21,15L21,23L12,36L36,36L27,23L27,15L26,15L26,12L30,12L30,9L18,9ZM23,24L25,24L31,33L17,33ZM20,28L28,28L30,31L18,31Z" />
</vector>''')
    for path in (source / 'java').rglob('*.java'):
        text = path.read_text()
        if path.name == 'HostActivity.java':
            text = text.replace('heading.setTextSize(22);', 'heading.setTextSize(22); heading.setTextColor(android.graphics.Color.rgb(124, 58, 237));')
            text = text.replace('"Start local host"', '"Start lab host"').replace('"Stop local host"', '"Stop lab host"').replace('"Open Yep Anywhere"', '"Open YA Host Lab"')
        path.write_text(text)
    ET.register_namespace('android', NS)
    # Gradle normally expands applicationId placeholders (notably the private state provider).
    path = source / 'AndroidManifest.xml'
    expanded = path.read_text().replace('${applicationId}', LAB).replace('${hostAdbExported}', 'true')
    if '${' in expanded:
        raise RuntimeError('Unsupported Gradle manifest placeholder')
    path.write_text(expanded)
    manifest = ET.parse(source / 'AndroidManifest.xml')
    manifest.getroot().set('package', LAB)
    app = manifest.getroot().find('application')
    app.set('{' + NS + '}label', 'YA Host Lab')
    app.set('{' + NS + '}icon', '@drawable/host_lab_icon')
    app.set('{' + NS + '}debuggable', 'true')
    for node in app:
        name = node.get('{' + NS + '}name', '')
        if name.startswith('.'):
            node.set('{' + NS + '}name', 'com.yepanywhere.host' + name)
    manifest.write(source / 'AndroidManifest.xml', encoding='utf-8', xml_declaration=True)
    generated = out / 'generated/com/yepanywhere/host'
    generated.mkdir(parents=True)
    (generated / 'BuildConfig.java').write_text(
        f'package com.yepanywhere.host; public final class BuildConfig {{ public static final int HOST_PORT = {PORT}; }}\n')
    assets = out / 'assets'
    assets.mkdir()
    shutil.copyfile(args.machine_control_root / 'LICENSE', assets / 'machine-control-LICENSE.txt')
    native = out / 'lib/arm64-v8a'
    native.mkdir(parents=True)
    for entry in json.loads((HOST / 'runtime/artifacts.json').read_text())['artifacts']:
        if entry['name'] == 'buddy.apk':
            with zipfile.ZipFile(fetch(entry, work / 'downloads')) as archive:
                for name in ('libproot.so', 'libproot-loader.so', 'libtalloc.so', 'libandroid-shmem.so'):
                    (native / name).write_bytes(archive.read('lib/arm64-v8a/' + name))
        elif entry['name'].startswith('notice-'):
            shutil.copyfile(fetch(entry, work / 'downloads'), assets / entry['name'].removeprefix('notice-'))

    adb = ['adb', '-s', args.serial]
    remote = '/data/local/tmp/ya-phone-build-' + uuid.uuid4().hex

    def run(*command, **kwargs):
        return subprocess.run([str(word) for word in command], check=True, timeout=180, **kwargs)

    def shell(*words):
        return run(*adb, 'shell', '-T', shlex.join([str(word) for word in words]))

    def aapt(*words):
        return shell('env', 'LD_LIBRARY_PATH=' + remote + '/native-tools/lib', remote + '/native-tools/bin/aapt2', *words)

    def push(path, target):
        return run(*adb, 'push', path, target)

    def pull(path, target):
        return run(*adb, 'pull', path, target)

    # No automatic connect, key enrollment or debugging-listener changes.
    run(*adb, 'get-state')
    try:
        shell('mkdir', '-p', remote + '/generated')
        push(work / 'native-tools', remote + '/')
        shell('chmod', '755', remote + '/native-tools/bin/aapt2', remote + '/native-tools/bin/zipalign')
        push(source / 'res', remote + '/')
        push(source / 'AndroidManifest.xml', remote + '/AndroidManifest.xml')
        push(work / 'sdk/android-36/android.jar', remote + '/android.jar')
        push(assets, remote + '/')
        aapt('compile', '--dir', remote + '/res', '-o', remote + '/compiled.zip')
        aapt('link', '-o', remote + '/resources.apk', '-I', remote + '/android.jar',
             '--manifest', remote + '/AndroidManifest.xml', '--java', remote + '/generated',
             '--custom-package', 'com.yepanywhere.host', '--min-sdk-version', '30',
             '--target-sdk-version', '36', '--version-code', '1', '--version-name',
             '0.1.0-lab', '-A', remote + '/assets', remote + '/compiled.zip')
        pull(remote + '/resources.apk', out / 'resources.apk')
        pull(remote + '/generated', out)
        classes = out / 'classes'
        classes.mkdir()
        sources = sorted((source / 'java').rglob('*.java')) + sorted((out / 'generated').rglob('*.java')) + sorted(storage.rglob('*.java'))
        classpath = os.pathsep.join(str(work / name) for name in ('sdk/android-36/android.jar', 'sdk/android-16/core-lambda-stubs.jar'))
        run('javac', '-J-Xmx512m', '-encoding', 'UTF-8', '--release', '17', '-classpath', classpath, '-d', classes, *sources)
        jar = out / 'classes.jar'
        with zipfile.ZipFile(jar, 'w', zipfile.ZIP_DEFLATED) as archive:
            for path in sorted(classes.rglob('*.class')):
                archive.write(path, path.relative_to(classes))
        dex = out / 'dex'
        dex.mkdir()
        run('java', '-Xmx768m', '-cp', work / 'sdk/android-16/lib/d8.jar', 'com.android.tools.r8.D8',
            '--release', '--min-api', '30', '--lib', work / 'sdk/android-36/android.jar', '--output', dex, jar)
        unsigned = out / 'unsigned.apk'
        shutil.copyfile(out / 'resources.apk', unsigned)
        with zipfile.ZipFile(unsigned, 'a', zipfile.ZIP_DEFLATED) as archive:
            for path in sorted(dex.glob('*.dex')):
                archive.write(path, path.name)
            for path in sorted(native.glob('*.so')):
                archive.write(path, 'lib/arm64-v8a/' + path.name)
        push(unsigned, remote + '/unsigned.apk')
        shell('env', 'LD_LIBRARY_PATH=' + remote + '/native-tools/lib', remote + '/native-tools/bin/zipalign', '-f', '4', remote + '/unsigned.apk', remote + '/aligned.apk')
        pull(remote + '/aligned.apk', out / 'aligned.apk')
        apk = out / 'android-host-lab-debug.apk'
        signer = ['java', '-Xmx256m', '-jar', work / 'sdk/android-16/lib/apksigner.jar']
        run(*signer, 'sign', '--ks', args.keystore, '--ks-pass', 'pass:android', '--key-pass', 'pass:android', '--out', apk, out / 'aligned.apk')
        run(*signer, 'verify', '--verbose', apk)
        push(apk, remote + '/signed.apk')
        aapt('dump', 'badging', remote + '/signed.apk')
    finally:
        shell('rm', '-rf', remote)
    provenance = {
        'applicationId': LAB, 'port': PORT, 'apkSha256': digest(apk),
        'sourceRevision': subprocess.check_output(['git', '-C', str(REPO), 'rev-parse', 'HEAD'], text=True).strip(),
        'sourceFiles': {str(path.relative_to(source)): digest(path) for path in source.rglob('*') if path.is_file()},
        'machineControlFiles': {str(path.relative_to(storage)): digest(path) for path in storage.rglob('*.java')},
        'toolchain': lock, 'elapsedSeconds': round(time.monotonic() - started, 3),
        'method': 'manual native APK only; no Gradle, payload rebuild or installation',
    }
    (out / 'provenance.json').write_text(json.dumps(provenance, indent=2) + '\n')
    print('Built', apk, 'in', provenance['elapsedSeconds'], 'seconds')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--serial', required=True, help='Explicit same-phone ADB serial')
    parser.add_argument('--work-dir', type=Path, required=True, help='Private writable build/cache directory')
    parser.add_argument('--machine-control-root', type=Path, required=True)
    parser.add_argument('--keystore', type=Path, required=True, help='Private debug keystore using the standard android password')
    build(parser.parse_args())
