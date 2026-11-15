import { mkdirSync, existsSync, writeFileSync, chmodSync } from 'node:fs';
import { randomBytes, pbkdf2Sync, generateKeyPairSync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('.local/', import.meta.url));
if (existsSync(directory)) {
    throw new Error('dev/.local already exists; refusing to replace test credentials. Archive it before a fresh init.');
}
mkdirSync(directory, { mode: 0o700 });
const save = (name, value) => writeFileSync(`${directory}/${name}`, value, { mode: 0o600 });
const random = () => randomBytes(48).toString('hex');
const b64 = value => value.toString('base64').replaceAll('=', '');
let users = 'users:\n';
for (const username of ['developer', 'other']) {
    const password = random();
    save(`${username}-password`, password);
    const salt = randomBytes(16);
    const hash = pbkdf2Sync(password, salt, 310000, 64, 'sha512');
    users += `    ${username}:\n        displayname: Local ${username}\n        password: '$pbkdf2-sha512$310000$${b64(salt)}$${b64(hash)}'\n        email: ${username}@glass.localhost\n`;
}
save('users.yml', users);
const admin = random();
save('couchdb-admin-password', admin);
save('compose.env', `COUCHDB_ADMIN_PASSWORD=${admin}
`);
for (const key of ['couchdb-proxy-secret', 'reset-password', 'session-secret', 'storage-key', 'oidc-hmac']) {
    save(key, random());
}
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 3072 });
save('oidc.pem', privateKey.export({ type: 'pkcs8', format: 'pem' }));
const result = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:3072', '-nodes', '-days', '7',
    '-keyout', `${directory}/tls.key`, '-out', `${directory}/tls.crt`,
    '-subj', '/CN=Glass disposable local development',
    '-addext', 'subjectAltName=DNS:glass.localhost,DNS:auth.glass.localhost',
    '-addext', 'basicConstraints=critical,CA:TRUE'], { stdio: 'ignore' });
if (result.status !== 0) throw new Error('openssl failed; archive dev/.local before retrying');
chmodSync(`${directory}/tls.key`, 0o600);
// Containers have different service UIDs. The host directory remains owner-only.
for (const file of ['users.yml', 'couchdb-admin-password', 'couchdb-proxy-secret', 'reset-password',
    'session-secret', 'storage-key', 'oidc-hmac', 'oidc.pem', 'tls.key', 'tls.crt']) {
    chmodSync(`${directory}/${file}`, 0o644);
}
console.log('Created ignored disposable secrets in dev/.local. Login: developer; password files: dev/.local/{developer,other}-password');
