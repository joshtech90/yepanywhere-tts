"""Run inside the disposable app's Alpine/PRoot, using ordinary file syscalls."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import selectors
import sqlite3
import subprocess
import sys
import time

PRIVATE = Path('/home/host')
ROOT = Path('/workspace')
os.chdir(ROOT)


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def inventory():
    return {str(p.relative_to(ROOT)): digest(p) for p in sorted(ROOT.rglob('*')) if p.is_file() and not p.is_symlink()}


def save_inventory():
    (PRIVATE/'expected.json').write_text(json.dumps(inventory(), indent=2)+'\n')


def command(*args, **kwargs):
    try:
        return subprocess.run(args, check=True, capture_output=True, text=True, timeout=30, **kwargs).stdout
    except subprocess.CalledProcessError as error:
        print(error.stderr, file=sys.stderr)
        raise


def semantics():
    facts = {'cwd': str(Path.cwd()), 'kernelUid': Path('/proc/self/status').read_text().split('Uid:')[1].splitlines()[0].strip(),
             'selinux': Path('/proc/self/attr/current').read_text().strip('\0\n')}
    command('/bin/sh', '-c', "printf 'shell-direct\n' > shell.txt; mkdir crud; printf old > crud/old; mv crud/old crud/new; rm crud/new; rmdir crud")
    path = ROOT/'random.bin'
    with path.open('w+b') as stream:
        stream.truncate(1024*1024+17)
        assert os.pwrite(stream.fileno(), b'HEAD', 0) == 4
        assert os.pwrite(stream.fileno(), b'TAIL', 1024*1024+13) == 4
        os.fsync(stream.fileno())
        assert os.pread(stream.fileno(), 4, 1024*1024+13) == b'TAIL'
    assert path.stat().st_size == 1024*1024+17
    facts.update(shellCrud=True, randomWriteTruncateFileFsync=True)
    (ROOT/'replace.txt').write_bytes(b'old')
    with (ROOT/'replace.txt').open('rb') as old:
        with (ROOT/'replacement.tmp').open('wb') as new:
            new.write(b'new'); new.flush(); os.fsync(new.fileno())
        os.replace(ROOT/'replacement.tmp', ROOT/'replace.txt')
        assert old.read() == b'old' and (ROOT/'replace.txt').read_bytes() == b'new'
    facts['replaceWithOpenReader'] = True
    try:
        fd = os.open(ROOT, os.O_RDONLY | os.O_DIRECTORY)
        try: os.fsync(fd)
        finally: os.close(fd)
        facts['directoryFsync'] = 'supported'
    except OSError as error: facts['directoryFsync'] = {'errno': error.errno}
    for method in ('flock', 'lockf'):
        try:
            with (ROOT/'lock.txt').open('w') as lock:
                getattr(fcntl, method)(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                script = "import fcntl,sys; f=open('/workspace/lock.txt','r+');\ntry: fcntl.%s(f,fcntl.LOCK_EX|fcntl.LOCK_NB)\nexcept BlockingIOError: sys.exit(0)\nsys.exit(1)" % method
                command('/usr/bin/python3', '-c', script)
            facts[method+'CrossProcessContention'] = 'supported'
        except OSError as error:
            facts[method+'CrossProcessContention'] = {'errno': error.errno}
        except subprocess.CalledProcessError:
            facts[method+'CrossProcessContention'] = 'not enforced or child failed'
    try:
        (ROOT/'symlink').symlink_to('shell.txt')
        facts['symlink'] = {'created': True, 'isSymlink': (ROOT/'symlink').is_symlink()}
        (ROOT/'symlink').unlink()
    except OSError as error: facts['symlink'] = {'errno': error.errno}
    executable = ROOT/'executable.sh'; executable.write_text('#!/bin/sh\nexit 0\n'); executable.chmod(0o755)
    facts['modeAfterChmod755'] = oct(executable.stat().st_mode & 0o777)
    try:
        command(str(executable)); facts['directExecution'] = 'supported'
    except OSError as error: facts['directExecution'] = {'errno': error.errno}
    (ROOT/'Case.txt').write_text('upper'); (ROOT/'case.txt').write_text('lower')
    facts['caseSensitive'] = (ROOT/'Case.txt').read_text() == 'upper'
    repository = ROOT/'git-fixture'; repository.mkdir()
    env = {**os.environ, 'GIT_AUTHOR_NAME':'Workspace Fixture', 'GIT_AUTHOR_EMAIL':'fixture@example.invalid',
           'GIT_COMMITTER_NAME':'Workspace Fixture', 'GIT_COMMITTER_EMAIL':'fixture@example.invalid'}
    def git(*args): return command('git', '-c', 'safe.directory='+str(repository), '-C', str(repository), *args, env=env)
    git('init', '-b', 'main'); git('config', 'core.fileMode', 'false')
    (repository/'file.txt').write_text('first\n')
    try:
        git('add', '.'); facts['gitDefaultObjectCreation'] = 'supported'
    except subprocess.CalledProcessError:
        facts['gitDefaultObjectCreation'] = 'failed; core.createObject=rename required'
        git('config', 'core.createObject', 'rename'); git('add', '.')
    git('commit', '-m', 'fixture first')
    (repository/'file.txt').write_text('second\n'); git('commit', '-am', 'fixture second')
    git('checkout', 'HEAD~1', '--', 'file.txt'); assert (repository/'file.txt').read_text() == 'first\n'
    git('reset', '--hard', 'HEAD'); assert (repository/'file.txt').read_text() == 'second\n'
    (repository/'.git/index.lock').write_text('owned lock')
    blocked = subprocess.run(['git', '-c', 'safe.directory='+str(repository), '-C', str(repository), 'add', 'file.txt'], capture_output=True, text=True, timeout=10)
    assert blocked.returncode != 0 and 'index.lock' in blocked.stderr
    (repository/'.git/index.lock').unlink(); git('fsck', '--full'); facts['gitCrudCommitCheckoutLockFsck'] = True
    facts['gitExplicitTrustedDirectoryRequired'] = True
    database = ROOT/'sqlite-fixture.db'
    with sqlite3.connect(database) as connection:
        facts['sqliteJournalMode'] = connection.execute('PRAGMA journal_mode=WAL').fetchone()[0]
        connection.execute('CREATE TABLE data (value TEXT)'); connection.execute("INSERT INTO data VALUES ('durable')"); connection.commit()
        connection.execute('BEGIN IMMEDIATE')
        script = "import sqlite3,sys; c=sqlite3.connect('/workspace/sqlite-fixture.db',timeout=0);\ntry: c.execute('BEGIN IMMEDIATE')\nexcept sqlite3.OperationalError as e: sys.exit(0 if 'locked' in str(e) else 2)\nsys.exit(1)"
        command('/usr/bin/python3', '-c', script); connection.rollback()
        assert connection.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
        connection.execute('PRAGMA wal_checkpoint(TRUNCATE)')
    connection.close()
    facts['sqliteCrossProcessLockIntegrity'] = True
    (PRIVATE/'semantics.json').write_text(json.dumps(facts, indent=2)+'\n')
    save_inventory(); print(json.dumps(facts))


def providers():
    inference = json.loads((PRIVATE/'inference.json').read_text())
    challenge = (ROOT/'selection-witness.txt').read_text()
    summaries = []
    for provider in ('codex', 'claude'):
        home = PRIVATE/provider; home.mkdir(exist_ok=True, mode=0o700)
        env = {**os.environ, 'HOME':str(home), 'CODEX_HOME':str(home), 'CLAUDE_CONFIG_DIR':str(home),
               'AAR_TOKEN':inference['token'], 'OPENAI_API_KEY':inference['token'], 'ANTHROPIC_API_KEY':inference['token'],
               'ANTHROPIC_BASE_URL':inference['endpoint']+'/claude', 'DISABLE_AUTOUPDATER':'1',
               'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC':'1', 'USE_BUILTIN_RIPGREP':'0'}
        text = provider+'-'+challenge+'\n'
        prompt = f'''You are validating an explicitly owned disposable Android workspace. Work only in /workspace.
Read selection-witness.txt using your normal file tools; it contains {challenge}.
Use your normal file creation/edit tool to create {provider}.txt with EXACTLY this text including a final newline: {text!r}.
Then use your shell tool to run Python 3 that creates {provider}.bin in /workspace, writes b'HEAD' at offset 0,
writes b'TAIL' at offset 4096 using os.pwrite, and calls os.fsync before closing.
Read both files to verify. Do not modify anything else, initialize Git, or use network commands.
Report any failed operation honestly. Finish once these files are correct.'''
        if provider == 'codex':
            (home/'config.toml').write_text('model = "gpt-6.1-sol"\nmodel_reasoning_effort = "low"\nmodel_provider = "aar"\napproval_policy = "never"\nsandbox_mode = "danger-full-access"\n[model_providers.aar]\nname = "Temporary inference grant"\nbase_url = '+json.dumps(inference['endpoint']+'/codex')+'\nwire_api = "responses"\nenv_key = "AAR_TOKEN"\n')
            args = ['/opt/codex/bin/codex', 'exec', '--json', '--skip-git-repo-check', '--ephemeral', prompt]
        else:
            args = ['/opt/claude/claude', '--bare', '-p', prompt, '--output-format', 'stream-json', '--verbose',
                    '--model', 'sonnet', '--tools', 'Read,Write,Edit,Bash', '--allowedTools', 'Read,Write,Edit,Bash',
                    '--max-turns', '12', '--max-budget-usd', '1.00']
        events = []; started = time.monotonic()
        with (home/'stderr.log').open('wb') as errors:
            process = subprocess.Popen(args, cwd=ROOT, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=errors)
            selector = selectors.DefaultSelector(); selector.register(process.stdout, selectors.EVENT_READ)
            pending = b''
            try:
                while selector.get_map():
                    assert time.monotonic()-started < 180, provider+' timed out'
                    for key, _ in selector.select(.2):
                        chunk = os.read(key.fd, 65536)
                        if not chunk: selector.unregister(key.fileobj); continue
                        pending += chunk; assert len(pending) < 8*1024*1024
                        while b'\n' in pending:
                            line, pending = pending.split(b'\n', 1)
                            try: events.append(json.loads(line))
                            except ValueError: pass
                assert process.wait(timeout=5) == 0, provider+' failed'
            finally:
                selector.close()
                if process.poll() is None: process.kill(); process.wait()
        (home/'events.json').write_text(json.dumps(events, indent=2)+'\n')
        if provider == 'codex':
            assert any(e.get('type') == 'turn.completed' for e in events), 'Codex turn did not complete'
            calls = [e['item'] for e in events if e.get('type') == 'item.completed' and e.get('item', {}).get('type') in ('command_execution', 'file_change')]
            assert any(c['type'] == 'file_change' for c in calls), 'Codex did not exercise a file-edit tool'
            assert any(c['type'] == 'command_execution' for c in calls), 'Codex did not exercise shell'
        else:
            assert any(e.get('type') == 'result' and not e.get('is_error') for e in events), 'Claude turn did not complete'
            calls = [b for e in events if e.get('type') == 'assistant' for b in e.get('message', {}).get('content', []) if b.get('type') == 'tool_use']
            assert any(c.get('name') in ('Write','Edit') for c in calls), 'Claude did not exercise a file-edit tool'
            assert any(c.get('name') == 'Bash' for c in calls), 'Claude did not exercise shell'
        assert (ROOT/(provider+'.txt')).read_text() == text
        binary = (ROOT/(provider+'.bin')).read_bytes(); assert binary == b'HEAD'+bytes(4092)+b'TAIL'
        summaries.append({'provider':provider, 'toolCalls':len(calls), 'elapsedSeconds':round(time.monotonic()-started, 2),
                          'textSha256':digest(ROOT/(provider+'.txt')), 'binarySha256':digest(ROOT/(provider+'.bin'))})
    (PRIVATE/'providers.json').write_text(json.dumps(summaries, indent=2)+'\n')
    save_inventory(); print(json.dumps(summaries))


if __name__ == '__main__':
    if sys.argv[1] == 'semantics': semantics()
    elif sys.argv[1] == 'providers': providers()
    else:
        expected = json.loads((PRIVATE/'expected.json').read_text()); assert inventory() == expected
        with sqlite3.connect(ROOT/'sqlite-fixture.db') as connection:
            assert connection.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
            assert connection.execute('SELECT value FROM data').fetchone()[0] == 'durable'
        print(json.dumps({'verifiedFiles':len(expected), 'sqliteReopenIntegrity':True}))
