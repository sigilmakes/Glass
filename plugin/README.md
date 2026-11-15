# Glass

SSO-enabled self-hosted livesync for obsidian.

An MIT-licensed fork of [Self-hosted LiveSync](https://github.com/vrtmrz/obsidian-livesync) 1.0.50 by vorotamoroz.

## Quick start

1. Install Glass in Obsidian **1.11.4 or later**.
2. Run **Glass: Sign in and choose a remote vault**.
3. Enter your HTTPS Glass server URL and sign in through the browser.
4. Choose or create a private remote vault.
5. Follow the LiveSync questions: upload this device's files or fetch an existing remote.

Back up your vault first. Disable other synchronisation tools for the same vault.
Every device signs in separately; credentials stay in device-local SecretStorage.
Initial downloads use Standard Fetch, not accelerated Fast Fetch.

## Guides

- [Glass configuration and limitations](docs/glass.md)
- [Upstream baseline and licence](UPSTREAM.md)
- [Upstream guide](docs/upstream-guide.md) · [documentation index](docs/README.md)
- [Development](devs.md) · [MIT licence](LICENSE)
