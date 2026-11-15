import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadConfig } from './config.ts';
import { Catalog } from './catalog.ts';
import { Couch } from './couch.ts';
import { createGateway } from './app.ts';

const config = loadConfig();
mkdirSync(dirname(config.sqlitePath), { recursive: true, mode: 0o700 });
const catalog = new Catalog(config.sqlitePath);
const couch = new Couch(config);
try {
    await couch.bootstrap();
    const server = createGateway(config, catalog, couch);
    server.listen(config.port, config.host, () => console.log('Glass gateway ready'));
    for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
        server.close(() => { catalog.close(); process.exit(0); });
        server.closeAllConnections();
    });
} catch {
    console.error('Glass startup failed: check configuration and CouchDB availability');
    catalog.close();
    process.exitCode = 1;
}
