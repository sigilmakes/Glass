import { describe, expect, it, vi } from "vitest";
import { GlassSession, type GlassVault } from "./GlassSession";
import { glassSettings } from "./settings";
const server = "https://glass.example.com";
const vault: GlassVault = {
    id: "vault-one",
    name: "Notes",
    database: "glass_abc",
    url: `${server}/sync`,
    createdAt: "2026-01-01",
};
function fixture() {
    const secrets = new Map<string, string>();
    const send = vi.fn(async (url: string, options?: RequestInit): Promise<Response> => {
        if (url.endsWith("/auth/config"))
            return Response.json({
                issuer: "https://id.example.com",
                clientId: "glass",
                audience: server,
                redirectUri: `${server}/auth/callback`,
            });
        if (url.includes(".well-known"))
            return Response.json({
                authorization_endpoint: "https://id.example.com/authorize",
                token_endpoint: "https://id.example.com/token",
                pushed_authorization_request_endpoint: "https://id.example.com/par",
            });
        if (url.endsWith("/par")) return Response.json({ request_uri: "urn:test" });
        if (url.endsWith("/token")) {
            const parameters = new URLSearchParams(options?.body as string);
            return Response.json({
                access_token: parameters.has("refresh_token") ? "access-two" : "access-one",
                refresh_token: parameters.has("refresh_token") ? "refresh-two" : "refresh-one",
                expires_in: 60,
            });
        }
        if (url.endsWith("/vaults")) return Response.json({ vaults: [vault] });
        return Response.json({ ok: true });
    });
    const session = new GlassSession(
        {
            getSecret: (id) => secrets.get(id) ?? null,
            setSecret: (id, value) => {
                secrets.set(id, value);
            },
        },
        "glass-test",
        send
    );
    const login = async () => {
        await session.signIn(server);
        const stored = JSON.parse(secrets.get("glass-test")!);
        await session.callback({ state: stored.pending.state, code: "authorisation-code" });
    };
    return { session, secrets, send, login };
}
describe("Glass sign-in", () => {
    it("uses PKCE PAR, bearer scope, resource, and form_post without exposing the verifier in the browser URL", async () => {
        const f = fixture();
        const url = await f.session.signIn(server);
        const par = f.send.mock.calls.find(([url]) => url.endsWith("/par"))!;
        const body = new URLSearchParams(par[1]!.body as string);
        expect(body.get("code_challenge_method")).toBe("S256");
        expect(body.get("resource")).toBe(server);
        expect(body.get("scope")).toBe("authelia.bearer.authz offline_access");
        expect(body.get("response_mode")).toBe("form_post");
        expect(url).not.toContain("code_verifier");
        expect(url).toContain("request_uri=");
        await expect(f.session.callback({ state: "wrong", code: "code" })).rejects.toThrow("state");
        expect(f.send.mock.calls.some(([url]) => url.endsWith("/token"))).toBe(false);
    });
    it("consumes callback state exactly once", async () => {
        const f = fixture();
        await f.login();
        await expect(f.session.callback({ state: "old", code: "code" })).rejects.toThrow("state");
        expect(JSON.parse(f.secrets.get("glass-test")!).pending).toBeUndefined();
    });
    it("serialises refresh rotation and persists the replacement before concurrent callers continue", async () => {
        const f = fixture();
        await f.login();
        const value = JSON.parse(f.secrets.get("glass-test")!);
        value.tokens.expiresAt = 0;
        f.secrets.set("glass-test", JSON.stringify(value));
        await Promise.all([f.session.vaults(), f.session.vaults(), f.session.vaults()]);
        const refreshes = f.send.mock.calls.filter(
            ([url, opts]) => url.endsWith("/token") && String(opts?.body).includes("refresh_token")
        );
        expect(refreshes).toHaveLength(1);
        expect(JSON.parse(f.secrets.get("glass-test")!).tokens.refresh_token).toBe("refresh-two");
    });
    it("fails closed after an uncertain rotating refresh", async () => {
        const f = fixture();
        await f.login();
        const value = JSON.parse(f.secrets.get("glass-test")!);
        value.tokens.expiresAt = 0;
        f.secrets.set("glass-test", JSON.stringify(value));
        f.send.mockRejectedValueOnce(new Error("network"));
        await expect(f.session.vaults()).rejects.toThrow("Sign in again");
        await expect(f.session.vaults()).rejects.toThrow("Sign in");
        expect(JSON.parse(f.secrets.get("glass-test")!).tokens).toBeUndefined();
    });
    it("creates a named private vault through the authenticated API", async () => {
        const f = fixture();
        await f.login();
        await f.session.createVault("Work notes");
        const call = f.send.mock.calls.find(([url, options]) => url.endsWith("/vaults") && options?.method === "POST")!;
        expect(JSON.parse(call[1]!.body as string)).toEqual({ name: "Work notes" });
        expect(new Headers(call[1]!.headers).get("Authorization")).toBe("Bearer access-one");
    });
    it("removes local credentials on sign out", async () => {
        const f = fixture();
        await f.login();
        await f.session.signOut();
        await expect(f.session.vaults()).rejects.toThrow("Sign in");
        expect([...f.secrets.values()].join("")).not.toContain("refresh-one");
    });
    it("selects only a vault returned by the authenticated gateway and exports no tokens", async () => {
        const f = fixture();
        await f.login();
        await expect(f.session.selectVault("someone-elses-vault")).rejects.toThrow("selection");
        const selected = await f.session.selectVault(vault.id);
        const settings = glassSettings(selected);
        expect(settings.couchDB_URI).toBe(`${server}/sync`);
        expect(settings.couchDB_DBNAME).toBe(vault.database);
        expect(settings.useRequestAPI).toBe(true);
        expect(JSON.stringify(settings)).not.toContain("access-one");
        expect(JSON.stringify(settings)).not.toContain("refresh-one");
        expect(settings.couchDB_CustomHeaders).toBe("");
    });
    it("injects only at the exact sync origin/path and translates reset into owner lifecycle API", async () => {
        const f = fixture();
        await f.login();
        await f.session.selectVault(vault.id);
        const fallback = vi.fn(async (_url: string | Request, _options?: RequestInit) => Response.json({ ok: true }));
        await f.session.transport(
            `${server}/sync/glass_abc/_changes`,
            { headers: { Authorization: "Basic stale" } },
            fallback
        );
        expect(new Headers(fallback.mock.calls[0][1]?.headers).get("authorization")).toBe("Bearer access-one");
        const before = fallback.mock.calls.length;
        await f.session.transport(`${server}/sync/glass_abc`, { method: "DELETE" }, fallback);
        expect(fallback.mock.calls.length).toBe(before);
        expect(
            f.send.mock.calls.some(
                ([url, opts]) => url.endsWith("/vaults/vault-one/rebuild") && opts?.method === "POST"
            )
        ).toBe(true);
        await f.session.transport("https://evil.example.com/sync/glass_abc", {}, fallback);
        expect(fallback.mock.calls[fallback.mock.calls.length - 1]?.[1]).toEqual({});
        await f.session.transport(`${server}/sync-other/glass_abc`, {}, fallback);
        expect(fallback.mock.calls[fallback.mock.calls.length - 1]?.[1]).toEqual({});
    });
});
