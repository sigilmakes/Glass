# Glass upstream baseline

Glass vendors Self-hosted LiveSync 1.0.50 by vorotamoroz, commit `53281c5fe5f0b1d4da789e622cc2aac2b1994420`. The upstream MIT licence and attribution are retained.

Glass version: 0.1.0. Minimum Obsidian: 1.11.4, which introduced the public `App.secretStorage` API (`getSecret` and `setSecret`). There is no plaintext settings fallback. Device sessions and pending PKCE state live only in Obsidian SecretStorage, not plug-in settings or Setup URIs.

Glass uses the host `nativeFetch` and `webCompatFetch` methods for renewable bearer authentication. CouchDB administrator checks are not applicable through the gateway. Database DELETE is translated into the owner-checked gateway rebuild API; database PUT acknowledges the already provisioned database.

Glass selects `useRequestAPI=true` and its host `GlassRebuilder` always routes Glass Fast Fetch requests to Standard Fetch even if that setting is later changed. Upstream Fast Fetch calls global `_fetch` directly, so its existing eligibility check falls back to Standard Fetch. Standard Fetch retains the upstream local-vault initialisation, reconstruction, and reflection lifecycle. Accelerated Fast Fetch needs a published Commonlib transport injection hook; Glass does not mirror or patch the dependency.

Authentication uses the system browser, PKCE S256, PAR, and stock Authelia bearer scopes, with a fixed `obsidian://glass-auth` callback. Tokens are never placed in the callback URI. SecretStorage is device-local application storage; it is not a promise of OS-backed encryption or protection against other installed plug-ins.

API references: https://docs.obsidian.md/Reference/TypeScript+API/SecretStorage and https://docs.obsidian.md/plugins/guides/secret-storage . Native Obsidian desktop and mobile behaviour still needs hands-on verification. Obsidian `requestUrl` has no public redirect or cancellation controls: authenticated HTTPS gateway and identity endpoints must not redirect. The web transport requests redirect rejection.
