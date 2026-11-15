import { createRequire } from 'node:module';
import { readFile, writeFile, mkdtemp, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import https from 'node:https';

export const root = new URL('../../', import.meta.url);
export const requirePlugin = createRequire(new URL('plugin/package.json', root));
export const base = process.env.GLASS_TEST_URL || 'https://glass.localhost:8443';
export const secrets = new URL('../../dev/.local/', import.meta.url);

// Trust only the disposable fixture certificate and keep local DNS off the host configuration.
export async function fixtureFetch(input, options = {}) {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (!url.hostname.endsWith('.localhost')) throw new Error('Integration transport only permits local fixture hosts');
    const headers = Object.fromEntries(new Headers(options.headers));
    const body = options.body;
    if (body != null && !headers['content-length']) headers['content-length'] = Buffer.byteLength(body).toString();
    return new Promise((resolve, reject) => {
        const request = https.request(url, {
            method: options.method || 'GET', headers,
            ca: fixtureCertificate,
            lookup: (_hostname, _options, done) => done(null, [{ address: '127.0.0.1', family: 4 }]),
        }, response => {
            const chunks = [];
            response.on('data', chunk => chunks.push(chunk));
            response.on('end', () => {
                const bytes = Buffer.concat(chunks);
                const result = new Response(
                    [204, 205, 304].includes(response.statusCode) ? null : bytes,
                    { status: response.statusCode, headers: response.headers },
                );
                // PouchDB's Node HTTP adapter uses node-fetch's buffer() for binary attachments.
                result.buffer = async () => bytes;
                resolve(result);
            });
            response.on('error', reject);
        });
        request.on('error', reject);
        if (options.signal) {
            if (options.signal.aborted) request.destroy();
            else options.signal.addEventListener('abort', () => request.destroy(), { once: true });
        }
        request.end(body);
    });
}
let fixtureCertificate;
export async function dependencies() {
    fixtureCertificate = await readFile(new URL('tls.crt', secrets));
    const { transform } = requirePlugin('esbuild');
    const source = await readFile(new URL('plugin/src/glass/GlassSession.ts', root), 'utf8');
    const { code } = await transform(source, { loader: 'ts', format: 'esm', target: 'node24' });
    const temporary = await mkdtemp(join(tmpdir(), 'glass-integration-'));
    const compiled = join(temporary, 'GlassSession.mjs');
    await writeFile(compiled, code);
    let GlassSession;
    try {
        ({ GlassSession } = await import(pathToFileURL(compiled).href));
    } finally {
        await unlink(compiled);
        await rmdir(temporary);
    }
    const { chromium } = requirePlugin('playwright');
    const PouchDB = requirePlugin('pouchdb-core')
        .plugin(requirePlugin('pouchdb-adapter-memory'))
        .plugin(requirePlugin('pouchdb-adapter-http'))
        .plugin(requirePlugin('pouchdb-replication'));
    return { GlassSession, chromium, PouchDB };
}
export function memoryStore() {
    const data = new Map();
    return { getSecret: key => data.get(key) ?? null, setSecret: (key, value) => data.set(key, value) };
}

export async function browserLogin(browser, GlassSession, username, assert) {
    const store = memoryStore();
    const session = new GlassSession(store, 'integration', fixtureFetch);
    const authorizationURL = await session.signIn(base);
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
        const page = await context.newPage();
        await page.goto(authorizationURL);
        await page.getByRole('textbox', { name: /username/i }).fill(username);
        await page.locator('input[type="password"]').fill((await readFile(new URL(`${username}-password`, secrets), 'utf8')).trim());
        await page.getByRole('button', { name: /^sign in$/i }).click();
        const callbackResponse = page.waitForResponse(response =>
            new URL(response.url()).pathname === '/auth/callback' && response.request().method() === 'POST');
        await page.getByRole('button', { name: /^(accept|allow|authorize|consent)$/i }).click();
        const callback = await callbackResponse;
        assert.equal(callback.status(), 200);
        const responseHeaders = await callback.allHeaders();
        assert.match(responseHeaders['cache-control'], /no-store/);
        assert.equal(responseHeaders['referrer-policy'], 'no-referrer');
        assert.match(responseHeaders['content-security-policy'], /default-src 'none'/);
        const link = page.locator('a[href^="obsidian://glass-auth"]');
        await link.waitFor();
        const handoff = new URL(await link.getAttribute('href'));
        assert.deepEqual([...handoff.searchParams.keys()].sort(), ['code', 'state']);
        assert.equal(handoff.protocol, 'obsidian:');
        const params = Object.fromEntries(handoff.searchParams);
        await assert.rejects(session.callback({ ...params, state: 'incorrect-state' }));
        await session.callback(params);
        return { session, store };
    } finally {
        await context.close();
    }
}
