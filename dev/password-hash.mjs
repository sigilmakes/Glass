import { pbkdf2Sync, randomBytes } from 'node:crypto';

const encode = bytes => bytes.toString('base64').replaceAll('=', '').replaceAll('+', '.');

export function hashPassword(password, salt = randomBytes(16)) {
    const key = pbkdf2Sync(password, salt, 310000, 64, 'sha512');
    return `$pbkdf2-sha512$310000$${encode(salt)}$${encode(key)}`;
}
