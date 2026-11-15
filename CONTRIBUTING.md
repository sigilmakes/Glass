# Contributing to Glass

See the [development guide](docs/development.md) for setup and test commands.

The gateway is in `server/`, the Helm chart is in `charts/glass/`, and Glass-specific Obsidian code is in `plugin/src/glass/`. The rest of `plugin/` is the vendored LiveSync source.

The integration suite runs against local Authelia and CouchDB. Android and Linux Obsidian UI testing is separate from that suite.
