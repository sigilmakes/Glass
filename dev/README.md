# Local development

Disposable stock Authelia + CouchDB + gateway, with local HTTPS. Requires Docker
Compose, Node 24 and OpenSSL. Only `127.0.0.1:8443` is published.

From the repository root:

```sh
node dev/init.mjs
docker compose --env-file dev/.local/compose.env -f dev/compose.yaml up --build -d --wait
```

- Gateway: `https://glass.localhost:8443`
- Authelia: `https://auth.glass.localhost:8443`
- Test users: `developer` and `other`
- Password files: `dev/.local/{developer,other}-password`
- Disposable browser/test CA: `dev/.local/tls.crt` (expires after seven days)

Init generates ignored, random local secrets and refuses to overwrite them.
Trust this certificate only in your development browser/profile; never disable
production TLS verification. The gateway initializes CouchDB automatically.
Named volumes retain state across restarts. This is not production configuration.

Stop without deleting data:

```sh
docker compose --env-file dev/.local/compose.env -f dev/compose.yaml down
```

See [configuration, certificate setup, tests and reset precautions](docs/configuration.md).
