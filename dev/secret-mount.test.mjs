import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('file bind mounts keep secrets readable across container and host UIDs', t => {
    const directory = mkdtempSync(join(tmpdir(), 'glass-secret-mount-'));
    chmodSync(directory, 0o700);
    const file = join(directory, 'probe');
    writeFileSync(file, 'noncredential-permission-fixture', { mode: 0o644 });
    t.after(() => {
        unlinkSync(file);
        rmdirSync(directory);
    });
    const uid = process.getuid() === 1000 ? 1001 : 1000;
    const command = `try { require('node:fs').readFileSync('/secrets/probe'); }
        catch (error) { console.log(error.code); process.exit(1); }`;
    const read = mount => spawnSync('docker', [
        'run', '--rm', '--user', `${uid}:${uid}`, '-v', mount,
        'node:24-bookworm-slim', 'node', '-e', command
    ], { encoding: 'utf8' });
    const directoryMount = read(`${directory}:/secrets:ro`);
    assert.equal(directoryMount.status, 1);
    assert.match(directoryMount.stdout, /EACCES/);
    const fileMount = read(`${file}:/secrets/probe:ro`);
    assert.equal(fileMount.status, 0, 'A file bind mount must work without traversing the host directory');
});
