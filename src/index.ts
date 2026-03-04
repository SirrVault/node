/**
 * @sirrlock/node — Sirr Node.js client
 *
 * Thin fetch wrapper around the Sirr HTTP API.
 * No native dependencies. Works in Node 18+.
 */

export interface SirrClientOptions {
  /** Sirr server base URL. Default: http://localhost:39999 */
  server?: string;
  /** Bearer token (SIRR_MASTER_KEY on the server side). */
  token: string;
  /** Org slug for multi-tenant mode. When set, all resource paths are prefixed with /orgs/{org}. */
  org?: string;
}

export interface PushOptions {
  /** TTL in seconds. */
  ttl?: number;
  /** Maximum number of reads before the secret self-destructs. */
  reads?: number;
}

export interface SecretMeta {
  key: string;
  created_at: number;
  expires_at: number | null;
  max_reads: number | null;
  read_count: number;
}

export interface AuditEvent {
  id: number;
  timestamp: number;
  action: string;
  key: string | null;
  source_ip: string;
  success: boolean;
  detail: string | null;
}

export interface AuditOptions {
  since?: number;
  until?: number;
  action?: string;
  limit?: number;
}

export interface Webhook {
  id: string;
  url: string;
  events: string[];
  created_at: number;
}

export interface WebhookCreateResult {
  id: string;
  secret: string;
}

export interface ApiKey {
  id: string;
  label: string;
  permissions: string[];
  prefix: string | null;
  created_at: number;
}

export interface ApiKeyCreateResult {
  id: string;
  key: string;
  label: string;
  permissions: string[];
  prefix: string | null;
}

export interface CreateApiKeyOptions {
  label: string;
  permissions: string[];
  prefix?: string;
}

export class SirrError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(`Sirr API error ${status}: ${message}`);
    this.name = "SirrError";
  }
}

function validateKey(key: string): void {
  if (!key) {
    throw new Error("Secret key must not be empty");
  }
}

export class SirrClient {
  private readonly server: string;
  private readonly token: string;
  private readonly org?: string;

  constructor(opts: SirrClientOptions) {
    if (!opts.token) {
      throw new Error("SirrClient requires a non-empty token");
    }
    this.server = (opts.server ?? "http://localhost:39999").replace(/\/$/, "");
    this.token = opts.token;
    this.org = opts.org;
  }

  private secretsPath(key?: string): string {
    const base = this.org ? `/orgs/${encodeURIComponent(this.org)}/secrets` : "/secrets";
    return key ? `${base}/${encodeURIComponent(key)}` : base;
  }

  private auditPath(): string {
    return this.org ? `/orgs/${encodeURIComponent(this.org)}/audit` : "/audit";
  }

  private webhooksPath(id?: string): string {
    const base = this.org ? `/orgs/${encodeURIComponent(this.org)}/webhooks` : "/webhooks";
    return id ? `${base}/${encodeURIComponent(id)}` : base;
  }

  private prunePath(): string {
    return this.org ? `/orgs/${encodeURIComponent(this.org)}/prune` : "/prune";
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
    };
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.server}${path}`, {
      method,
      headers: this.headers(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      let message = "unknown error";
      try {
        const json = (await res.json()) as Record<string, unknown>;
        message = (json.error as string) ?? message;
      } catch {
        try {
          const text = await res.text();
          if (text) message = text.slice(0, 200);
        } catch {
          // body already consumed or unreadable — keep default message
        }
      }
      throw new SirrError(res.status, message);
    }

    return (await res.json()) as T;
  }

  /** Check server health. Does not require authentication. */
  async health(): Promise<{ status: string }> {
    const res = await fetch(`${this.server}/health`);
    if (!res.ok) {
      throw new SirrError(res.status, "health check failed");
    }
    return res.json() as Promise<{ status: string }>;
  }

  /**
   * Push a secret to the vault.
   *
   * @param key   Secret key name
   * @param value Secret value
   * @param opts  TTL (seconds) and/or max read count
   */
  async push(key: string, value: string, opts: PushOptions = {}): Promise<void> {
    validateKey(key);
    await this.request("POST", this.secretsPath(), {
      key,
      value,
      ttl_seconds: opts.ttl ?? null,
      max_reads: opts.reads ?? null,
    });
  }

  /**
   * Retrieve a secret by key. Increments the read counter.
   * Returns `null` if the secret does not exist or has expired/burned.
   */
  async get(key: string): Promise<string | null> {
    validateKey(key);
    try {
      const data = await this.request<{ value: string }>(
        "GET",
        this.secretsPath(key),
      );
      return data.value;
    } catch (e) {
      if (e instanceof SirrError && e.status === 404) return null;
      throw e;
    }
  }

  /** List metadata for all active secrets. Values are never returned. */
  async list(): Promise<SecretMeta[]> {
    const data = await this.request<{ secrets: SecretMeta[] }>("GET", this.secretsPath());
    return data.secrets;
  }

  /** Delete a secret immediately. Returns true if it existed. */
  async delete(key: string): Promise<boolean> {
    validateKey(key);
    try {
      await this.request("DELETE", this.secretsPath(key));
      return true;
    } catch (e) {
      if (e instanceof SirrError && e.status === 404) return false;
      throw e;
    }
  }

  /**
   * Retrieve all secrets and return them as a key→value map.
   * Each GET increments the respective read counter.
   */
  async pullAll(): Promise<Record<string, string>> {
    const metas = await this.list();
    const result: Record<string, string> = {};
    await Promise.all(
      metas.map(async (m) => {
        const value = await this.get(m.key);
        if (value !== null) result[m.key] = value;
      }),
    );
    return result;
  }

  /** Trigger an immediate sweep of expired secrets on the server. */
  async prune(): Promise<number> {
    const data = await this.request<{ pruned: number }>("POST", this.prunePath());
    return data.pruned;
  }

  /**
   * Inject all vault secrets as process.env variables, then invoke `fn`.
   * Useful in test harnesses and scripts.
   */
  async withSecrets<T>(fn: () => Promise<T>): Promise<T> {
    const secrets = await this.pullAll();
    const originals: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(secrets)) {
      originals[k] = process.env[k];
      process.env[k] = v;
    }
    try {
      return await fn();
    } finally {
      for (const [k, orig] of Object.entries(originals)) {
        if (orig === undefined) delete process.env[k];
        else process.env[k] = orig;
      }
    }
  }

  /** Query the audit log. */
  async getAuditLog(opts: AuditOptions = {}): Promise<AuditEvent[]> {
    const params = new URLSearchParams();
    if (opts.since != null) params.set("since", String(opts.since));
    if (opts.until != null) params.set("until", String(opts.until));
    if (opts.action != null) params.set("action", opts.action);
    if (opts.limit != null) params.set("limit", String(opts.limit));
    const qs = params.toString();
    const data = await this.request<{ events: AuditEvent[] }>("GET", `${this.auditPath()}${qs ? `?${qs}` : ""}`);
    return data.events;
  }

  /** Register a webhook. Returns the ID and signing secret. */
  async createWebhook(url: string, opts?: { events?: string[] }): Promise<WebhookCreateResult> {
    const body: Record<string, unknown> = { url };
    if (opts?.events) body.events = opts.events;
    return this.request<WebhookCreateResult>("POST", this.webhooksPath(), body);
  }

  /** List registered webhooks. Signing secrets are redacted. */
  async listWebhooks(): Promise<Webhook[]> {
    const data = await this.request<{ webhooks: Webhook[] }>("GET", this.webhooksPath());
    return data.webhooks;
  }

  /** Delete a webhook by ID. Returns false if not found. */
  async deleteWebhook(id: string): Promise<boolean> {
    try {
      await this.request("DELETE", this.webhooksPath(id));
      return true;
    } catch (e) {
      if (e instanceof SirrError && e.status === 404) return false;
      throw e;
    }
  }

  /** Create a scoped API key. The raw key is returned once. */
  async createApiKey(opts: CreateApiKeyOptions): Promise<ApiKeyCreateResult> {
    return this.request<ApiKeyCreateResult>("POST", "/keys", opts);
  }

  /** List all scoped API keys. Key hashes are never returned. */
  async listApiKeys(): Promise<ApiKey[]> {
    const data = await this.request<{ keys: ApiKey[] }>("GET", "/keys");
    return data.keys;
  }

  /** Delete an API key by ID. Returns false if not found. */
  async deleteApiKey(id: string): Promise<boolean> {
    try {
      await this.request("DELETE", `/keys/${encodeURIComponent(id)}`);
      return true;
    } catch (e) {
      if (e instanceof SirrError && e.status === 404) return false;
      throw e;
    }
  }

  // ── /me endpoints ─────────────────────────────────────────

  /** Get the current principal's profile. */
  async me(): Promise<any> {
    return this.request("GET", "/me");
  }

  /** Update the current principal's profile. */
  async updateMe(body: Record<string, unknown>): Promise<any> {
    return this.request("PATCH", "/me", body);
  }

  /** Create a new API key for the current principal. */
  async createKey(body: Record<string, unknown>): Promise<any> {
    return this.request("POST", "/me/keys", body);
  }

  /** Delete an API key belonging to the current principal. */
  async deleteKey(keyId: string): Promise<void> {
    await this.request("DELETE", `/me/keys/${encodeURIComponent(keyId)}`);
  }

  // ── Admin endpoints (master key only) ─────────────────────

  /** Create an org. */
  async createOrg(body: Record<string, unknown>): Promise<any> {
    return this.request("POST", "/orgs", body);
  }

  /** List all orgs. */
  async listOrgs(): Promise<any> {
    return this.request("GET", "/orgs");
  }

  /** Delete an org by ID. */
  async deleteOrg(orgId: string): Promise<void> {
    await this.request("DELETE", `/orgs/${encodeURIComponent(orgId)}`);
  }

  /** Create a principal within an org. */
  async createPrincipal(orgId: string, body: Record<string, unknown>): Promise<any> {
    return this.request("POST", `/orgs/${encodeURIComponent(orgId)}/principals`, body);
  }

  /** List principals within an org. */
  async listPrincipals(orgId: string): Promise<any> {
    return this.request("GET", `/orgs/${encodeURIComponent(orgId)}/principals`);
  }

  /** Delete a principal within an org. */
  async deletePrincipal(orgId: string, principalId: string): Promise<void> {
    await this.request(
      "DELETE",
      `/orgs/${encodeURIComponent(orgId)}/principals/${encodeURIComponent(principalId)}`,
    );
  }

  /** Create a role within an org. */
  async createRole(orgId: string, body: Record<string, unknown>): Promise<any> {
    return this.request("POST", `/orgs/${encodeURIComponent(orgId)}/roles`, body);
  }

  /** List roles within an org. */
  async listRoles(orgId: string): Promise<any> {
    return this.request("GET", `/orgs/${encodeURIComponent(orgId)}/roles`);
  }

  /** Delete a role within an org. */
  async deleteRole(orgId: string, roleName: string): Promise<void> {
    await this.request(
      "DELETE",
      `/orgs/${encodeURIComponent(orgId)}/roles/${encodeURIComponent(roleName)}`,
    );
  }
}
