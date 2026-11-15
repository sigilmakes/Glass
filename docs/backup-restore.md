# Backup and restore

Synchronisation and persistent-volume retention are not backups. A complete backup covers both storage and access-control state.

## Preserve

- CouchDB databases, including all vault data and any required system databases.
- Each vault database's `_security` object. It is not an ordinary versioned document and is not preserved by ordinary document replication.
- The Glass SQLite catalogue, including user identities, vault ownership, and lifecycle state.
- Deployment configuration and encrypted bootstrap/admin/proxy secrets.
- The external Authelia database/configuration and recovery material through its own backup procedure.

Do not back up only current note files if revision history is part of your recovery requirement. Do not treat a vault-only CouchDB replica as a complete service backup.

## Consistency

Use coordinated storage snapshots, or a cold backup with the gateway and CouchDB stopped. For a cold file backup, retain the complete data volumes, including SQLite WAL files if present. Live copies require the respective databases' supported backup mechanisms; copying only a live SQLite main file is not safe.

The Helm chart does not select an external backup provider or manage cloud storage credentials. Integrate its persistent claims with your chosen backup service. Test restoration in an isolated namespace before relying on the backups.

## Restore order

1. Keep the public gateway unavailable.
2. Restore CouchDB data and Glass metadata from the same recovery point.
3. Restore configuration and required secrets; preserve the original ownership mapping.
4. Verify every database has the intended owner ACL before permitting ordinary access.
5. Start the gateway and authenticate as two test users; confirm vault lists and access isolation.
6. Verify an existing client can retrieve a known note and perform a two-way test edit.
7. Reopen public access only after those checks pass.

Do not permit access to restored data without its ownership catalogue and permissions.

Account disabling retains stored vault data. Explicit user-authorised deletion is separate. Restoring a backup may restore previously deleted content; apply the intended retention and deletion policy deliberately.
