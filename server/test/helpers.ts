import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Config } from '../src/config.ts';
export async function listen(server: Server): Promise<string> {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
export async function close(server: Server) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
export async function authFixture() {
    const server = createServer((req, res) => {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (token === 'alice' || token === 'bob') { res.writeHead(200, { 'Remote-User': token }); res.end(); }
        else { res.writeHead(401); res.end(); }
    });
    return { server, url: await listen(server) };
}
export function config(issuer: string, couchUrl: string): Config {
    return { publicUrl: 'https://glass.example', issuer, clientId: 'glass', audience: 'https://glass.example', couchUrl,
        adminUsername: 'admin', adminPassword: 'test-only-password', proxySecret: 'test-only-secret-with-at-least-32-characters',
        sqlitePath: ':memory:', host: '127.0.0.1', port: 0 };
}
