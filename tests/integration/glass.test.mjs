import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';
import { base, dependencies, fixtureFetch, browserLogin, secrets, requirePlugin } from './fixture.mjs';

const live = process.env.GLASS_INTEGRATION === '1';
test('stock Authelia browser PKCE, bearer authorization and real PouchDB replication', {
    skip: !live && 'Set GLASS_INTEGRATION=1 after starting the disposable dev fixture', timeout: 180000,
}, async t => {
    const { GlassSession, chromium, PouchDB } = await dependencies();
    const browser = await chromium.launch({
        ...(process.env.GLASS_CHROMIUM ? { executablePath: process.env.GLASS_CHROMIUM } : {}),
        args: ['--no-sandbox', '--host-resolver-rules=MAP *.glass.localhost 127.0.0.1,MAP glass.localhost 127.0.0.1'],
    });
    t.after(() => browser.close());
    const alice = await browserLogin(browser, GlassSession, 'developer', assert);
    const bob = await browserLogin(browser, GlassSession, 'other', assert);
    const me = await alice.session.api('me');
    const other = await bob.session.api('me');
    assert.notEqual(me.id, other.id);
    assert.equal(me.username, 'developer');
    assert.equal(other.username, 'other');
    const vault = await alice.session.createVault(`Private test ${Date.now()}`);
    const otherVault = await bob.session.createVault(`Other private test ${Date.now()}`);
    t.after(async () => {
        for (const [user, owned] of [[alice, vault], [bob, otherVault]]) {
            const token = JSON.parse(user.store.getSecret('integration')).tokens.access_token;
            const response = await fixtureFetch(`${base}/api/v1/vaults/${owned.id}`, {
                method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
            });
            assert.equal(response.status, 204);
        }
    });
    assert.equal(vault.url, `${base}/sync`);
    assert.match(vault.database, /^glass_[a-z0-9_]+$/);
    assert.ok(!(await bob.session.vaults()).some(v => v.id === vault.id));
    assert.ok(!(await alice.session.vaults()).some(v => v.id === otherVault.id));
    await alice.session.selectVault(vault.id);
    const sendAs = (user, path, options) => user.session.transport(`${base}${path}`, options, fixtureFetch);
    await t.test('missing, invalid and spoofed identity rejected', async () => {
        for (const headers of [{}, { Authorization: 'Bearer definitely-invalid' }, { 'Remote-User': 'developer', 'X-Auth-CouchDB-UserName': me.id, 'X-Auth-CouchDB-Roles': '_admin' }]) {
            const response = await fixtureFetch(`${base}/api/v1/me`, { headers });
            assert.ok([401, 403].includes(response.status), `Expected authentication rejection; got ${response.status}`);
        }
    });
    await t.test('cross-owner database, checkpoints, lifecycle and global endpoints rejected', async () => {
        for (const path of [`/sync/${vault.database}`, `/sync/${vault.database}/_local/checkpoint`, `/sync/${vault.database}%2f_local/checkpoint`, '/sync/_all_dbs', '/sync/_users', '/sync/_node/_local/_config', `/sync/${vault.database}/_security`]) {
            const response = await sendAs(bob, path);
            assert.ok([400, 403, 404].includes(response.status), `Cross-owner/global path accepted (${response.status})`);
        }
        for (const method of ['DELETE', 'POST']) {
            const response = await fixtureFetch(`${base}/api/v1/vaults/${vault.id}${method === 'POST' ? '/rebuild' : ''}`, {
                method, headers: { Authorization: `Bearer ${JSON.parse(bob.store.getSecret('integration')).tokens.access_token}` },
            });
            assert.ok([403, 404].includes(response.status));
        }
    });
    const local = new PouchDB(`alice-${Date.now()}`, { adapter: 'memory' });
    const second = new PouchDB(`second-${Date.now()}`, { adapter: 'memory' });
    const remote = new PouchDB(`${vault.url}/${vault.database}`, {
        skip_setup: true,
        fetch: (url, opts) => alice.session.transport(url, opts, fixtureFetch),
    });
    t.after(async () => { await local.destroy(); await second.destroy(); await remote.close(); });
    await t.test('two-way replication, checkpoints, attachments and deletion', async () => {
        await local.put({ _id: 'note', text: 'from first device', _attachments: {
            'sample.txt': { content_type: 'text/plain', data: Buffer.from('attachment bytes') },
        } });
        const nestedId = 'notes/nested/é 100%.md';
        await local.put({ _id: nestedId, text: 'nested unicode and percent ID' });
        await local.replicate.to(remote);
        await second.replicate.from(remote);
        assert.equal((await second.get(nestedId)).text, 'nested unicode and percent ID');
        assert.equal((await remote.get(nestedId)).text, 'nested unicode and percent ID');
        assert.equal((await second.get('note')).text, 'from first device');
        assert.equal((await second.getAttachment('note', 'sample.txt')).toString(), 'attachment bytes');
        const note = await second.get('note');
        await second.put({ ...note, text: 'from second device' });
        await second.replicate.to(remote);
        await local.replicate.from(remote);
        assert.equal((await local.get('note')).text, 'from second device');
        await second.remove(await second.get('note'));
        await second.replicate.to(remote);
        await local.replicate.from(remote);
        await assert.rejects(local.get('note'), error => error.status === 404);
    });
    await t.test('serialized rotating refresh tokens remain usable', async () => {
        const saved = JSON.parse(alice.store.getSecret('integration'));
        const previous = saved.tokens.refresh_token;
        saved.tokens.expiresAt = 0;
        alice.store.setSecret('integration', JSON.stringify(saved));
        await Promise.all([alice.session.api('me'), alice.session.vaults(), alice.session.api('me')]);
        const refreshed = JSON.parse(alice.store.getSecret('integration'));
        assert.ok(refreshed.tokens.refresh_token !== previous, 'Refresh token must rotate');
        assert.ok(refreshed.tokens.expiresAt > Date.now());
    });
    await t.test('disabled Authelia account loses bearer access and re-enable preserves its vault', {
        skip: process.env.GLASS_TEST_RESTART !== '1' && 'Set GLASS_TEST_RESTART=1 to authorize disposable account changes',
    }, async () => {
        const usersFile = new URL('users.yml', secrets);
        const original = await readFile(usersFile);
        const { parse, stringify } = requirePlugin('yaml');
        const users = parse(original.toString('utf8'));
        assert.ok(users.users.other && !users.users.other.disabled, 'Fixture other user must initially be enabled');
        const headers = { Authorization: `Bearer ${JSON.parse(bob.store.getSecret('integration')).tokens.access_token}` };
        const documentURL = `${otherVault.url}/${otherVault.database}/account-disable-preserved`;
        const created = await fixtureFetch(documentURL, {
            method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: 'preserved while owner disabled' }),
        });
        assert.equal(created.status, 201);
        const recreateAuthelia = () => promisify(execFile)('docker', ['compose', '--env-file', 'dev/.local/compose.env',
            '-f', 'dev/compose.yaml', 'up', '-d', '--wait', '--force-recreate', 'authelia'], {
            cwd: fileURLToPath(new URL('../../', import.meta.url)),
        });
        try {
            users.users.other.disabled = true;
            await writeFile(usersFile, stringify(users));
            await recreateAuthelia();
            for (const url of [`${base}/api/v1/me`, `${base}/api/v1/vaults`, documentURL]) {
                const response = await fixtureFetch(url, { headers });
                assert.ok([401, 403].includes(response.status), `Disabled user's existing bearer was not denied (${response.status})`);
            }
            assert.equal((await alice.session.api('me')).id, me.id);
        } finally {
            await writeFile(usersFile, original);
            await recreateAuthelia();
            assert.ok((await readFile(usersFile)).equals(original), 'Fixture users file must be restored byte-for-byte');
        }
        const enabled = await fixtureFetch(`${base}/api/v1/me`, { headers });
        assert.equal(enabled.status, 200, 'Existing bearer should work again after account re-enable');
        assert.equal((await enabled.json()).id, other.id);
        assert.ok((await bob.session.vaults()).some(v => v.id === otherVault.id));
        const preserved = await fixtureFetch(documentURL, { headers });
        assert.equal(preserved.status, 200);
        assert.equal((await preserved.json()).text, 'preserved while owner disabled');
    });
    await t.test('gateway and CouchDB recreation preserve catalogue, documents and ACL', {
        skip: process.env.GLASS_TEST_RESTART !== '1' && 'Set GLASS_TEST_RESTART=1 to authorize disposable fixture recreation',
    }, async () => {
        await remote.put({ _id: 'persistent', text: 'survives recreation' });
        await promisify(execFile)('docker', ['compose', '--env-file', 'dev/.local/compose.env',
            '-f', 'dev/compose.yaml', 'up', '-d', '--wait', '--force-recreate', 'couchdb', 'gateway'], {
            cwd: fileURLToPath(new URL('../../', import.meta.url)),
        });
        assert.ok((await alice.session.vaults()).some(v => v.id === vault.id));
        assert.equal((await remote.get('persistent')).text, 'survives recreation');
        const response = await sendAs(bob, `/sync/${vault.database}/persistent`);
        assert.ok([403, 404].includes(response.status));
    });
    await t.test('rebuild resets database and restores owner-only ACL', async () => {
        await remote.put({ _id: 'before-rebuild', text: 'must disappear' });
        const rebuilt = await alice.session.api(`vaults/${vault.id}/rebuild`, { method: 'POST' });
        assert.equal(rebuilt.database, vault.database);
        await assert.rejects(remote.get('before-rebuild'), error => error.status === 404);
        await remote.put({ _id: 'after-rebuild', text: 'owner can write' });
        const response = await sendAs(bob, `/sync/${vault.database}/after-rebuild`);
        assert.ok([403, 404].includes(response.status));
    });
});
