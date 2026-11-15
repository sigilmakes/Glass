import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.ts';
import { Catalog } from '../src/catalog.ts';
import { Couch } from '../src/couch.ts';
import { createGateway } from '../src/app.ts';
import { authFixture, close, listen } from './helpers.ts';

test('real CouchDB bootstrap, ACL, replication, rebuild and deletion', { skip: !process.env.COUCHDB_URL }, async t => {
    const auth = await authFixture();
    t.after(() => close(auth.server));
    const cfg = loadConfig({ ...process.env, PUBLIC_URL: 'http://127.0.0.1:3000', AUTH_ISSUER: auth.url, AUTH_CLIENT_ID: 'glass-test', AUTH_AUDIENCE: 'http://127.0.0.1:3000', SQLITE_PATH: ':memory:' });
    const catalog = new Catalog(':memory:'); const couch = new Couch(cfg); await couch.bootstrap();
    const gateway = createGateway(cfg, catalog, couch); const url = await listen(gateway);
    const paths: string[] = [];
    t.after(async () => { for (const db of paths) await couch.drop(db); await close(gateway); catalog.close(); });
    const call = (path: string, method = 'GET', body?: unknown, token = 'alice') => fetch(url + path, {
        method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    const response = await call('/api/v1/vaults', 'POST', { name: 'Real CouchDB' }); assert.equal(response.status, 201);
    const vault = await response.json(); paths.push(vault.database); const base = `/sync/${vault.database}`;
    const me = await (await call('/api/v1/me')).json();
    const acl = await fetch(`${cfg.couchUrl}/${vault.database}/_security`, { headers: { Authorization: `Basic ${Buffer.from(`${cfg.adminUsername}:${cfg.adminPassword}`).toString('base64')}` } });
    assert.deepEqual((await acl.json()).members, { names: [me.id], roles: [] });
    assert.equal((await call(base, 'GET', undefined, 'bob')).status, 404);
    const directBob = await fetch(`${cfg.couchUrl}/${vault.database}`, { headers: couch.identity(catalog.user('bob').id) });
    assert.equal(directBob.status, 403);
    const ids = ['note', 'nested/folder/note.md', '日本語/100% complete.md'];
    const bulk = await call(base + '/_bulk_docs', 'POST', { docs: ids.map(_id => ({ _id, text: 'hello' })) }); assert.equal(bulk.status, 201);
    for (const id of ids) {
        const note = await call(base + '/' + encodeURIComponent(id));
        assert.equal(note.status, 200); assert.equal((await note.json())._id, id);
    }
    const welcome = await call('/sync'); assert.equal(welcome.status, 200);
    assert.match((await welcome.json()).version, /^3\./);
    assert.equal((await call(base + '/note')).status, 200);
    const checkpoint = await call(base + '/_local/checkpoint', 'PUT', { last_seq: '1' }); assert.equal(checkpoint.status, 201);
    assert.equal((await call(base + '/_local/checkpoint')).status, 200);
    assert.equal((await call(base + '/_revs_diff', 'POST', { note: ['1-missing'] })).status, 200);
    const changes = await call(base + '/_changes?since=0'); assert.equal(changes.status, 200); assert.equal((await changes.json()).results.length, ids.length);
    assert.equal((await call(`/api/v1/vaults/${vault.id}/rebuild`, 'POST')).status, 200);
    assert.equal((await call(base + '/note')).status, 404);
    const restored = await fetch(`${cfg.couchUrl}/${vault.database}`, { headers: couch.identity(catalog.user('bob').id) }); assert.equal(restored.status, 403);
    assert.equal((await call(`/api/v1/vaults/${vault.id}`, 'DELETE')).status, 204);
    assert.equal((await call(base)).status, 404);
});
