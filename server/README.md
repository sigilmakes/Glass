# Glass gateway

Authenticates Glass clients through Authelia and proxies replication to CouchDB.

## Run

Requires Node 24 and a dedicated, private CouchDB 3.5 instance.
Set the environment variables in [configuration](docs/configuration.md), then:

```sh
cd server
npm ci
npm run check
npm test
npm start
```

Node runs TypeScript directly; there are no runtime npm dependencies or `dist` build.
Build the container from the repository root:

```sh
docker build -f server/Dockerfile .
```

Persist `/data` with UID 1000 write access. Never expose CouchDB publicly.
Startup configures CouchDB and may restart it once; failed bootstrap never opens
HTTP access. `/healthz` is a liveness endpoint after bootstrap.

Authelia usernames are account identities: do not rename or reuse them without an
explicit offline migration. Only owners can access their vaults; use the catalog
API for rebuild/delete rather than direct database lifecycle requests.

## Integration tests

`npm run test:integration` tests a disposable CouchDB using the configured credentials.
It changes authentication settings; **never target shared or production CouchDB**.
See [configuration and operations](docs/configuration.md) for all settings,
authentication requirements, recovery, and test scope.
