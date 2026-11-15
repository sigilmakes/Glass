# Glass Helm chart

Single gateway and dedicated single-node CouchDB. CouchDB configuration and data
are persisted together under `config` and `data` subdirectories on its volume. Both
components use persistent ReadWriteOnce
claims and Recreate deployments. Back up both volumes together; the SQLite owner
catalogue is required to authorize CouchDB databases. Never share this CouchDB with
another application. Default services are ClusterIP. Kubernetes >= 1.30 is required
by the pinned optional Authelia dependency.

## External Authelia

```sh
helm dependency build charts/glass
helm upgrade --install glass charts/glass -f my-values.yaml
```

Start with `../examples/external.yaml`, replacing the image, public URLs, and existing
secret name. Build and publish your
own image from `server/Dockerfile` with the repository root as its build context. Use an immutable image tag. Production public
URL and issuer must use HTTPS. The chart refuses missing image/version/URLs/secret
references; it never generates credentials. Create `secrets.existingSecret` through
your secret manager with these keys (override key names in values if needed):

- `couchdb-admin-username`
- `couchdb-admin-password`
- `couchdb-proxy-secret` (high-entropy random HMAC secret)

The admin credentials are operator-only. Normal replication uses the separate
proxy secret. Gateway automatically bootstraps CouchDB before becoming healthy.
`/healthz` is internal and is not included in the optional Ingress.

Configure your existing stock Authelia using the bearer-only forward-auth endpoint,
public client, PAR, PKCE S256, `form_post`, explicit consent and exact callback URL
shown in `../examples/authelia-configuration.yaml`. Permit only
`authelia.bearer.authz offline_access` for this client. Allow all authenticated users
with a `one_factor` (or stronger) domain rule; no group restriction is required.
The configured audience is the gateway public origin. Set `auth.authzUrl` to the
complete internal forward-auth endpoint when the public issuer proxy would replace
forwarded resource headers. The gateway uses `AUTH_AUTHZ_URL` for this server-side
hop; public `AUTH_ISSUER` is unchanged. Bundled Authelia automatically uses its
ClusterIP service and upstream service port unless `auth.authzUrl` overrides it. Authenticated usernames must
not be renamed/reused without migrating the gateway identity mapping.

## Optional bundled stock Authelia

The dependency is the official Authelia chart `0.11.22` from
https://charts.authelia.com, running stock Authelia `4.39.24`. Values are
passed directly to its documented API. Resolve
`Chart.lock` before packaging. No plaintext credentials or generated Secret
resources are included.

Use both `../examples/external.yaml` and `../examples/bundled.yaml` as starting points:

```sh
helm upgrade --install glass charts/glass -f my-values.yaml -f my-bundled-values.yaml
```

Provision these objects in the release namespace before installing:

1. ConfigMap `glass-authelia-config`, key `configuration.yaml`: adapt
   `../examples/authelia-configuration.yaml` to your URLs, desired authentication
   strength, and real notifier/backend. The example uses stock file authentication
   and local SQLite storage. Filesystem notifications are only a starting point;
   configure an actual delivery method if using recovery/MFA workflows.
2. Secret `glass-authelia-secrets`, keys
   `identity_validation.reset_password.jwt.hmac.key`, `session.encryption.key`,
   `storage.encryption.key`, `identity_providers.oidc.hmac.key`: independently
   generated random provider secrets, managed outside this chart.
3. Secret `glass-authelia-identity`, keys `users.yml` (your existing Authelia user
   database, with proper password hashes) and `oidc.pem` (your RSA signing private
   key, at least 2048 bits). This is mounted at `/secrets/identity` using upstream
   `secret.additionalSecrets`. Do not create a dummy production administrator.

Authelia mounts its persistent volume at `/config` and existing configuration at
`/configuration.yaml`; its official image consumes `X_AUTHELIA_CONFIG` and template
filters. Existing Secret keys are mounted at `/secrets/internal`. OIDC is explicitly
enabled in dependency values so its HMAC Secret is mounted. Existing ConfigMap
changes require an explicit rollout. Validate your configuration with the exact
Authelia image before install; Helm rendering alone cannot validate provider data.
Expose the Authelia ClusterIP with your existing HTTPS infrastructure separately,
or configure the upstream dependency's basic Ingress values. External credentials,
LDAP, SMTP, identity lifecycle, and TLS remain operator responsibilities.

## Storage and access

`storage.gateway` and `storage.couchdb` accept `size`, `storageClass` and
`existingClaim`. Null storageClass uses the cluster default; empty string disables
dynamic class selection. Generated gateway and CouchDB claims have `helm.sh/resource-policy: keep` so an
uninstall retains their data. Reuse the retained claims explicitly with
`existingClaim` when reinstalling; Helm does not automatically adopt them.
Authelia claim lifecycle follows the upstream chart. PVCs are not disposable caches. Existing claims must have
permissions compatible with gateway UID/GID 1000 and CouchDB UID/GID 5984.
Only one replica is supported. Review resource requests/limits under `resources`
and upstream `authelia.pod.resources` for your installation.

`ingress.enabled` adds only an ordinary Kubernetes Ingress for `/api/v1`,
`/auth/callback`, and `/sync`. Supply `className`, `host`, and optional `tlsSecretName` and
`annotations`. Omitting `tlsSecretName` omits the Ingress TLS block; existing edge
infrastructure may terminate HTTPS. The public URL must match this host. Preserve streamed replication,
request bodies, Authorization headers, and long polling in your controller.
No ingress controller, remote ingress, tunnel agent, DNS record, certificate
provider, Cloudflare API, or public exposure infrastructure is managed here.

`networkPolicy.enabled` restricts CouchDB ingress to gateway pods and denies
gateway ingress unless explicitly allowed by `networkPolicy.gatewayIngress`.
Provide Kubernetes ingress rules for your controller or existing tunnel pods.
Egress is not restricted, since your issuer location and DNS policy are external
choices. Authelia's own NetworkPolicy is independently configurable through its
upstream values. NetworkPolicy requires a supporting CNI.

## Verification and sources

```sh
helm dependency build charts/glass
helm lint charts/glass -f charts/glass/examples/external.yaml
helm lint charts/glass -f charts/glass/examples/external.yaml -f charts/glass/examples/bundled.yaml
helm template glass charts/glass -f charts/glass/examples/external.yaml
helm template glass charts/glass -f charts/glass/examples/external.yaml -f charts/glass/examples/bundled.yaml
```

References:

- https://www.authelia.com/integration/kubernetes/chart/
- https://github.com/authelia/chartrepo/blob/master/charts/authelia/values.yaml
- https://www.authelia.com/integration/openid-connect/oauth-2.0-bearer-token-usage/
- https://www.authelia.com/configuration/identity-providers/openid-connect/provider/
