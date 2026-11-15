# Glass Helm chart

Private gateway + dedicated CouchDB, with optional stock Authelia. Kubernetes 1.30+.

## Install

Build your gateway image with `docker build -f server/Dockerfile .`. Copy
[`examples/external.yaml`](examples/external.yaml), set your image and HTTPS origins,
and provision its referenced CouchDB Secret through your secret manager.

```sh
helm dependency build charts/glass
helm upgrade --install glass charts/glass -f my-values.yaml
```

For bundled Authelia, also adapt [`examples/bundled.yaml`](examples/bundled.yaml)
and provision the provider configuration and existing Secrets described in
[configuration](docs/configuration.md#optional-bundled-stock-authelia).
The dependency is the [official Authelia chart](https://charts.authelia.com),
pinned to chart 0.11.22 / stock Authelia 4.39.24.

## Constraints

- One replica per component; persistent SQLite catalogue and CouchDB data/config.
- Existing Secrets only. No generated production credentials.
- ClusterIP by default; optional standard Ingress and NetworkPolicies.
- Ingress TLS Secret is optional when your existing edge terminates HTTPS.
- No DNS, tunnels, ingress controllers or certificate-provider management.
- Generated gateway/CouchDB PVCs survive uninstall; back up both together.

See [configuration, secret keys, storage and verification](docs/configuration.md).
