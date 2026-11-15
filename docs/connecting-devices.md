# Connecting devices

Glass runs inside an ordinary local Obsidian vault. It does not replace Obsidian's vault manager or install itself globally. Repeat installation and connection for each local vault.

## Download an existing vault

1. Create an empty local vault in Obsidian.
2. Enable community plug-ins and install the Glass release files in its plug-in directory, then enable Glass.
3. Open Glass sign-in, enter the server URL, and authenticate in the browser through Authelia.
4. Return to Obsidian when the browser offers the return link.
5. Select the remote vault to download and follow the existing-device Fetch path.
6. Keep Obsidian open until initial retrieval and file reflection finish.
7. Make a test edit and verify it reaches another device.

Do not initialise or overwrite the remote when the new device is intended to download it. Standard Fetch is used for Glass connections.

## Upload an existing local vault

Back up the vault first and disable other software that writes to the same local files. Sign in through Glass, create a new remote vault, and use the first-device initialisation path. Check a test note before connecting another device.

Do not assume selecting a remote merges two independently populated vaults. Use an empty local vault when downloading an established remote.

## Accounts and credentials

Your administrator creates your Authelia account. Glass provisions its local profile on first authenticated use. No additional CouchDB username or password is required. Device login tokens must not be copied through setup links or synced configuration.

Mobile synchronisation requires Obsidian to be running. Do not assume Android will keep it running indefinitely in the background. Sign out or ask the administrator to disable the account when access must be revoked; upstream's Forget device action alone does not revoke credentials.

## Plug-in distribution

Use the built `main.js`, `manifest.json`, and `styles.css` together, or the versioned release ZIP. The plug-in ID is `glass-sync`, distinct from upstream LiveSync. Do not enable both against the same local vault simultaneously. Android installation and browser return behaviour must be tested with the chosen release and packaging.
