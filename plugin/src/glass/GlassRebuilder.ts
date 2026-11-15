import {
    ServiceRebuilder,
    type ServiceRebuilderDependencies,
} from "@vrtmrz/livesync-commonlib/compat/serviceModules/Rebuilder";
import { isGlassRemote } from "./settings";
export class GlassRebuilder extends ServiceRebuilder {
    constructor(private readonly glassServices: ServiceRebuilderDependencies) {
        super(glassServices);
    }
    override async fetchLocalDBFast(autoResume: boolean): Promise<void> {
        if (isGlassRemote(this.glassServices.setting.currentSettings().couchDB_URI)) {
            // Commonlib Fast Fetch bypasses host authentication until it accepts an injected transport.
            await this.fetchLocal(false, true, autoResume);
            return;
        }
        await super.fetchLocalDBFast(autoResume);
    }
}
