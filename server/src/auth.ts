import type { IncomingMessage } from 'node:http';
import type { Config } from './config.ts';

export async function authenticate(req: IncomingMessage, config: Config): Promise<string | undefined> {
    const authorization = req.headers.authorization;
    if (!authorization || !/^Bearer [A-Za-z0-9._~+/-]+=*$/i.test(authorization)) return;
    const response = await fetch(`${config.issuer}/api/authz/forward-auth`, {
        method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(10000),
        headers: {
            Authorization: authorization,
            'X-Forwarded-Method': req.method ?? 'GET',
            'X-Forwarded-Proto': new URL(config.publicUrl).protocol.slice(0, -1),
            'X-Forwarded-Host': new URL(config.publicUrl).host,
            'X-Forwarded-Uri': req.url ?? '/',
        },
    });
    const username = response.headers.get('Remote-User');
    await response.body?.cancel();
    if (response.status !== 200 || !username || username.length > 512 || /[\r\n\0]/.test(username)) return;
    return username;
}
