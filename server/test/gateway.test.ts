import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { Catalog } from '../src/catalog.ts';
import { Couch } from '../src/couch.ts';
import { createGateway, syncPath } from '../src/app.ts';
import { authFixture, close, config, listen } from './helpers.ts';

test('path parsing rejects database escapes, globals and double encoding', () => {
    for (const path of ['/sync/_users', '/sync/glass_aaa', '/sync/%2f_users', '/sync/%252f_users', '/sync/glass_' + 'a'.repeat(32) + '/%2e%2e/_users']) assert.throws(() => syncPath(path));
    assert.equal(syncPath('/sync/glass_' + 'a'.repeat(32) + '/_local/checkpoint').suffix, '_local/checkpoint');
});

test('auth, owner isolation, callback safety, checkpoint/bulk proxy and streaming', async t => {
    const auth = await authFixture();
    const seen: { path: string; headers: import('node:http').IncomingHttpHeaders; body: string }[] = [];
    const upstream = createServer(async (req, res) => {
        let body = ''; for await (const chunk of req) body += chunk;
        seen.push({ path: req.url!, headers: req.headers, body });
        if (req.url!.includes('_changes')) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.write('{"results":[');
            setTimeout(() => res.end('],"last_seq":"1"}'), 100);
        } else { res.writeHead(200, { 'Set-Cookie': 'AuthSession=bad' }); res.end('{"ok":true}'); }
    });
    const cfg = config(auth.url, await listen(upstream));
    const catalog = new Catalog(':memory:');
    const couch = new Couch(cfg);
    const gateway = createGateway(cfg, catalog, couch); const url = await listen(gateway);
    t.after(async () => { await close(gateway); await close(upstream); await close(auth.server); catalog.close(); });
    const call = (path: string, token = 'alice', init: RequestInit = {}) => fetch(url + path, { ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers } });
    assert.equal((await fetch(url + '/api/v1/me', { headers: { 'Remote-User': 'alice' } })).status, 401);
    assert.equal((await call('/api/v1/me', 'invalid')).status, 401);
    const alice = await (await call('/api/v1/me')).json();
    const created = await call('/api/v1/vaults', 'alice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"name":"Private title"}' });
    assert.equal(created.status, 201); const vault = await created.json();
    assert.equal(vault.url, 'https://glass.example/sync'); assert.ok(!vault.database.includes('Private'));
    assert.equal((await call(`/sync/${vault.database}`, 'bob')).status, 404);
    assert.equal((await call(`/api/v1/vaults/${vault.id}`, 'bob', { method: 'DELETE' })).status, 404);
    assert.deepEqual(await (await call('/api/v1/vaults', 'bob')).json(), { vaults: [] });
    for (const path of ['', '/_security']) assert.equal((await call(`/sync/${vault.database}${path}`, 'alice', { method: 'PUT' })).status, 403);
    const checkpoint = await call(`/sync/${vault.database}/_local/checkpoint`, 'alice', { method: 'PUT', headers: {
        'X-Auth-CouchDB-UserName': 'admin', 'X-Auth-CouchDB-Roles': '_admin', 'Remote-User': 'admin', Cookie: 'AuthSession=admin', 'Content-Type': 'application/json',
    }, body: '{"last_seq":"1"}' });
    assert.equal(checkpoint.status, 200); assert.equal(checkpoint.headers.get('set-cookie'), null);
    const proxied = seen.at(-1)!;
    assert.equal(proxied.headers.authorization, undefined); assert.equal(proxied.headers.cookie, undefined);
    assert.equal(proxied.headers['remote-user'], undefined); assert.equal(proxied.headers['x-auth-couchdb-username'], alice.id);
    assert.equal(proxied.headers['x-auth-couchdb-roles'], undefined);
    assert.equal(proxied.headers['x-auth-couchdb-token'], createHmac('sha256', cfg.proxySecret).update(alice.id).digest('hex'));
    assert.equal(proxied.body, '{"last_seq":"1"}');
    await call(`/sync/${vault.database}/_bulk_docs`, 'alice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"docs":[]}' });
    assert.ok(seen.at(-1)!.path.endsWith('/_bulk_docs'));
    const changes = await call(`/sync/${vault.database}/_changes?feed=continuous`);
    const reader = changes.body!.getReader();
    assert.equal(new TextDecoder().decode((await reader.read()).value), '{"results":[');
    await reader.cancel();
    const callback = await fetch(url + '/auth/callback', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code: '<script>', state: 'state', access_token: 'not-forwarded' }) });
    const html = await callback.text(); assert.equal(callback.status, 200); assert.ok(!html.includes('<script>')); assert.ok(!html.includes('not-forwarded')); assert.ok(html.includes('obsidian://glass-auth?'));
    assert.equal(callback.headers.get('referrer-policy'), 'no-referrer');
    catalog.state(vault.id, 'rebuilding');
    assert.equal((await call(`/sync/${vault.database}`)).status, 503);
});

test('failed rebuild closes access and owner can retry', async t => {
    const auth = await authFixture(); const cfg = config(auth.url, 'http://127.0.0.1:1');
    const catalog = new Catalog(':memory:'); const owner = catalog.user('alice'); const vault = catalog.create(owner.id, 'A'); catalog.state(vault.id, 'ready');
    const couch = new Couch(cfg); let fails = true;
    couch.drop = async () => {}; couch.provision = async () => { if (fails) throw new Error('offline'); };
    const gateway = createGateway(cfg, catalog, couch); const url = await listen(gateway);
    t.after(async () => { await close(gateway); await close(auth.server); catalog.close(); });
    const headers = { Authorization: 'Bearer alice' };
    assert.equal((await fetch(`${url}/api/v1/vaults/${vault.id}/rebuild`, { method: 'POST', headers })).status, 502);
    assert.equal((await fetch(`${url}/sync/${vault.database}`, { headers })).status, 503);
    fails = false;
    assert.equal((await fetch(`${url}/api/v1/vaults/${vault.id}/rebuild`, { method: 'POST', headers })).status, 200);
    assert.equal(catalog.get(vault.id, owner.id)!.state, 'ready');
});
