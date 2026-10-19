"""Pinned SDK JARs and Android ARM64 resource tools for the on-phone APK build."""
import hashlib
import io
import json
from pathlib import Path
import posixpath
import shutil
import subprocess
import tarfile
import zipfile


def digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def fetch(entry, downloads):
    target = downloads / entry['name']
    downloads.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        subprocess.run(['curl', '-fsSL', '--retry', '2', '--max-time', '120',
                        entry['url'], '-o', str(target)], check=True)
    if digest(target) != entry['sha256']:
        raise RuntimeError('Download hash mismatch: ' + entry['name'])
    return target


def prepare(work):
    lock = json.loads(Path(__file__).with_name('phone-toolchain.json').read_text())
    downloads = work / 'downloads'
    for entry in lock['sdk']:
        with zipfile.ZipFile(fetch(entry, downloads)) as archive:
            for name in entry['files']:
                archive.extract(name, work / 'sdk')
    # Read deb payloads directly: no dpkg install and no Termux-prefix mutation.
    # Flatten library symlinks since Android shell may reject adb-created links.
    files, links = {}, {}
    for entry in lock['termux']:
        data = fetch(entry, downloads).read_bytes()
        if data[:8] != b'!<arch>\n':
            raise RuntimeError('Invalid deb archive: ' + entry['name'])
        offset = 8
        while offset < len(data):
            header = data[offset:offset + 60]
            size = int(header[48:58])
            name = header[:16].decode().strip().rstrip('/')
            payload = data[offset + 60:offset + 60 + size]
            offset += 60 + size + size % 2
            if not name.startswith('data.tar'):
                continue
            with tarfile.open(fileobj=io.BytesIO(payload), mode='r:*') as archive:
                for member in archive:
                    parts = member.name.split('/usr/', 1)
                    if len(parts) != 2:
                        continue
                    relative = Path(parts[1])
                    if relative.is_absolute() or '..' in relative.parts:
                        raise RuntimeError('Unsafe package path')
                    if member.isfile():
                        files[str(relative)] = archive.extractfile(member).read()
                    elif member.issym():
                        links[str(relative)] = posixpath.normpath(str(relative.parent / member.linkname))
    tools = work / 'native-tools'
    if tools.exists():
        shutil.rmtree(tools)
    for name in files.keys() | links.keys():
        if name not in ('bin/aapt2', 'bin/zipalign') and not (name.startswith('lib/') and '.so' in name):
            continue
        target = name
        for _ in range(16):
            if target in files:
                break
            target = links[target]
        else:
            raise RuntimeError('Package symlink cycle')
        output = tools / name
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(files[target])
    return lock
