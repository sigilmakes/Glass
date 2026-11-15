import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const state = mkdtempSync(join(tmpdir(), 'glass-helm-'));
const env = { ...process.env, HELM_REPOSITORY_CONFIG: join(state, 'repositories.yaml'), HELM_REPOSITORY_CACHE: join(state, 'cache') };

function run(args, capture = false) {
    const result = spawnSync('helm', args, { stdio: capture ? 'pipe' : 'inherit', encoding: 'utf8', env });
    if (result.error) throw result.error;
    if (result.status !== 0) {
        if (capture) process.stderr.write(result.stderr);
        process.exit(result.status ?? 1);
    }
}

const chart = 'charts/glass';
const external = ['-f', `${chart}/examples/external.yaml`];
const bundled = [...external, '-f', `${chart}/examples/bundled.yaml`];
run(['repo', 'add', 'authelia', 'https://charts.authelia.com']);
run(['dependency', 'build', chart]);
for (const values of [external, bundled]) {
    run(['lint', chart, ...values]);
    run(['template', 'glass', chart, ...values], true);
}
console.log('External and bundled Authelia chart modes render successfully.');
