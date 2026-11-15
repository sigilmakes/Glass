import { readFileSync, readdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { spawnSync } from 'node:child_process';

function required(name) {
    const value = process.env[name];
    if (!value) throw new Error(`Missing release configuration: ${name}`);
    return value;
}
const handle = required('RELEASE_HANDLE');
const password = required('RELEASE_APP_PASSWORD');
const knot = required('TANGLED_REPO_KNOT');
const repository = required('TANGLED_REPO_REPO_DID');
const state = mkdtempSync(join(tmpdir(), 'glass-release-'));
const env = { ...process.env, XDG_STATE_HOME: state };
function goat(args, login = false) {
    const result = spawnSync('goat', args, {
        encoding: 'utf8', env: login ? { ...env, GOAT_USERNAME: handle, GOAT_PASSWORD: password } : env,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error('Tangled release authentication failed. Check the configured account and app password.');
    return result.stdout.trim();
}
async function write(method, body, contentType) {
    const token = goat(['account', 'service-auth', '--aud', repository, '--lxm', method]);
    const response = await fetch(`https://${knot}/xrpc/${method}`, {
        method: 'POST', redirect: 'error',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType }, body,
    });
    if (!response.ok) throw new Error(`Tangled artifact operation failed (${response.status}).`);
    return response.json();
}
try {
    goat(['account', 'login'], true);
    const revision = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
    if (revision.status !== 0) throw new Error('Cannot identify release commit.');
    for (const name of readdirSync('artifacts').filter(name => /\.(zip|tgz|js|json|css)$/.test(name))) {
        const contents = readFileSync(join('artifacts', name));
        if (contents.length > 50 * 1024 * 1024) throw new Error(`Artifact exceeds Tangled limit: ${name}`);
        const { blob } = await write('com.atproto.repo.uploadBlob', contents, 'application/octet-stream');
        await write('com.atproto.repo.createRecord', JSON.stringify({
            repo: repository, collection: 'org.tangled.repo.artifact',
            record: {
                $type: 'org.tangled.repo.artifact',
                subject: { $type: 'org.tangled.git.oid', oid: revision.stdout.trim() },
                name: basename(name), createdAt: new Date().toISOString(), artifact: blob,
            },
        }), 'application/json');
        console.log(`Attached ${name} to the Tangled release commit.`);
    }
} finally {
    spawnSync('goat', ['account', 'logout'], { env, stdio: 'ignore' });
}
