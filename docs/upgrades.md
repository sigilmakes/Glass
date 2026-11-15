# Upgrades and releases

The root package, Glass plug-in manifest, server, and chart share a release version. LiveSync's original version is recorded separately in `UPSTREAM.md`. Do not replace upstream attribution with Glass authorship.

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

This produces the plug-in files/ZIP, a packaged Helm chart, and a local gateway image. Packaging does not publish or deploy anything.

