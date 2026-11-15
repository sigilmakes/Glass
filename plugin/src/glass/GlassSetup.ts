import { Modal, Notice, Setting } from "obsidian";
import type ObsidianLiveSyncPlugin from "@/main";
import type { GlassSession, GlassVault } from "./GlassSession";
import { SetupManager, UserMode } from "@/modules/features/SetupManager";
import { glassSettings } from "./settings";

export class GlassSetup extends Modal {
    private vaultList?: HTMLElement;
    constructor(
        private plugin: ObsidianLiveSyncPlugin,
        private session: GlassSession
    ) {
        super(plugin.app);
    }
    private run(action: () => Promise<unknown>) {
        void action().catch(
            () => new Notice("Glass could not complete this action. Check the server URL and sign in again.")
        );
    }
    override onOpen() {
        this.contentEl.empty();
        this.contentEl.createEl("h2", { text: "Glass" });
        let server = "";
        new Setting(this.contentEl).setName("Server URL").addText((text) =>
            text.setPlaceholder("https://glass.example.com").onChange((value) => {
                server = value;
            })
        );
        new Setting(this.contentEl).setName("Sign in").addButton((button) =>
            button.setButtonText("Open browser").onClick(() =>
                this.run(async () => {
                    const url = await this.session.signIn(server);
                    window.open(url, "_blank", "noopener,noreferrer");
                    this.close();
                })
            )
        );
        new Setting(this.contentEl)
            .setName("Remote vaults")
            .addButton((button) =>
                button.setButtonText("Choose a vault").onClick(() => this.run(() => this.showVaults()))
            );
        let name = this.plugin.app.vault.getName();
        new Setting(this.contentEl)
            .setName("New remote vault")
            .addText((text) =>
                text.setValue(name).onChange((value) => {
                    name = value;
                })
            )
            .addButton((button) =>
                button.setButtonText("Create").onClick(() =>
                    this.run(async () => {
                        if (!name.trim()) return;
                        await this.session.createVault(name.trim());
                        await this.showVaults();
                    })
                )
            );
        new Setting(this.contentEl).setName("Sign out on this device").addButton((button) =>
            button.setButtonText("Sign out").onClick(() =>
                this.run(async () => {
                    await this.session.signOut();
                    new Notice("Signed out of Glass on this device.");
                })
            )
        );
        new Setting(this.contentEl).setName("Advanced LiveSync setup").addButton((button) =>
            button.setButtonText("Open").onClick(() => {
                this.close();
                this.run(() => this.plugin.core.getModule(SetupManager).startOnBoarding(false));
            })
        );
    }
    private async showVaults() {
        const vaults = await this.session.vaults();
        this.vaultList?.remove();
        const list = this.contentEl.createDiv();
        this.vaultList = list;
        list.createEl("h3", { text: "Choose your remote vault" });
        for (const vault of vaults) {
            new Setting(list)
                .setName(vault.name)
                .addButton((button) =>
                    button.setButtonText("Use vault").onClick(() => this.run(() => this.apply(vault)))
                );
        }
        if (!vaults.length) list.createEl("p", { text: "No remote vaults yet. Create one above." });
    }
    private async apply(vault: GlassVault) {
        const selected = await this.session.selectVault(vault.id);
        const settings = glassSettings(selected);
        this.close();
        await this.plugin.core.getModule(SetupManager).onConfirmApplySettingsFromWizard(settings, UserMode.Unknown);
    }
    override onClose() {
        this.contentEl.empty();
    }
}
