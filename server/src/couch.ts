import { createHmac } from 'node:crypto';
import type { Config } from './config.ts';

export class Couch {
    constructor(privateConfig: Config) { this.config = privateConfig; }
    private config: Config;
    private version?: string;
    welcome() {
        if (!this.version) throw new Error('CouchDB version unavailable');
        return { couchdb: 'Welcome', version: this.version, vendor: { name: 'Glass' } };
    }
    private async probe() {
        const response = await fetch(`${this.config.couchUrl}/_session`, {
            headers: this.identity('glass_bootstrap_probe'), signal: AbortSignal.timeout(2000),
        });
        const session = await response.json();
        return response.ok && session.userCtx?.name === 'glass_bootstrap_probe' && session.userCtx?.roles?.length === 0;
    }
    async admin(path: string, method = 'GET', body?: unknown, allowed: number[] = []) {
        const response = await fetch(`${this.config.couchUrl}${path}`, {
            method, redirect: 'error', signal: AbortSignal.timeout(30000),
            headers: { Authorization: `Basic ${Buffer.from(`${this.config.adminUsername}:${this.config.adminPassword}`).toString('base64')}`, 'Content-Type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        await response.body?.cancel();
        if (!response.ok && !allowed.includes(response.status)) throw new Error(`CouchDB administration failed (${response.status})`);
    }
    async bootstrap() {
        for (const name of ['_users', '_replicator', '_global_changes']) await this.admin(`/${name}`, 'PUT', undefined, [412]);
        const settings = {
            'chttpd/authentication_handlers': '{chttpd_auth, proxy_authentication_handler}, {chttpd_auth, cookie_authentication_handler}, {chttpd_auth, default_authentication_handler}',
            'chttpd_auth/secret': this.config.proxySecret,
            'chttpd_auth/proxy_use_secret': 'true',
            'chttpd_auth/hash_algorithms': 'sha256',
            'chttpd_auth/x_auth_username': 'X-Auth-CouchDB-UserName',
            'chttpd_auth/x_auth_roles': 'X-Auth-CouchDB-Roles',
            'chttpd_auth/x_auth_token': 'X-Auth-CouchDB-Token',
        };
        for (const [key, value] of Object.entries(settings)) await this.admin(`/_node/_local/_config/${key}`, 'PUT', value);
        if (!await this.probe()) {
            // CouchDB 3.5 loads authentication handlers only when its HTTP listener starts.
            try { await this.admin('/_node/_local/_restart', 'POST'); } catch { /* A restart can close its own response. */ }
            let ready = false;
            for (let attempt = 0; attempt < 60 && !ready; attempt++) {
                await new Promise(resolve => setTimeout(resolve, 500));
                try { ready = await this.probe(); } catch { /* Listener is restarting. */ }
            }
            if (!ready) throw new Error('CouchDB proxy authentication did not become ready');
        }
        const welcome = await fetch(`${this.config.couchUrl}/`, {
            headers: this.identity('glass_bootstrap_probe'), signal: AbortSignal.timeout(5000),
        });
        const info = await welcome.json();
        if (!welcome.ok || typeof info.version !== 'string') throw new Error('CouchDB version unavailable');
        this.version = info.version;
    }
    async provision(database: string, owner: string) {
        await this.admin(`/${database}`, 'PUT');
        await this.admin(`/${database}/_security`, 'PUT', { admins: { names: [], roles: [] }, members: { names: [owner], roles: [] } });
    }
    async drop(database: string) { await this.admin(`/${database}`, 'DELETE', undefined, [404]); }
    identity(user: string): Record<string, string> {
        return {
            'X-Auth-CouchDB-UserName': user,
            'X-Auth-CouchDB-Token': createHmac('sha256', this.config.proxySecret).update(user).digest('hex'),
        };
    }
}
