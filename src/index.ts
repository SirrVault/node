/**
 * @sirrlock/node — Sirr Node.js client
 *
 * Zero-dependency TypeScript client for the Sirr HTTP API.
 * Works in Node 18+, Deno, Bun, and edge runtimes.
 */

// ── Constructor options ───────────────────────────────────────────────────────

export interface SirrClientOptions {
  /** Sirr server base URL. Default: http://localhost:39999 */
  server?: string;
  /** Bearer token — master key or principal API key. */
  token: string;
  /**
   * Org ID for multi-tenant mode. When set, all secret, audit, webhook, and
   * prune operations are scoped under `/orgs/{org}/`.
   */
  org?: string;
}

// ── Secret operation options ──────────────────────────────────────────────────

export interface PushOptions {
  /** Time-to-live in seconds. Omit for no expiration. */
  ttl?: number;
  /** Maximum reads before the secret is burned or sealed. */
  reads?: number;
  /**
   * Whether to permanently delete the secret after reaching `reads`.
   * `true` (default) = burn; `false` = seal (still patchable via `patch()`).
   */
  burnOnRead?: boolean;
  /**
   * Webhook URL to call when this secret is read or burned.
   * Must be HTTPS and within the server's allowed origins.
   */
  webhookUrl?: string;
  /**
   * Restrict reads to specific principal key names (org-scoped secrets only).
   * Omit to allow any key with read permission.
   */
  allowedKeys?: string[];
}

export interface PatchOptions {
  /** Replace the stored value. */
  value?: string;
  /** New TTL in seconds from now (resets the expiry clock). */
  ttl?: number;
  /** New maximum read count. */
  reads?: number;
}

/**
 * Metadata returned by `check()` (HEAD request).
 * Does not consume a read counter.
 */
export interface SecretStatus {
  /** `"active"` = readable; `"sealed"` = reads exhausted but not deleted. */
  status: "active" | "sealed";
  readCount: number;
  readsRemaining: number | "unlimited";
  /** `true` = burns on read; `false` = seals on read. */
  burnOnRead: boolean;
  createdAt: number;
  expiresAt: number | null;
}

// ── Response types ────────────────────────────────────────────────────────────

export interface SecretMeta {
  key: string;
  created_at: number;
  expires_at: number | null;
  max_reads: number | null;
  read_count: number;
  /**
   * Whether the secret burns (`true`) or seals (`false`) on read-limit.
   * Only present on secrets that were created with an explicit `burnOnRead`
   * value or in responses from `patch()`.
   */
  delete?: boolean;
  /** ID of the principal that created this secret (org secrets only). */
  owner_id?: string;
}

export interface AuditEvent {
  id: number;
  timestamp: number;
  action: string;
  key: string | null;
  source_ip: string;
  success: boolean;
  detail: string | null;
  org_id?: string;
  principal_id?: string;
}

/** Filter parameters for audit log queries. */
export interface AuditFilter {
  /** Return events at or after this Unix timestamp. */
  since?: number;
  /** Return events at or before this Unix timestamp. */
  until?: number;
  /** Filter by action type, e.g. `"secret.read"`. */
  action?: string;
  /** Maximum number of entries to return (default 100, max 1000). */
  limit?: number;
}

/** @deprecated Use `AuditFilter`. */
export type AuditOptions = AuditFilter;

export interface Webhook {
  id: string;
  url: string;
  events: string[];
  created_at: number;
}

export interface WebhookCreateResult {
  id: string;
  /** Signing secret — shown only once, save immediately. */
  secret: string;
}

// ── Org / principal / role types ──────────────────────────────────────────────

export interface Org {
  id: string;
  name: string;
  metadata?: Record<string, string>;
  created_at?: number;
}

export interface Principal {
  id: string;
  name: string;
  role: string;
  org_id: string;
  metadata?: Record<string, string>;
  created_at?: number;
}

export interface Role {
  name: string;
  /** Permission letter string, e.g. `"rRlL"`. */
  permissions: string;
  org_id?: string;
  builtin?: boolean;
  created_at?: number;
}

export interface PrincipalKey {
  id: string;
  name: string;
  valid_after: number;
  valid_before: number;
  created_at: number;
}

export interface MeResponse {
  id: string;
  name: string;
  role: string;
  org_id: string;
  metadata: Record<string, string>;
  created_at: number;
  keys: PrincipalKey[];
}

export interface PrincipalKeyCreateResult {
  id: string;
  name: string;
  /** Raw API key — shown only once, save immediately. */
  key: string;
  valid_after: number;
  valid_before: number;
}

// ── Admin request options ─────────────────────────────────────────────────────

export interface CreateOrgOptions {
  name: string;
  metadata?: Record<string, string>;
}

export interface CreatePrincipalOptions {
  name: string;
  /**
   * Role to assign. Built-in: `reader`, `writer`, `admin`, `owner`.
   * Custom roles can be created per-org.
   */
  role: string;
  metadata?: Record<string, string>;
}

export interface CreateRoleOptions {
  name: string;
  /**
   * Permission letter string. Each letter enables a permission bit.
   * Examples: `"r"` (read), `"rRlL"` (read + list), `"rRlLcCpPaAmMdD"` (full).
   *
   * | Letter | Permission |
   * |--------|-----------|
   * | `r`    | ReadOrg |
   * | `R`    | ReadMy |
   * | `l`    | ListOrg |
   * | `L`    | ListMy |
   * | `c`    | CreateOrg |
   * | `C`    | CreateMy |
   * | `p`    | PatchOrg |
   * | `P`    | PatchMy |
   * | `d`    | DeleteOrg |
   * | `D`    | DeleteMy |
   * | `a`    | AuditRead |
   * | `m`    | ManageOrg |
   */
  permissions: string;
}

export interface CreateKeyOptions {
  /** Human-readable label for this key. */
  name: string;
  /** Lifetime in seconds from now. Defaults to 1 year. */
  valid_for_seconds?: number;
  /** Absolute expiry as a Unix timestamp. Overrides `valid_for_seconds`. */
  valid_before?: number;
}

export interface PatchMeOptions {
  /** Replaces the entire metadata map on the current principal. */
  metadata: Record<string, string>;
}

// ── Namespaced sub-client interfaces ─────────────────────────────────────────

export interface WebhookClient {
  /**
   * Register a webhook. Returns the ID and signing secret.
   * @param url   HTTPS endpoint to receive events
   * @param opts  Optional event filter (default `["*"]`)
   */
  create(url: string, opts?: { events?: string[] }): Promise<WebhookCreateResult>;
  /** List all registered webhooks. Signing secrets are redacted. */
  list(): Promise<Webhook[]>;
  /** Delete a webhook by ID. Returns false if not found. */
  delete(id: string): Promise<boolean>;
}

export interface OrgClient {
  /** Create a new organization. Requires master key. */
  create(opts: CreateOrgOptions): Promise<Org>;
  /** List all organizations. Requires master key. */
  list(): Promise<Org[]>;
  /** Delete an organization by ID. Requires master key. */
  delete(id: string): Promise<void>;
}

export interface PrincipalClient {
  /** Create a principal within an org. Requires master key. */
  create(orgId: string, opts: CreatePrincipalOptions): Promise<Principal>;
  /** List all principals in an org. Requires master key. */
  list(orgId: string): Promise<Principal[]>;
  /** Delete a principal by ID. Requires master key. */
  delete(orgId: string, principalId: string): Promise<void>;
}

// ── Error ─────────────────────────────────────────────────────────────────────

export class SirrError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(`Sirr API error ${status}: ${message}`);
    this.name = "SirrError";
  }
}

// ── Validation ────────────────────────────────────────────────────────────────

function validateKey(key: string): void {
  if (!key) {
    throw new Error("Secret key must not be empty");
  }
}

// ── Client ────────────────────────────────────────────────────────────────────

export class SirrClient {
  private readonly server: string;
  private readonly token: string;
  private readonly org?: string;

  /** Webhook management — `sirr.webhooks.create/list/delete`. */
  readonly webhooks: WebhookClient;

  /** Organization management — `sirr.orgs.create/list/delete`. Requires master key. */
  readonly orgs: OrgClient;

  /** Principal management — `sirr.principals.create/list/delete`. Requires master key. */
  readonly principals: PrincipalClient;

  constructor(opts: SirrClientOptions) {
    if (!opts.token) {
      throw new Error("SirrClient requires a non-empty token");
    }
    this.server = (opts.server ?? "http://localhost:39999").replace(/\/$/, "");
    this.token = opts.token;
    this.org = opts.org;

    this.webhooks = {
      create: (url, whOpts?) => this.createWebhook(url, whOpts),
      list: () => this.listWebhooks(),
      delete: (id) => this.deleteWebhook(id),
    };

    this.orgs = {
      create: (o) => this.createOrg(o),
      list: () => this.listOrgs(),
      delete: (id) => this.deleteOrg(id),
    };

    this.principals = {
      create: (orgId, o) => this.createPrincipal(orgId, o),
      list: (orgId) => this.listPrincipals(orgId),
      delete: (orgId, principalId) => this.deletePrincipal(orgId, principalId),
    };
  }

  // ── Path helpers ────────────────────────────────────────────────────────────

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

  // ── HTTP helpers ────────────────────────────────────────────────────────────

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

  // ── Health ──────────────────────────────────────────────────────────────────

  /** Check server health. Does not require authentication. */
  async health(): Promise<{ status: string }> {
    const res = await fetch(`${this.server}/health`);
    if (!res.ok) {
      throw new SirrError(res.status, "health check failed");
    }
    return res.json() as Promise<{ status: string }>;
  }

  // ── Secrets ─────────────────────────────────────────────────────────────────

  /**
   * Push a secret to the vault.
   *
   * @param key   Secret key name (1-256 chars, alphanumeric + `-_.`)
   * @param value Secret value (max 1 MiB)
   * @param opts  TTL, read limit, and other options
   */
  async push(key: string, value: string, opts: PushOptions = {}): Promise<void> {
    validateKey(key);
    const body: Record<string, unknown> = {
      key,
      value,
      ttl_seconds: opts.ttl ?? null,
      max_reads: opts.reads ?? null,
    };
    if (opts.burnOnRead !== undefined) body.delete = opts.burnOnRead;
    if (opts.webhookUrl !== undefined) body.webhook_url = opts.webhookUrl;
    if (opts.allowedKeys !== undefined) body.allowed_keys = opts.allowedKeys;
    await this.request("POST", this.secretsPath(), body);
  }

  /**
   * Update a secret's value, TTL, or read limit in place.
   * Returns the updated metadata, or `null` if the secret does not exist.
   *
   * Only works on secrets created with `burnOnRead: false`. Attempting to
   * patch a burn-on-read secret returns `409 Conflict` (thrown as `SirrError`).
   */
  async patch(key: string, opts: PatchOptions): Promise<SecretMeta | null> {
    validateKey(key);
    const body: Record<string, unknown> = {};
    if (opts.value !== undefined) body.value = opts.value;
    if (opts.ttl !== undefined) body.ttl_seconds = opts.ttl;
    if (opts.reads !== undefined) body.max_reads = opts.reads;
    try {
      return await this.request<SecretMeta>("PATCH", this.secretsPath(key), body);
    } catch (e) {
      if (e instanceof SirrError && e.status === 404) return null;
      throw e;
    }
  }

  /**
   * Retrieve a secret by key. Increments the read counter.
   * Returns `null` if the secret does not exist, has expired, has been
   * burned (`delete: true`), or is sealed (`delete: false`, reads exhausted).
   */
  async get(key: string): Promise<string | null> {
    validateKey(key);
    try {
      const data = await this.request<{ value: string }>("GET", this.secretsPath(key));
      return data.value;
    } catch (e) {
      if (e instanceof SirrError && (e.status === 404 || e.status === 410)) return null;
      throw e;
    }
  }

  /** List metadata for all active secrets. Values are never returned. */
  async list(): Promise<SecretMeta[]> {
    const data = await this.request<{ secrets: SecretMeta[] }>("GET", this.secretsPath());
    return data.secrets;
  }

  /** Delete a secret immediately. Returns `true` if it existed. */
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
   * Inspect a secret's metadata without consuming a read counter (HEAD request).
   * Returns `null` if the secret does not exist or has expired.
   *
   * Use this in AI agent workflows to verify a secret is still valid before
   * fetching it and triggering an irreversible read.
   */
  async check(key: string): Promise<SecretStatus | null> {
    validateKey(key);
    const res = await fetch(`${this.server}${this.secretsPath(key)}`, {
      method: "HEAD",
      headers: this.headers(),
    });

    if (res.status === 404) return null;
    if (!res.ok && res.status !== 410) {
      throw new SirrError(res.status, "check failed");
    }

    const readsRemainingRaw = res.headers.get("X-Sirr-Reads-Remaining");
    const readsRemaining: number | "unlimited" =
      readsRemainingRaw === "unlimited" ? "unlimited" : Number(readsRemainingRaw ?? 0);

    const expiresAtRaw = res.headers.get("X-Sirr-Expires-At");

    return {
      status: (res.headers.get("X-Sirr-Status") ?? "active") as "active" | "sealed",
      readCount: Number(res.headers.get("X-Sirr-Read-Count") ?? 0),
      readsRemaining,
      burnOnRead: res.headers.get("X-Sirr-Delete") === "true",
      createdAt: Number(res.headers.get("X-Sirr-Created-At") ?? 0),
      expiresAt: expiresAtRaw ? Number(expiresAtRaw) : null,
    };
  }

  /**
   * Retrieve all secrets and return them as a `key → value` map.
   * Each `get()` call increments the respective read counter.
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

  /**
   * Inject all vault secrets as `process.env` variables for the duration of
   * `fn`, then restore the original values (even if `fn` throws).
   *
   * @example
   * await sirr.withSecrets(async () => {
   *   await execa('python', ['agent.py'])
   * })
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

  /** Trigger an immediate sweep of expired secrets on the server. Returns the pruned count. */
  async prune(): Promise<number> {
    const data = await this.request<{ pruned: number }>("POST", this.prunePath());
    return data.pruned;
  }

  // ── Audit log ───────────────────────────────────────────────────────────────

  /**
   * Query the audit log.
   *
   * @example
   * const events = await sirr.audit({ action: 'secret.read', limit: 50 })
   */
  async audit(opts: AuditFilter = {}): Promise<AuditEvent[]> {
    const params = new URLSearchParams();
    if (opts.since != null) params.set("since", String(opts.since));
    if (opts.until != null) params.set("until", String(opts.until));
    if (opts.action != null) params.set("action", opts.action);
    if (opts.limit != null) params.set("limit", String(opts.limit));
    const qs = params.toString();
    const data = await this.request<{ events: AuditEvent[] }>(
      "GET",
      `${this.auditPath()}${qs ? `?${qs}` : ""}`,
    );
    return data.events;
  }

  /** @deprecated Use `audit()`. */
  async getAuditLog(opts: AuditFilter = {}): Promise<AuditEvent[]> {
    return this.audit(opts);
  }

  // ── Webhooks ─────────────────────────────────────────────────────────────────
  // Also available as `sirr.webhooks.create/list/delete`.

  /** Register a webhook. Returns the ID and signing secret (shown once). */
  async createWebhook(url: string, opts?: { events?: string[] }): Promise<WebhookCreateResult> {
    const body: Record<string, unknown> = { url };
    if (opts?.events) body.events = opts.events;
    return this.request<WebhookCreateResult>("POST", this.webhooksPath(), body);
  }

  /** List all registered webhooks. Signing secrets are redacted. */
  async listWebhooks(): Promise<Webhook[]> {
    const data = await this.request<{ webhooks: Webhook[] }>("GET", this.webhooksPath());
    return data.webhooks;
  }

  /** Delete a webhook by ID. Returns `false` if not found. */
  async deleteWebhook(id: string): Promise<boolean> {
    try {
      await this.request("DELETE", this.webhooksPath(id));
      return true;
    } catch (e) {
      if (e instanceof SirrError && e.status === 404) return false;
      throw e;
    }
  }

  // ── /me ──────────────────────────────────────────────────────────────────────

  /** Get the current principal's profile, role, and key list. */
  async me(): Promise<MeResponse> {
    return this.request<MeResponse>("GET", "/me");
  }

  /** Update the current principal's metadata. */
  async updateMe(opts: PatchMeOptions): Promise<Principal> {
    return this.request<Principal>("PATCH", "/me", opts);
  }

  /**
   * Create a new API key for the current principal.
   * The raw key is returned once — save it immediately.
   */
  async createKey(opts: CreateKeyOptions): Promise<PrincipalKeyCreateResult> {
    return this.request<PrincipalKeyCreateResult>("POST", "/me/keys", opts);
  }

  /** Revoke one of the current principal's keys. Returns `false` if not found. */
  async deleteKey(keyId: string): Promise<boolean> {
    try {
      await this.request("DELETE", `/me/keys/${encodeURIComponent(keyId)}`);
      return true;
    } catch (e) {
      if (e instanceof SirrError && e.status === 404) return false;
      throw e;
    }
  }

  // ── Admin endpoints (master key only) ────────────────────────────────────────
  // Also available as `sirr.orgs.*` and `sirr.principals.*`.

  /** Create an org. Requires master key. */
  async createOrg(opts: CreateOrgOptions): Promise<Org> {
    return this.request<Org>("POST", "/orgs", opts);
  }

  /** List all orgs. Requires master key. */
  async listOrgs(): Promise<Org[]> {
    const data = await this.request<{ orgs: Org[] }>("GET", "/orgs");
    return data.orgs;
  }

  /** Delete an org by ID. Requires master key. */
  async deleteOrg(orgId: string): Promise<void> {
    await this.request("DELETE", `/orgs/${encodeURIComponent(orgId)}`);
  }

  /** Create a principal within an org. Requires master key. */
  async createPrincipal(orgId: string, opts: CreatePrincipalOptions): Promise<Principal> {
    return this.request<Principal>("POST", `/orgs/${encodeURIComponent(orgId)}/principals`, opts);
  }

  /** List all principals in an org. Requires master key. */
  async listPrincipals(orgId: string): Promise<Principal[]> {
    const data = await this.request<{ principals: Principal[] }>(
      "GET",
      `/orgs/${encodeURIComponent(orgId)}/principals`,
    );
    return data.principals;
  }

  /** Delete a principal by ID. Requires master key. */
  async deletePrincipal(orgId: string, principalId: string): Promise<void> {
    await this.request(
      "DELETE",
      `/orgs/${encodeURIComponent(orgId)}/principals/${encodeURIComponent(principalId)}`,
    );
  }

  /** Create a custom role within an org. Requires master key. */
  async createRole(orgId: string, opts: CreateRoleOptions): Promise<Role> {
    return this.request<Role>("POST", `/orgs/${encodeURIComponent(orgId)}/roles`, opts);
  }

  /** List all roles (built-in and custom) in an org. Requires master key. */
  async listRoles(orgId: string): Promise<Role[]> {
    const data = await this.request<{ roles: Role[] }>(
      "GET",
      `/orgs/${encodeURIComponent(orgId)}/roles`,
    );
    return data.roles;
  }

  /** Delete a custom role by name. Requires master key. */
  async deleteRole(orgId: string, roleName: string): Promise<void> {
    await this.request(
      "DELETE",
      `/orgs/${encodeURIComponent(orgId)}/roles/${encodeURIComponent(roleName)}`,
    );
  }
}
