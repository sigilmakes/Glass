# Glass configuration

## Connect a local vault

Use Obsidian 1.11.4 or later. Run **Glass: Sign in and choose a remote vault**, enter the HTTPS gateway URL, and select **Open browser**. Complete the Authelia consent screen. The browser returns through `obsidian://glass-auth`; if automatic opening is blocked, use the gateway's return link.

Choose an existing remote vault, or enter a name and create one. Only your own remote vaults are listed. The normal LiveSync confirmation then asks whether this device supplies the source files or fetches existing remote data. Back up local files before choosing an operation which replaces data. Cancelling the confirmation does not start initialisation.

Use **Advanced LiveSync setup** for the upstream configuration flow. Glass does not replace the local-vault database, metadata, chunk, conflict, or reflection lifecycle.

## Credentials and other devices

Every device signs in separately. Sessions and pending PKCE state use Obsidian's public `App.secretStorage`, introduced in 1.11.4. There is no plaintext fallback. Credentials are not placed in plugin settings, Setup URIs, or synchronised settings. SecretStorage is application storage shared with installed plugins; Glass does not guarantee OS-backed encryption or isolation from other plugins.

Sign-in uses public-client PKCE S256, PAR, stock Authelia bearer scopes, and a browser callback containing only the code and state. Pending state expires after ten minutes. Refresh operations are serialised, and replacement tokens are stored before another refresh can start. Glass refreshes thirty seconds before expiry. An uncertain refresh failure requires signing in again rather than replaying a possibly consumed token.

**Sign out on this device** clears the local session. It does not delete the remote vault or revoke every session on the identity provider.

## Transport and recovery

Glass configures the CouchDB root as `<gateway>/sync`, with the opaque database name stored separately. It adds bearer authentication at the host transport boundary, not through saved headers. Database reset requests use the owner-checked gateway rebuild API. End-to-end encryption is not required by Glass.

Initial downloads always use supported **Standard Fetch**. Accelerated Fast Fetch currently bypasses the host transport in upstream Commonlib. Glass blocks that path even if **Use Internal API** is changed. Accelerated Fast Fetch requires a published Commonlib authenticated transport hook.

CouchDB administrator checks and configuration fixes are not available through the gateway. The server operator manages those settings. Other upstream diagnostics and ordinary replication retain their existing behaviour.

Obsidian `requestUrl` has no public redirect or cancellation controls. Authenticated HTTPS gateway and identity endpoints must not redirect. The web transport requests redirect rejection. Android and Linux desktop login and sync have not been tested in the native Obsidian UI.

## References

- [Upstream baseline](../UPSTREAM.md)
- [Upstream guide](upstream-guide.md), [settings](settings.md), and [recovery](recovery.md)
- [Obsidian SecretStorage API](https://docs.obsidian.md/Reference/TypeScript+API/SecretStorage)
