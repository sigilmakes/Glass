# Isolated local development

Requires Docker Compose, Node 24 and OpenSSL. No external identity provider, DNS,
cluster or Cloudflare credentials are used. This is **not production configuration**.
It runs stock Authelia, a dedicated CouchDB, the gateway, and a local Caddy HTTPS
proxy. Only `127.0.0.1:8443` is published; CouchDB and gateway have no host ports.

From the repository root:

```sh
node dev/init.mjs
docker compose --env-file dev/.local/compose.env -f dev/compose.yaml up --build -d --wait
```

Initialization generates independent random provider/admin/proxy secrets, two
random test-user passwords, password hashes, RSA OIDC signing key and a seven-day
self-signed certificate under ignored `dev/.local`. It refuses to overwrite existing
credentials. Username `developer` uses `dev/.local/developer-password`; username
`other` uses `dev/.local/other-password`. No fixed password or embedded admin is
provided. These disposable files are kept in ignored `dev/.local/`.

The directory is readable only by its host owner. The gateway receives individual
file mounts for its credentials and CA, so different host and container UIDs work.
Run `node --test dev/secret-mount.test.mjs` to check this (Docker required).

Gateway automatically initializes CouchDB and its auth configuration at startup.
No manual administrator dashboard initialization is needed. Named Docker volumes
persist gateway SQLite metadata, CouchDB databases and mutable configuration,
Authelia state and Caddy data.
After changing generated credentials, restore/replace the associated volumes
explicitly; regenerating a signing/encryption secret against old state is unsafe.
To start fresh, stop the stack, archive `dev/.local`, and intentionally dispose of
only this stack's volumes after confirming no state is needed.

## Browser and tests

Open `https://auth.glass.localhost:8443`. Trust **only this disposable certificate**
(`dev/.local/tls.crt`) in your development browser/profile and test runtime, or use
a test-only browser context that ignores TLS errors. Never disable TLS validation
in production. Gateway trusts this certificate using `NODE_EXTRA_CA_CERTS`.
`glass.localhost` and `auth.glass.localhost` resolve to loopback in modern browsers;
if your OS does not resolve them, add temporary development host mappings or use
curl's `--resolve`. Authelia uses cookie domain `glass.localhost`, not bare localhost.
Docker network aliases route these same public HTTPS names to local Caddy.
Bearer validation connects directly to Authelia using
`AUTH_AUTHZ_URL=http://authelia:9091/api/authz/forward-auth`, so Caddy cannot replace
the protected resource's forwarded host during that server-side hop.

```sh
curl --cacert dev/.local/tls.crt --resolve glass.localhost:8443:127.0.0.1 https://glass.localhost:8443/api/v1/auth/config
curl --cacert dev/.local/tls.crt --resolve glass.localhost:8443:127.0.0.1 -i https://glass.localhost:8443/api/v1/me
```

The second command must return 401 without a bearer token. The public auth config
uses issuer `https://auth.glass.localhost:8443`, client `glass`, audience
`https://glass.localhost:8443` and callback `https://glass.localhost:8443/auth/callback`.
Use the plugin or the repository integration tests for browser login with PAR,
PKCE, explicit consent and the custom URI callback. The test credentials are local
files, never console output. For an integration test browser, handle the callback
code in the test harness and exchange using the original HTTPS redirect URI and
PKCE verifier. Do not add client_credentials or weaken the real public client.

Validate the provider configuration directly:

```sh
docker compose --env-file dev/.local/compose.env -f dev/compose.yaml run --rm authelia authelia validate-config --config /config/configuration.yml --config.experimental.filters template
```

Stop without deleting data:

```sh
docker compose --env-file dev/.local/compose.env -f dev/compose.yaml down
```

Do not copy this stack's single-factor test users or filesystem notifier into a
production deployment. Production uses the Helm chart and operator-managed secrets.

## Password fixture regression

```sh
node --test dev/password-hash.test.mjs
```

Requires Docker. The deterministic noncredential fixture includes both special
Base64 symbols. Stock Authelia 4.39.24 rejects standard Base64 and accepts the
PBKDF2 crypt adapted alphabet (`.` instead of `+`, `/` unchanged, no padding).
The generator retains PBKDF2-SHA512, 310000 iterations, a random 16-byte salt and
64-byte key. The regression test never prints a password or digest. See the
[Authelia password reference](https://www.authelia.com/reference/guides/passwords/).
