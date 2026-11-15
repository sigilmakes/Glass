# Contributing to Glass

Read the root README and the development guide first. Glass keeps ordinary LiveSync behaviour and adds account-based access; avoid unrelated sync-engine changes.

Keep server logic in `server/`, deployment templates in `charts/`, and Obsidian host integration in `plugin/`. Follow `plugin/AGENTS.md` for imported source. Preserve upstream licences and source provenance.

Before submitting, run the type checks, focused tests, builds, and chart renders. Authentication changes also require real Authelia/CouchDB integration tests. State clearly whether Android and desktop acceptance tests were performed; mocked HTTP tests are not device verification.

Never include credentials, bearer tokens, local fixture files, or real vault contents in commits, screenshots, logs, or bug reports. Security reports should describe affected versions and reproduction using synthetic data.
