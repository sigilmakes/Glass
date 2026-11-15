# Upgrades and releases

The root package, Glass plugin manifest, server, and chart share a release version. LiveSync's original version is recorded separately in `UPSTREAM.md`.

## Before an upgrade

Take a recoverable backup of both persistent stores and the configuration/secrets needed to restore them. Review authentication, metadata schema, and LiveSync database compatibility changes. Upgrade clients together if the upstream release requires it.

## Build locally

```sh
npm run install:all
npm run check
npm test
npm run build
npm run chart:check
npm run release:package
```

This produces the plugin files/ZIP, a packaged Helm chart, and a local gateway image. Packaging does not publish or deploy anything.

