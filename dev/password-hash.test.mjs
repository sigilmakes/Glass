import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { hashPassword } from './password-hash.mjs';

test('PBKDF2 crypt adapted Base64 validates with stock Authelia', () => {
    const password = 'noncredential-encoding-regression-fixture';
    const digest = hashPassword(password, Buffer.alloc(16, 251));
    const fields = digest.split('$');
    for (const field of fields.slice(3)) {
        assert.match(field, /^[A-Za-z0-9./]+$/);
    }
    assert.ok(fields[3].includes('.') && fields[3].includes('/'));
    const validate = hash => spawnSync('docker', [
        'run', '--rm', 'authelia/authelia:4.39.24',
        'authelia', 'crypto', 'hash', 'validate', '--password', password, '--', hash
    ], { encoding: 'utf8' });
    const standard = validate(digest.replaceAll('.', '+'));
    assert.equal(standard.status, 1, 'The standard Base64 regression fixture must be rejected');
    assert.match(standard.stdout + standard.stderr, /illegal base64/);
    const adapted = validate(digest);
    assert.equal(adapted.status, 0, 'The adapted Base64 fixture must validate with stock Authelia');
});
