import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

function required(name) {
    const value = process.env[name];
    if (!value) throw new Error(`Set ${name} in the release workflow configuration.`);
    return value;
}
function run(program, args, input) {
    const result = spawnSync(program, args, {
        input, stdio: input ? ['pipe', 'inherit', 'inherit'] : 'inherit', encoding: 'utf8',
    });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
}
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
if (process.env.TANGLED_REF_NAME !== `v${version}`) {
    throw new Error('The pushed tag must match the root package version.');
}
const image = required('GLASS_REGISTRY_IMAGE');
const chartRegistry = required('GLASS_CHART_REGISTRY');
const username = required('REGISTRY_USERNAME');
const password = required('REGISTRY_PASSWORD');
if (!/^[a-z0-9.-]+(?::[0-9]+)?\/[a-z0-9/_.-]+$/.test(image)) {
    throw new Error('GLASS_REGISTRY_IMAGE must be a registry-qualified image without a tag.');
}
if (!chartRegistry.startsWith('oci://')) throw new Error('GLASS_CHART_REGISTRY must start with oci://.');
const imageHost = image.split('/')[0];
const chartHost = new URL(chartRegistry).host;
run('docker', ['login', imageHost, '--username', username, '--password-stdin'], password);
run('docker', ['tag', `glass-server:${version}`, `${image}:${version}`]);
run('docker', ['push', `${image}:${version}`]);
run('helm', ['registry', 'login', chartHost, '--username', username, '--password-stdin'], password);
run('helm', ['push', `artifacts/glass-${version}.tgz`, chartRegistry]);
console.log(`Published Glass ${version} OCI image and chart. Plugin assets are in artifacts/.`);
