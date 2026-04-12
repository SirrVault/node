/**
 * @sirrlock/node — Sirr Node.js client
 *
 * Zero-dependency TypeScript client for the Sirr HTTP API.
 * Works in Node 18+, Deno, Bun, and edge runtimes.
 */

// ── Constructor options ───────────────────────────────────────────────────────

export interface SirrClientOptions {
  /** Sirr server base URL. Default: https://sirrlock.com */
  server?: string;
  /** Bearer API key for authenticated operations. Omit for anonymous push/get. */
  key?: string;
}

// ── Request options ──────────────────────────────────────────────────────────

export interface PushOptions {
  /** Time-to-live in seconds. Omit for no expiration. */
  ttl_seconds?: number;
  /** Maximum reads before the secret is burned. */
  reads?: number;
  /** Short prefix prepended to the hash. Must match [a-z0-9_-]{1,16}. */
  prefix?: string;
}

export interface PatchOptions {
  /** New value to store. */
  value?: string;
  /** New TTL in seconds from now (resets the expiry clock). */
  ttl_seconds?: number;
  /** New maximum read count (resets the counter). */
  reads?: number;
}

// ── Response types ───────────────────────────────────────────────────────────

/** Response from POST /secret and PATCH /secret/{hash}. */
export interface SecretResponse {
  hash: string;
  url: string;
  expires_at: number | null;
  reads_remaining: number | null;
  owned: boolean;
}

/** Metadata returned by HEAD /secret/{hash}. Does not consume a read. */
export interface SecretStatus {
  created: string | null;
  ttlExpires: string | null;
  readsRemaining: number | null;
  owned: boolean;
}

/** Single audit event from GET /secret/{hash}/audit. */
export interface AuditEvent {
  type: string;
  at: number;
  ip: string;
}

/** Response from GET /secret/{hash}/audit. */
export interface AuditResponse {
  hash: string;
  created_at: number;
  events: AuditEvent[];
}

/** Metadata for a secret from GET /secrets. */
export interface SecretMetadata {
  hash: string;
  created_at: number;
  ttl_expires_at: number | null;
  reads_remaining: number | null;
  burned: boolean;
  burned_at: number | null;
  owned: boolean;
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

// ── Client ────────────────────────────────────────────────────────────────────

export class SirrClient {
  private readonly server: string;
  private readonly key: string;

  constructor(opts: SirrClientOptions = {}) {
    this.server = (opts.server ?? "https://sirrlock.com").replace(/\/$/, "");
    this.key = opts.key ?? "";
  }

  // ── HTTP helpers ──────────────────────────────────────────────────────────

  private headers(accept?: string): Record<string, string> {
    const h: Record<string, string> = {};
    if (accept) h.Accept = accept;
    if (this.key) h.Authorization = `Bearer ${this.key}`;
    return h;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; ok: boolean; data: T }> {
    const headers: Record<string, string> = {
      ...this.headers("application/json"),
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";

    const res = await fetch(`${this.server}${path}`, {
      method,
      headers,
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
          // body already consumed or unreadable
        }
      }
      throw new SirrError(res.status, message);
    }

    if (res.status === 204) {
      return { status: res.status, ok: true, data: undefined as T };
    }

    const data = (await res.json()) as T;
    return { status: res.status, ok: true, data };
  }

  // ── Health & Version ──────────────────────────────────────────────────────

  /** Check server health. Does not require authentication. */
  async health(): Promise<{ status: string }> {
    const res = await fetch(`${this.server}/health`);
    if (!res.ok) throw new SirrError(res.status, "health check failed");
    return res.json() as Promise<{ status: string }>;
  }

  // ── Secrets ───────────────────────────────────────────────────────────────

  /** Create a secret. Returns metadata including the hash. */
  async push(value: string, opts: PushOptions = {}): Promise<SecretResponse> {
    const body: Record<string, unknown> = { value };
    if (opts.ttl_seconds != null) body.ttl_seconds = opts.ttl_seconds;
    if (opts.reads != null) body.reads = opts.reads;
    if (opts.prefix != null) body.prefix = opts.prefix;
    const { data } = await this.request<SecretResponse>("POST", "/secret", body);
    return data;
  }

  /** Read a secret's value. Consumes a read. Returns null if burned/expired. */
  async get(hash: string): Promise<string | null> {
    if (!hash) throw new Error("hash must not be empty");
    try {
      const { data } = await this.request<{ value: string }>(
        "GET",
        `/secret/${encodeURIComponent(hash)}`,
      );
      return data.value;
    } catch (e) {
      if (e instanceof SirrError && e.status === 410) return null;
      throw e;
    }
  }

  /** Inspect a secret's metadata via HEAD without consuming a read. */
  async inspect(hash: string): Promise<SecretStatus | null> {
    if (!hash) throw new Error("hash must not be empty");
    const res = await fetch(`${this.server}/secret/${encodeURIComponent(hash)}`, {
      method: "HEAD",
      headers: this.headers(),
    });

    if (res.status === 410) return null;
    if (!res.ok) throw new SirrError(res.status, "inspect failed");

    const h = res.headers;
    const readsRaw = h.get("x-sirr-reads-remaining");

    return {
      created: h.get("x-sirr-created") ?? null,
      ttlExpires: h.get("x-sirr-ttl-expires") ?? null,
      readsRemaining: readsRaw != null ? Number(readsRaw) : null,
      owned: h.get("x-sirr-owned") === "true",
    };
  }

  /** Update an existing secret (owner key required). */
  async patch(hash: string, opts: PatchOptions): Promise<SecretResponse> {
    if (!hash) throw new Error("hash must not be empty");
    const { data } = await this.request<SecretResponse>(
      "PATCH",
      `/secret/${encodeURIComponent(hash)}`,
      opts,
    );
    return data;
  }

  /** Burn a secret immediately (DELETE). */
  async burn(hash: string): Promise<void> {
    if (!hash) throw new Error("hash must not be empty");
    await this.request("DELETE", `/secret/${encodeURIComponent(hash)}`);
  }

  /** Get the audit trail for a secret (owner key required). */
  async audit(hash: string): Promise<AuditResponse> {
    if (!hash) throw new Error("hash must not be empty");
    const { data } = await this.request<AuditResponse>(
      "GET",
      `/secret/${encodeURIComponent(hash)}/audit`,
    );
    return data;
  }

  /** List all secrets owned by the calling key. */
  async list(): Promise<SecretMetadata[]> {
    const { data } = await this.request<SecretMetadata[]>("GET", "/secrets");
    return data;
  }

  /** Helper: list all owned secrets and fetch their values. Note: consumes a read for each. */
  async pullAll(): Promise<Record<string, string>> {
    const metas = await this.list();
    const result: Record<string, string> = {};
    for (const meta of metas) {
      if (!meta.burned) {
        const val = await this.get(meta.hash);
        if (val !== null) result[meta.hash] = val;
      }
    }
    return result;
  }
}
