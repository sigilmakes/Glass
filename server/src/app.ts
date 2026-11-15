import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { pipeline } from 'node:stream/promises';
import { Catalog, type Vault } from './catalog.ts';
import { Couch } from './couch.ts';
import { authenticate } from './auth.ts';
import type { Config } from './config.ts';

class HttpError extends Error {
    status: number;
    constructor(status: number, message: string) { super(message); this.status = status; }
}
function json(res: ServerResponse, status: number, body?: unknown) {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(body === undefined ? undefined : JSON.stringify(body));
}
async function body(req: IncomingMessage, limit: number): Promise<string> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
        size += chunk.length;
        if (size > limit) throw new HttpError(413, 'Request too large');
        chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
}
export function syncPath(raw: string): { database: string; suffix: string } {
    const path = raw.split('?')[0];
    const segments = path.slice('/sync/'.length).split('/');
    let decoded: string[];
    try { decoded = segments.map(s => decodeURIComponent(s)); }
    catch { throw new HttpError(400, 'Invalid path'); }
    if (/[\\/%\0]/.test(decoded[0]) || !/^glass_[a-f0-9]{32}$/.test(decoded[0])) throw new HttpError(404, 'Unknown database');
    if (decoded.slice(1).some(s => /[\\\0]/.test(s) || s.split('/').some(part => part === '.' || part === '..'))) throw new HttpError(400, 'Invalid path');
    return { database: decoded[0], suffix: decoded.slice(1).join('/') };
}
const hopHeaders = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);
export function createGateway(config: Config, catalog: Catalog, couch: Couch) {
    const operations = new Map<string, Promise<void>>();
    const streams = new Map<string, Set<AbortController>>();
    const describe = (vault: Vault) => ({ id: vault.id, name: vault.name, database: vault.database, createdAt: vault.createdAt, url: `${config.publicUrl}/sync` });
    async function lifecycle(vault: Vault, remove: boolean) {
        const previous = operations.get(vault.id) ?? Promise.resolve();
        const next = previous.catch(() => {}).then(async () => {
            const current = catalog.get(vault.id, vault.owner);
            if (!current) throw new HttpError(404, 'Unknown vault');
            catalog.state(vault.id, remove ? 'deleting' : 'rebuilding');
            for (const controller of streams.get(vault.id) ?? []) controller.abort();
            await couch.drop(vault.database);
            if (remove) catalog.remove(vault.id);
            else {
                await couch.provision(vault.database, vault.owner);
                catalog.state(vault.id, 'ready');
            }
        });
        operations.set(vault.id, next);
        try { await next; } finally { if (operations.get(vault.id) === next) operations.delete(vault.id); }
    }
    async function proxy(req: IncomingMessage, res: ServerResponse, user: string, vault: Vault) {
        if (vault.state !== 'ready' || operations.has(vault.id)) throw new HttpError(503, 'Vault unavailable');
        const controller = new AbortController();
        const active = streams.get(vault.id) ?? new Set<AbortController>();
        streams.set(vault.id, active); active.add(controller);
        const blocked = new Set([...hopHeaders, 'host', 'authorization', 'cookie', 'forwarded', 'remote-user', 'remote-groups', 'remote-name', 'remote-email']);
        for (const value of (req.headers.connection ?? '').split(',')) blocked.add(value.trim().toLowerCase());
        const headers: Record<string, string | string[]> = {};
        for (const [name, value] of Object.entries(req.headers)) {
            if (value !== undefined && !blocked.has(name) && !name.startsWith('x-') && !name.startsWith('proxy-')) headers[name] = value;
        }
        if (req.headers['x-couch-full-commit']) headers['x-couch-full-commit'] = req.headers['x-couch-full-commit'];
        Object.assign(headers, couch.identity(user));
        const upstreamUrl = new URL(config.couchUrl);
        const onClose = () => controller.abort();
        res.on('close', onClose);
        try {
            await new Promise<void>((resolve, reject) => {
                const upstream = (upstreamUrl.protocol === 'https:' ? httpsRequest : httpRequest)({
                    protocol: upstreamUrl.protocol, hostname: upstreamUrl.hostname, port: upstreamUrl.port,
                    path: req.url!.slice('/sync'.length), method: req.method, headers, signal: controller.signal,
                }, response => {
                    const outgoing: Record<string, string | string[]> = {};
                    const responseBlocked = new Set([...hopHeaders, 'set-cookie', 'server', 'location']);
                    for (const value of (response.headers.connection ?? '').split(',')) responseBlocked.add(value.trim().toLowerCase());
                    for (const [name, value] of Object.entries(response.headers)) {
                        if (value !== undefined && !responseBlocked.has(name) && !name.startsWith('x-auth-')) outgoing[name] = value;
                    }
                    outgoing['cache-control'] = 'no-store';
                    res.writeHead(response.statusCode ?? 502, outgoing);
                    pipeline(response, res).then(resolve, reject);
                });
                upstream.on('error', reject);
                req.pipe(upstream);
                req.once('aborted', () => upstream.destroy());
            });
        } finally {
            controller.abort(); res.off('close', onClose); active.delete(controller);
            if (!active.size) streams.delete(vault.id);
        }
    }
    const server = createServer(async (req, res) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        try {
            const path = (req.url ?? '/').split('?')[0];
            if (req.method === 'GET' && path === '/healthz') return json(res, 200, { ok: true });
            if (req.method === 'GET' && path === '/api/v1/auth/config') return json(res, 200, {
                issuer: config.issuer, clientId: config.clientId, audience: config.audience, redirectUri: `${config.publicUrl}/auth/callback`,
            });
            if (req.method === 'POST' && path === '/auth/callback') {
                if (req.headers['content-type']?.split(';')[0].trim() !== 'application/x-www-form-urlencoded') throw new HttpError(415, 'Expected form');
                const raw = await body(req, 8192);
                if (/%(?![a-fA-F0-9]{2})/.test(raw)) throw new HttpError(400, 'Invalid form');
                try { for (const field of raw.split('&')) for (const value of field.split('=')) decodeURIComponent(value.replaceAll('+', ' ')); }
                catch { throw new HttpError(400, 'Invalid form encoding'); }
                const params = new URLSearchParams(raw);
                if (['code', 'state', 'error'].some(key => params.getAll(key).length > 1)) throw new HttpError(400, 'Duplicate form field');
                const state = params.get('state'); const code = params.get('code');
                if (!state || state.length > 1024 || !code || code.length > 4096 || params.has('error')) throw new HttpError(400, 'Authorization did not succeed; return to Obsidian and retry');
                const handoff = `obsidian://glass-auth?${new URLSearchParams({ code, state })}`;
                const link = handoff.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
                res.writeHead(200, {
                    'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
                    'Content-Security-Policy': "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
                    'Referrer-Policy': 'no-referrer',
                });
                return res.end(`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${link}"><title>Return to Obsidian</title></head><body><a href="${link}">Return to Obsidian</a></body></html>`);
            }
            const username = await authenticate(req, config);
            if (!username) { res.setHeader('WWW-Authenticate', 'Bearer'); throw new HttpError(401, 'Authentication required'); }
            const user = catalog.user(username);
            if (path === '/api/v1/me' && req.method === 'GET') return json(res, 200, user);
            if (path === '/api/v1/vaults') {
                if (req.method === 'GET') return json(res, 200, { vaults: catalog.list(user.id).map(describe) });
                if (req.method === 'POST') {
                    if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') throw new HttpError(415, 'Expected JSON');
                    let parsed;
                    try { parsed = JSON.parse(await body(req, 4096)); } catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, 'Invalid JSON'); }
                    if (!parsed || typeof parsed.name !== 'string' || !parsed.name.trim() || parsed.name.length > 256) throw new HttpError(400, 'Invalid vault name');
                    const vault = catalog.create(user.id, parsed.name.trim());
                    const provision = (async () => {
                        await couch.provision(vault.database, user.id);
                        catalog.state(vault.id, 'ready');
                    })();
                    operations.set(vault.id, provision);
                    try { await provision; }
                    finally { if (operations.get(vault.id) === provision) operations.delete(vault.id); }
                    return json(res, 201, describe(vault));
                }
            }
            const match = /^\/api\/v1\/vaults\/([a-f0-9-]+)(\/rebuild)?$/.exec(path);
            if (match && ((req.method === 'POST' && match[2]) || (req.method === 'DELETE' && !match[2]))) {
                const vault = catalog.get(match[1], user.id);
                if (!vault) throw new HttpError(404, 'Unknown vault');
                const remove = req.method === 'DELETE';
                await lifecycle(vault, remove);
                return json(res, remove ? 204 : 200, remove ? undefined : describe(vault));
            }
            if ((path === '/sync' || path === '/sync/') && req.method === 'GET') return json(res, 200, couch.welcome());
            if (path.startsWith('/sync/')) {
                const { database, suffix } = syncPath(req.url!);
                const vault = catalog.database(database, user.id);
                if (!vault) throw new HttpError(404, 'Unknown database');
                if ((!suffix && ['PUT', 'DELETE'].includes(req.method!)) || suffix.split('/')[0] === '_security') throw new HttpError(403, 'Use the vault lifecycle API');
                return await proxy(req, res, user.id, vault);
            }
            throw new HttpError(404, 'Not found');
        } catch (error) {
            if (res.headersSent) { res.destroy(); return; }
            json(res, error instanceof HttpError ? error.status : 502, { error: error instanceof HttpError ? error.message : 'Gateway dependency unavailable' });
        }
    });
    server.requestTimeout = 0;
    return server;
}
