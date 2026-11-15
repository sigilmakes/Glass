import { expect, it, vi } from "vitest";
import { GlassRebuilder } from "./GlassRebuilder";
import type { ServiceRebuilderDependencies } from "@vrtmrz/livesync-commonlib/compat/serviceModules/Rebuilder";
it("never invokes unauthenticated Fast Fetch for Glass even if Use Internal API is switched off", async () => {
    const rebuilder = new GlassRebuilder({
        database: { onDatabaseReset: { addHandler: vi.fn() } },
        setting: {
            suspendAllSync: { addHandler: vi.fn() },
            currentSettings: () => ({ couchDB_URI: "https://glass.example.com/sync", useRequestAPI: false }),
        },
    } as unknown as ServiceRebuilderDependencies);
    const standard = vi.spyOn(rebuilder, "fetchLocal").mockResolvedValue();
    await rebuilder.fetchLocalDBFast(true);
    expect(standard).toHaveBeenCalledWith(false, true, true);
});
