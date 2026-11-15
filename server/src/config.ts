import { readFileSync } from 'node:fs';

export interface Config {
    publicUrl: string; issuer: string; clientId: string; audience: string; authzUrl?: string;
    couchUrl: string; adminUsername: string; adminPassword: string; proxySecret: string;
    sqlitePath: string; host: string; port: number;
}
export function loadConfig(env = process.env): Config {
    const required = (key: string) => {
        const value = env[key];
        if (!value) throw new Error(`Missing ${key}`);
        return value;
    };
    const secret = (key: string) => env[`${key}_FILE`]
        ? readFileSync(env[`${key}_FILE`]!, 'utf8').trimEnd() : required(key);
    const url = (key: string) => {
        const value = new URL(required(key));
        if (!['https:', 'http:'].includes(value.protocol) || value.username || value.password || value.search || value.hash || value.pathname !== '/') {
            throw new Error(`${key} must be an HTTP(S) origin without credentials`);
        }
        return value.origin;
    };
    let authzUrl: string | undefined;
    if (env.AUTH_AUTHZ_URL) {
        const endpoint = new URL(env.AUTH_AUTHZ_URL);
        if (!['https:', 'http:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
            throw new Error('AUTH_AUTHZ_URL must be an HTTP(S) endpoint without credentials');
        }
        authzUrl = endpoint.href;
    }
    const proxySecret = secret('COUCHDB_PROXY_SECRET');
    if (proxySecret.length < 32) throw new Error('COUCHDB_PROXY_SECRET must contain at least 32 characters');
    return {
        publicUrl: url('PUBLIC_URL'), issuer: url('AUTH_ISSUER'), authzUrl, clientId: required('AUTH_CLIENT_ID'),
        audience: required('AUTH_AUDIENCE'), couchUrl: url('COUCHDB_URL'),
        adminUsername: required('COUCHDB_ADMIN_USERNAME'), adminPassword: secret('COUCHDB_ADMIN_PASSWORD'),
        proxySecret, sqlitePath: env.SQLITE_PATH ?? '/data/glass.sqlite',
        host: env.HOST ?? '0.0.0.0', port: Number(env.PORT ?? 3000),
    };
}
