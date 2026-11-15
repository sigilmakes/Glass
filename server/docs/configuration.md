# Gateway configuration and operations

## Configuration

| Variable | Meaning |
| --- | --- |
| `PUBLIC_URL` | Gateway HTTP(S) origin, no path; HTTPS in production |
| `AUTH_ISSUER` | Public stock Authelia HTTP(S) origin |
| `AUTH_AUTHZ_URL` | Optional internal forward-auth endpoint; defaults to `${AUTH_ISSUER}/api/authz/forward-auth` |
| `AUTH_CLIENT_ID` | Public OIDC client ID |
| `AUTH_AUDIENCE` | OAuth audience configured in Authelia |
| `COUCHDB_URL` | Dedicated CouchDB 3.5 (tested) HTTP(S) origin, private network only |
| `COUCHDB_ADMIN_USERNAME` | Operator account used only for bootstrap and lifecycle |
| `COUCHDB_ADMIN_PASSWORD_FILE` | Mounted operator-password file |
| `COUCHDB_PROXY_SECRET_FILE` | Mounted random HMAC secret, at least 32 characters |
| `SQLITE_PATH` | Durable catalog path; default `/data/glass.sqlite` |
| `HOST`, `PORT` | Listener; defaults `0.0.0.0`, `3000` |

`COUCHDB_ADMIN_PASSWORD` and `COUCHDB_PROXY_SECRET` are environment alternatives;
file variables take precedence. Trailing file whitespace is removed. Do not commit
real values. Persist the SQLite directory, including its WAL files. The container
runs as the `node` user (UID 1000); provide a writable data mount. Never expose
CouchDB publicly, even though its database ACLs also enforce owner isolation.

Startup requires ready CouchDB and fails without opening the HTTP port if bootstrap
fails. The supervisor may restart it while CouchDB starts. `/healthz` is available
once bootstrap completes; it is a liveness endpoint, not continuous dependency
monitoring. Stop the gateway before restoring the catalog or CouchDB snapshots.
Back up both together; a mismatched restore can leave unavailable catalog entries.

## Authentication

The browser callback uses a bounded form parser and returns only `code` and `state`
to `obsidian://glass-auth`. The plugin owns PKCE, token exchange and refresh. The
callback sends no-store, restrictive CSP and no-referrer headers; it includes a
manual return link. OAuth errors return a generic failure without reflecting tokens.

Every API and sync request delegates its bearer token to stock Authelia's
`/api/authz/forward-auth`, using `Authorization: Bearer ...` and server-generated
`X-Forwarded-Method`, `X-Forwarded-Proto`, `X-Forwarded-Host`, `X-Forwarded-Uri`.
The configured public origin and actual request path are preserved. Set
`AUTH_AUTHZ_URL=http://authelia:9091/api/authz/forward-auth` on a private network
when a public reverse proxy would overwrite forwarded headers. Keep this endpoint
operator-controlled; clients cannot select it. Authelia must
have bearer authorization enabled for this endpoint and allow this public resource.
The OIDC client must request `authelia.bearer.authz` and configure the matching
audience/resource for both `/api/v1/` and `/sync/`. Missing `Remote-User`, redirects,
authentication failures, and dependency failures never grant access. No group filter
is applied. Incoming identity headers never establish a user.

The verified **username** maps to an opaque persistent internal user ID, not an OIDC
`sub`. Authelia usernames must not be renamed or reassigned while catalog data
exists: a rename creates a separate user; reusing a previous username grants its
existing vaults to the new account. Resolve identity migrations explicitly offline.

## Storage and proxy boundaries

Vault titles are metadata only. Database names are random `glass_` identities.
Creation and rebuild keep entries closed until database creation and `_security`
installation both succeed. Rebuild/delete serialize per vault, abort existing
streams, and close admission before changing storage. Failed operations remain
closed across restarts; owner rebuild or delete can recover them. Failed creations
remain listed so an owner can rebuild/delete them. A process crash after successful
provisioning but before readiness also fails closed.

The gateway configures dedicated CouchDB proxy+cookie+default authentication,
`proxy_use_secret=true`, SHA-256 HMAC, fixed `X-Auth-CouchDB-*` header names, and
system databases. If the listener has not loaded proxy authentication, bootstrap
restarts this dedicated CouchDB once and waits up to 30 seconds for a successful
HMAC identity probe. Preconfigure handlers in CouchDB to avoid this first-start
restart. The `/sync` welcome version comes from the backend, not a hardcoded
version. Normal sync requests never contain operator credentials, client
cookies or client identity/role headers. CouchDB sees the internal user ID with no
roles. Database ACL membership uses the same ID. The gateway does not create
password-bearing CouchDB user accounts. Operators must not change these auth
settings behind the running gateway.

Only the authenticated owner's known databases are forwarded. Encoded path escapes,
global endpoints, direct database PUT/DELETE and `_security` access are rejected.
Document, attachment, `_local`, `_bulk_docs`, `_revs_diff`, `_all_docs`, and streamed
`_changes` requests use the same route without buffering bodies. Request disconnect
and lifecycle transitions abort upstream streams. Root `/sync` gives a minimal
CouchDB-compatible welcome document. Use Glass lifecycle APIs rather than a client
feature that deletes or recreates databases directly. Response cookies and upstream
redirects are not forwarded.

## Tests

`npm test` covers authentication rejection, spoofed identity headers, owner isolation,
path validation, checkpoint/bulk forwarding, streamed response chunks, callback
handoff, and fail-closed rebuild recovery. Tests use local loopback fixtures.

For an **isolated disposable dedicated CouchDB**, set the CouchDB variables above
and run `npm run test:integration`. It performs real bootstrap and tests ACLs,
HMAC authentication, documents, checkpoints, changes, rebuild and deletion. It
modifies CouchDB authentication configuration and creates/removes random test
databases. Never point it at shared/production CouchDB. The integration hook mocks
Authelia only; full browser/token validation must run against real stock Authelia
in the repository's development integration environment.
