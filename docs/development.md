# Development

Use Node.js 24 and npm. The root package coordinates two independent locked npm packages: `server/` and upstream's `plugin/`. The plugin retains its existing nested workspaces.

```sh
npm run install:all
npm run check
npm test
npm run build
npm run chart:check
```

## Local services

The local fixture runs stock Authelia, CouchDB, Glass, and a development HTTPS proxy. Read [dev/README.md](../dev/README.md) before starting it. All host ports bind to loopback. The fixture generates temporary user passwords, an OIDC signing key, CouchDB credentials, a proxy secret, and a development certificate under ignored `dev/.local/`.

```sh
node dev/init.mjs
docker compose --env-file dev/.local/compose.env -f dev/compose.yaml up --build -d --wait
```

Do not add this certificate to the system trust store. Trust it only in the development process or browser profile. Never use fixture identities or keys for production. Initialisation refuses to overwrite existing private development state.

The cross-service tests use the fixture for real Authelia login, renewal, user isolation, and CouchDB replication. See their environment requirements in `tests/integration/`.

## Scope of verification

Android and Linux desktop login and sync have not been tested in the native Obsidian UI. Before release, test login and initial sync on both, including multiple open vaults and a cancelled login.

Do not delete existing local vaults or attach a populated local vault to an unrelated remote for testing.
