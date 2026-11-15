import { readFileSync, mkdirSync, copyFileSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

const state = mkdtempSync(join(tmpdir(), 'glass-helm-'));
const env = { ...process.env, HELM_REPOSITORY_CONFIG: join(state, 'repositories.yaml'), HELM_REPOSITORY_CACHE: join(state, 'cache') };

function run(program, args, cwd) {
    const result = spawnSync(program, args, { stdio: 'inherit', cwd, env });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
}

const root = process.cwd();
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const manifest = JSON.parse(readFileSync('plugin/manifest.json', 'utf8'));
if (manifest.version !== version) throw new Error('Root and plug-in release versions must match.');
const output = resolve('artifacts');
mkdirSync(output, { recursive: true });
for (const file of ['main.js', 'manifest.json', 'styles.css']) {
    copyFileSync(resolve('plugin', file), resolve(output, file));
}
run('zip', ['-j', resolve(output, `glass-plugin-${version}.zip`),
    resolve(output, 'main.js'), resolve(output, 'manifest.json'), resolve(output, 'styles.css')]);
run('helm', ['repo', 'add', 'authelia', 'https://charts.authelia.com']);
run('helm', ['dependency', 'build', 'charts/glass']);
run('helm', ['package', 'charts/glass', '--destination', output, '--version', version, '--app-version', version]);
run('docker', ['build', '-f', 'server/Dockerfile', '-t', `glass-server:${version}`, '.'], root);
console.log(`Release ${version} built locally. Nothing has been pushed or deployed.`);
