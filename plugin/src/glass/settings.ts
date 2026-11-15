import type { GlassVault } from "./GlassSession";
import { createNewVaultSettings } from "@/common/newVaultSettings";
import { REMOTE_COUCHDB } from "@vrtmrz/livesync-commonlib/compat/common/types";
export function glassSettings(vault: GlassVault) {
    return {
        ...createNewVaultSettings(),
        remoteType: REMOTE_COUCHDB,
        couchDB_URI: vault.url,
        couchDB_DBNAME: vault.database,
        couchDB_USER: "",
        couchDB_PASSWORD: "",
        useRequestAPI: true,
        encrypt: false,
        passphrase: "",
        couchDB_CustomHeaders: "",
    };
}
export function isGlassRemote(uri: string): boolean {
    try {
        return new URL(uri).pathname.replace(/\/$/, "") === "/sync";
    } catch {
        return false;
    }
}
