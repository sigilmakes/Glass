export interface SecretStore {
    getSecret(id: string): string | null;
    setSecret(id: string, secret: string): void;
}
export interface GlassVault {
    id: string;
    name: string;
    database: string;
    url: string;
    createdAt: string;
}
interface AuthConfig {
    issuer: string;
    clientId: string;
    audience: string;
    redirectUri: string;
}
interface Discovery {
    authorization_endpoint: string;
    token_endpoint: string;
    pushed_authorization_request_endpoint: string;
}
interface Tokens {
    access_token: string;
    refresh_token: string;
    expiresAt: number;
}
interface Pending {
    state: string;
    verifier: string;
    config: AuthConfig;
    discovery: Discovery;
    started: number;
}
interface Session {
    server: string;
    tokens?: Tokens;
    pending?: Pending;
    vault?: GlassVault;
}
export type Transport = (url: string, options?: RequestInit) => Promise<Response>;
const base64url = (bytes: Uint8Array) =>
    btoa(String.fromCharCode(...bytes))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
const random = () => base64url(crypto.getRandomValues(new Uint8Array(32)));
function https(value: string): string {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
        throw new Error("Glass requires a plain HTTPS URL.");
    return url.href.replace(/\/$/, "");
}
export class GlassSession {
    private queue: Promise<unknown> = Promise.resolve();
    constructor(
        private store: SecretStore,
        private key: string,
        private send: Transport
    ) {}
    private read(): Session | undefined {
        const value = this.store.getSecret(this.key);
        return value ? (JSON.parse(value) as Session) : undefined;
    }
    private write(session: Session) {
        this.store.setSecret(this.key, JSON.stringify(session));
    }
    private exclusive<T>(action: () => Promise<T>): Promise<T> {
        const result = this.queue.then(action);
        this.queue = result.catch((): void => {});
        return result;
    }
    private async json<T>(url: string, options?: RequestInit): Promise<T> {
        const response = await this.send(url, options);
        if (!response.ok) throw new Error(`Glass request failed (${response.status}).`);
        return (await response.json()) as T;
    }
    async signIn(serverURL: string): Promise<string> {
        return this.exclusive(async () => {
            const server = https(serverURL);
            const config = await this.json<AuthConfig>(`${server}/api/v1/auth/config`);
            const issuer = https(config.issuer);
            if (config.redirectUri !== `${server}/auth/callback`) throw new Error("Unexpected Glass callback URL.");
            const discovery = await this.json<Discovery>(`${issuer}/.well-known/openid-configuration`);
            for (const endpoint of Object.values(discovery).filter(
                (value): value is string => typeof value === "string"
            )) {
                if (endpoint.startsWith("http:")) throw new Error("Insecure identity endpoint.");
            }
            https(discovery.token_endpoint);
            https(discovery.authorization_endpoint);
            https(discovery.pushed_authorization_request_endpoint);
            const verifier = random();
            const state = random();
            const challenge = base64url(
                new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)))
            );
            const body = new URLSearchParams({
                client_id: config.clientId,
                redirect_uri: config.redirectUri,
                grant_type: "authorization_code",
                response_type: "code",
                response_mode: "form_post",
                scope: "authelia.bearer.authz offline_access",
                audience: config.audience,
                resource: server,
                prompt: "consent",
                state,
                code_challenge: challenge,
                code_challenge_method: "S256",
            });
            const par = await this.json<{ request_uri: string }>(discovery.pushed_authorization_request_endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: body.toString(),
            });
            this.write({ server, pending: { state, verifier, config, discovery, started: Date.now() } });
            const url = new URL(discovery.authorization_endpoint);
            url.search = new URLSearchParams({ client_id: config.clientId, request_uri: par.request_uri }).toString();
            return url.href;
        });
    }
    async callback(params: Record<string, string>): Promise<void> {
        return this.exclusive(async () => {
            const session = this.read();
            const pending = session?.pending;
            if (!session || !pending || params.state !== pending.state || Date.now() - pending.started > 600000)
                throw new Error("Glass sign-in state is invalid or expired.");
            delete session.pending;
            this.write(session);
            if (params.error || !params.code) throw new Error("Glass sign-in was not completed.");
            const tokens = await this.exchange(pending.discovery.token_endpoint, {
                grant_type: "authorization_code",
                client_id: pending.config.clientId,
                code: params.code,
                redirect_uri: pending.config.redirectUri,
                code_verifier: pending.verifier,
            });
            this.write({ ...session, tokens });
            // Refresh needs the client and endpoint, but not the one-use verifier.
            this.store.setSecret(
                `${this.key}-issuer`,
                JSON.stringify({ clientId: pending.config.clientId, endpoint: pending.discovery.token_endpoint })
            );
        });
    }
    private async exchange(endpoint: string, parameters: Record<string, string>): Promise<Tokens> {
        const value = await this.json<{ access_token: string; refresh_token: string; expires_in: number }>(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams(parameters).toString(),
        });
        if (!value.access_token || !value.refresh_token || !(value.expires_in > 0))
            throw new Error("Incomplete Glass tokens.");
        return {
            access_token: value.access_token,
            refresh_token: value.refresh_token,
            expiresAt: Date.now() + value.expires_in * 1000,
        };
    }
    private async accessToken(expectedServer: string): Promise<string> {
        return this.exclusive(async () => {
            const session = this.read();
            if (!session?.tokens || session.server !== expectedServer)
                throw new Error("Sign in to Glass on this device first.");
            if (session.tokens.expiresAt <= Date.now() + 30000) {
                const issuer = JSON.parse(this.store.getSecret(`${this.key}-issuer`) || "null") as {
                    clientId: string;
                    endpoint: string;
                } | null;
                if (!issuer) throw new Error("Sign in to Glass again.");
                try {
                    session.tokens = await this.exchange(issuer.endpoint, {
                        grant_type: "refresh_token",
                        client_id: issuer.clientId,
                        refresh_token: session.tokens.refresh_token,
                    });
                    this.write(session);
                } catch {
                    // A lost response may have consumed the rotating refresh token.
                    delete session.tokens;
                    this.write(session);
                    throw new Error("Glass session expired. Sign in again.");
                }
            }
            return session.tokens.access_token;
        });
    }
    async api<T>(path: string, options?: RequestInit): Promise<T> {
        const session = this.read();
        if (!session) throw new Error("Sign in to Glass first.");
        const headers = new Headers(options?.headers);
        headers.set("Authorization", `Bearer ${await this.accessToken(session.server)}`);
        return this.json<T>(`${session.server}/api/v1/${path}`, { ...options, headers });
    }
    async signOut(): Promise<void> {
        return this.exclusive(async () => {
            this.store.setSecret(this.key, "");
            this.store.setSecret(`${this.key}-issuer`, "");
            await Promise.resolve();
        });
    }
    async vaults(): Promise<GlassVault[]> {
        return (await this.api<{ vaults: GlassVault[] }>("vaults")).vaults;
    }
    async createVault(name: string): Promise<GlassVault> {
        return this.api<GlassVault>("vaults", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name }),
        });
    }
    async selectVault(id: string): Promise<GlassVault> {
        const vault = (await this.vaults()).find((v) => v.id === id);
        const session = this.read();
        if (!vault || !session || vault.url !== `${session.server}/sync` || !/^glass_[a-z0-9_]+$/.test(vault.database))
            throw new Error("Invalid Glass vault selection.");
        session.vault = vault;
        this.write(session);
        return vault;
    }
    async transport(
        req: string | Request,
        options: RequestInit | undefined,
        fallback: (req: string | Request, options?: RequestInit) => Promise<Response>
    ): Promise<Response> {
        const url = new URL(typeof req === "string" ? req : req.url);
        const session = this.read();
        const root = session ? new URL(`${session.server}/sync`) : undefined;
        if (
            !session ||
            !root ||
            url.origin !== root.origin ||
            !(url.pathname === root.pathname || url.pathname.startsWith(`${root.pathname}/`))
        )
            return fallback(req, options);
        const headers = new Headers(req instanceof Request ? req.headers : undefined);
        new Headers(options?.headers).forEach((value, key) => headers.set(key, value));
        headers.set("Authorization", `Bearer ${await this.accessToken(session.server)}`);
        const method = (options?.method ?? (req instanceof Request ? req.method : "GET")).toUpperCase();
        const dbPath = session?.vault ? `${root.pathname}/${session.vault.database}` : undefined;
        if (dbPath && url.pathname.replace(/\/$/, "") === dbPath) {
            if (method === "DELETE") {
                await this.api(`vaults/${encodeURIComponent(session.vault!.id)}/rebuild`, { method: "POST" });
                return Response.json({ ok: true });
            }
            if (method === "PUT") return Response.json({ ok: true });
        }
        return fallback(req, { ...options, method, headers, redirect: "error" });
    }
}
