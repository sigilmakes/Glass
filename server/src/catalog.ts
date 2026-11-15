import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export interface User { id: string; username: string }
export interface Vault { id: string; name: string; database: string; createdAt: string; owner: string; state: string }
export class Catalog {
    private db: DatabaseSync;
    constructor(path: string) {
        this.db = new DatabaseSync(path);
        this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
            CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL);
            CREATE TABLE IF NOT EXISTS vaults (id TEXT PRIMARY KEY, name TEXT NOT NULL, database_name TEXT UNIQUE NOT NULL,
                created_at TEXT NOT NULL, owner TEXT NOT NULL REFERENCES users(id), state TEXT NOT NULL);`);
    }
    close() { this.db.close(); }
    user(username: string): User {
        this.db.prepare('INSERT OR IGNORE INTO users VALUES (?, ?)').run(randomUUID(), username);
        return this.db.prepare('SELECT id, username FROM users WHERE username=?').get(username) as unknown as User;
    }
    private selection = 'SELECT id, name, database_name AS database, created_at AS createdAt, owner, state FROM vaults';
    list(owner: string): Vault[] {
        return this.db.prepare(`${this.selection} WHERE owner=?`).all(owner) as unknown as Vault[];
    }
    get(id: string, owner: string): Vault | undefined {
        return this.db.prepare(`${this.selection} WHERE id=? AND owner=?`).get(id, owner) as unknown as Vault | undefined;
    }
    database(database: string, owner: string): Vault | undefined {
        return this.db.prepare(`${this.selection} WHERE database_name=? AND owner=?`).get(database, owner) as unknown as Vault | undefined;
    }
    create(owner: string, name: string): Vault {
        const vault = { id: randomUUID(), name, database: `glass_${randomUUID().replaceAll('-', '')}`, createdAt: new Date().toISOString(), owner, state: 'creating' };
        this.db.prepare('INSERT INTO vaults VALUES (?, ?, ?, ?, ?, ?)').run(vault.id, name, vault.database, vault.createdAt, owner, vault.state);
        return vault;
    }
    state(id: string, state: string) { this.db.prepare('UPDATE vaults SET state=? WHERE id=?').run(state, id); }
    remove(id: string) { this.db.prepare('DELETE FROM vaults WHERE id=?').run(id); }
}
