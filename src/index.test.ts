import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import {
  type AuditResponse,
  type SecretMetadata,
  type SecretResponse,
  SirrClient,
  SirrError,
} from "./index";

const mockFetch = jest.fn<typeof fetch>();
global.fetch = mockFetch;

// ── Response helpers ─────────────────────────────────────────

function json(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

function noContent(): Response {
  return {
    ok: true,
    status: 204,
    headers: new Headers(),
    json: () => Promise.reject(new Error("no body")),
    text: () => Promise.resolve(""),
  } as unknown as Response;
}

function headResponse(status: number, headers: Record<string, string>): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: () => Promise.reject(new Error("HEAD has no body")),
    text: () => Promise.resolve(""),
  } as unknown as Response;
}

function errHtml(status: number, html: string): Response {
  return {
    ok: false,
    status,
    headers: new Headers(),
    json: () => Promise.reject(new SyntaxError("Unexpected token <")),
    text: () => Promise.resolve(html),
  } as unknown as Response;
}

const BASE = "http://localhost:7843";

beforeEach(() => {
  mockFetch.mockReset();
});

// ── SirrError ──────────────────────────────────────────────

describe("SirrError", () => {
  it("is exported and instanceof works", () => {
    const e = new SirrError(500, "boom");
    expect(e).toBeInstanceOf(SirrError);
    expect(e).toBeInstanceOf(Error);
  });

  it("has correct status, message, and name", () => {
    const e = new SirrError(403, "forbidden");
    expect(e.status).toBe(403);
    expect(e.message).toBe("Sirr API error 403: forbidden");
    expect(e.name).toBe("SirrError");
  });
});

// ── Constructor ────────────────────────────────────────────

describe("constructor", () => {
  it("allows empty key for anonymous operations", () => {
    expect(() => new SirrClient({ key: "" })).not.toThrow();
    expect(() => new SirrClient({})).not.toThrow();
    expect(() => new SirrClient()).not.toThrow();
  });

  it("strips trailing slash from server", async () => {
    const c = new SirrClient({ server: "http://example.com/" });
    mockFetch.mockResolvedValueOnce(json(201, { hash: "abc", url: "u", owned: false }));
    await c.push("v");
    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toBe("http://example.com/secret");
  });

  it("uses default server when not provided", () => {
    const c = new SirrClient({ key: "t" });
    expect(c).toBeInstanceOf(SirrClient);
  });
});

// ── Authorization header ──────────────────────────────────

describe("authorization header", () => {
  it("sends Bearer token when key is set", async () => {
    const c = new SirrClient({ server: BASE, key: "my-token" });
    mockFetch.mockResolvedValueOnce(json(201, { hash: "h", url: "u", owned: true }));
    await c.push("val");
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer my-token");
  });

  it("omits Authorization when no key", async () => {
    const c = new SirrClient({ server: BASE });
    mockFetch.mockResolvedValueOnce(json(201, { hash: "h", url: "u", owned: false }));
    await c.push("val");
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });
});

// ── POST /secret (push) ──────────────────────────────────

describe("push", () => {
  const sirr = new SirrClient({ server: BASE });

  it("creates anonymous secret", async () => {
    const resp: SecretResponse = {
      hash: "abc123",
      url: `${BASE}/secret/abc123`,
      expires_at: null,
      reads_remaining: null,
      owned: false,
    };
    mockFetch.mockResolvedValueOnce(json(201, resp));

    const result = await sirr.push("hello");
    expect(result.hash).toBe("abc123");
    expect(result.owned).toBe(false);

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/secret`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ value: "hello" });
  });

  it("sends ttl_seconds and reads when provided", async () => {
    mockFetch.mockResolvedValueOnce(
      json(201, {
        hash: "h",
        url: "u",
        expires_at: 1700003600,
        reads_remaining: 3,
        owned: false,
      }),
    );
    const result = await sirr.push("val", { ttl_seconds: 3600, reads: 3 });
    const body = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.ttl_seconds).toBe(3600);
    expect(body.reads).toBe(3);
    expect(result.expires_at).toBe(1700003600);
    expect(result.reads_remaining).toBe(3);
  });

  it("sends prefix when provided", async () => {
    mockFetch.mockResolvedValueOnce(json(201, { hash: "db-abc", url: "u", owned: false }));
    await sirr.push("val", { prefix: "db-" });
    const body = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.prefix).toBe("db-");
  });

  it("keyed push returns owned: true", async () => {
    const c = new SirrClient({ server: BASE, key: "tok" });
    mockFetch.mockResolvedValueOnce(json(201, { hash: "h", url: "u", owned: true }));
    const result = await c.push("val");
    expect(result.owned).toBe(true);
  });

  it("throws SirrError on 401 (private mode, no key)", async () => {
    mockFetch.mockResolvedValueOnce(json(401, { error: "authentication required" }));
    try {
      await sirr.push("val");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(SirrError);
      expect((e as SirrError).status).toBe(401);
    }
  });

  it("throws SirrError on 400 (bad prefix)", async () => {
    mockFetch.mockResolvedValueOnce(json(400, { error: "prefix must match [a-z0-9_-]{1,16}" }));
    await expect(sirr.push("val", { prefix: "BAD!" })).rejects.toThrow(SirrError);
  });

  it("throws SirrError on 503 (visibility=none)", async () => {
    mockFetch.mockResolvedValueOnce(
      json(503, { error: "server is in lockdown mode (visibility=none)" }),
    );
    try {
      await sirr.push("val");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(SirrError);
      expect((e as SirrError).status).toBe(503);
    }
  });
});

// ── GET /secret/{hash} (get) ─────────────────────────────

describe("get", () => {
  const sirr = new SirrClient({ server: BASE });

  it("returns the secret value", async () => {
    mockFetch.mockResolvedValueOnce(json(200, { value: "my-secret" }));
    const val = await sirr.get("abc123");
    expect(val).toBe("my-secret");

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/secret/abc123`);
    expect(init.method).toBe("GET");
  });

  it("sends Accept: application/json", async () => {
    mockFetch.mockResolvedValueOnce(json(200, { value: "v" }));
    await sirr.get("h");
    const headers = (mockFetch.mock.calls[0] as [string, RequestInit])[1].headers as Record<
      string,
      string
    >;
    expect(headers.Accept).toBe("application/json");
  });

  it("returns null on 410 (burned/expired/missing)", async () => {
    mockFetch.mockResolvedValueOnce(json(410, { error: "secret is gone" }));
    const val = await sirr.get("gone-hash");
    expect(val).toBeNull();
  });

  it("throws on empty hash", async () => {
    await expect(sirr.get("")).rejects.toThrow("hash must not be empty");
  });

  it("throws SirrError on other errors", async () => {
    mockFetch.mockResolvedValueOnce(json(500, { error: "internal" }));
    await expect(sirr.get("h")).rejects.toThrow(SirrError);
  });
});

// ── HEAD /secret/{hash} (inspect) ────────────────────────

describe("inspect", () => {
  const sirr = new SirrClient({ server: BASE });

  it("returns metadata from headers", async () => {
    mockFetch.mockResolvedValueOnce(
      headResponse(200, {
        "x-sirr-created": "2024-01-15T10:00:00Z",
        "x-sirr-ttl-expires": "2024-01-15T11:00:00Z",
        "x-sirr-reads-remaining": "5",
        "x-sirr-owned": "false",
      }),
    );
    const status = await sirr.inspect("abc");
    expect(status).toEqual({
      created: "2024-01-15T10:00:00Z",
      ttlExpires: "2024-01-15T11:00:00Z",
      readsRemaining: 5,
      owned: false,
    });

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/secret/abc`);
    expect(init.method).toBe("HEAD");
  });

  it("returns null for reads_remaining when header absent", async () => {
    mockFetch.mockResolvedValueOnce(
      headResponse(200, {
        "x-sirr-created": "2024-01-15T10:00:00Z",
        "x-sirr-owned": "true",
      }),
    );
    const status = await sirr.inspect("h");
    expect(status?.readsRemaining).toBeNull();
    expect(status?.ttlExpires).toBeNull();
    expect(status?.owned).toBe(true);
  });

  it("returns null on 410", async () => {
    mockFetch.mockResolvedValueOnce(headResponse(410, {}));
    const status = await sirr.inspect("gone");
    expect(status).toBeNull();
  });

  it("does not consume a read (method is HEAD)", async () => {
    mockFetch.mockResolvedValueOnce(
      headResponse(200, {
        "x-sirr-created": "t",
        "x-sirr-owned": "false",
      }),
    );
    await sirr.inspect("h");
    const init = (mockFetch.mock.calls[0] as [string, RequestInit])[1];
    expect(init.method).toBe("HEAD");
  });

  it("throws on empty hash", async () => {
    await expect(sirr.inspect("")).rejects.toThrow("hash must not be empty");
  });
});

// ── PATCH /secret/{hash} (patch) ─────────────────────────

describe("patch", () => {
  const sirr = new SirrClient({ server: BASE, key: "owner-key" });

  it("updates value and returns updated metadata", async () => {
    const resp: SecretResponse = {
      hash: "abc",
      url: `${BASE}/secret/abc`,
      expires_at: null,
      reads_remaining: null,
      owned: true,
    };
    mockFetch.mockResolvedValueOnce(json(200, resp));
    const result = await sirr.patch("abc", { value: "updated" });
    expect(result.hash).toBe("abc");

    const body = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.value).toBe("updated");
  });

  it("sends ttl_seconds and reads when provided", async () => {
    mockFetch.mockResolvedValueOnce(
      json(200, {
        hash: "h",
        url: "u",
        expires_at: 99,
        reads_remaining: 2,
        owned: true,
      }),
    );
    await sirr.patch("h", { value: "v", ttl_seconds: 9999, reads: 2 });
    const body = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.ttl_seconds).toBe(9999);
    expect(body.reads).toBe(2);
  });

  it("throws SirrError(401) when no auth on keyed secret", async () => {
    const anon = new SirrClient({ server: BASE });
    mockFetch.mockResolvedValueOnce(json(401, { error: "authentication required" }));
    try {
      await anon.patch("h", { value: "nope" });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(SirrError);
      expect((e as SirrError).status).toBe(401);
    }
  });

  it("throws SirrError(405) when anonymous caller patches anonymous secret", async () => {
    const anon = new SirrClient({ server: BASE });
    mockFetch.mockResolvedValueOnce(json(405, { error: "method not allowed" }));
    try {
      await anon.patch("anon-hash", { value: "nope" });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(SirrError);
      expect((e as SirrError).status).toBe(405);
    }
  });

  it("throws SirrError(404) when wrong key", async () => {
    mockFetch.mockResolvedValueOnce(json(404, { error: "not found" }));
    try {
      await sirr.patch("not-mine", { value: "hack" });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(SirrError);
      expect((e as SirrError).status).toBe(404);
    }
  });

  it("throws SirrError(410) when secret is burned", async () => {
    mockFetch.mockResolvedValueOnce(json(410, { error: "secret is gone" }));
    try {
      await sirr.patch("burned", { value: "too-late" });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(SirrError);
      expect((e as SirrError).status).toBe(410);
    }
  });

  it("throws on empty hash", async () => {
    await expect(sirr.patch("", { value: "v" })).rejects.toThrow("hash must not be empty");
  });
});

// ── DELETE /secret/{hash} (burn) ─────────────────────────

describe("burn", () => {
  const sirr = new SirrClient({ server: BASE });

  it("burns anonymous secret (204)", async () => {
    mockFetch.mockResolvedValueOnce(noContent());
    await expect(sirr.burn("anon-hash")).resolves.toBeUndefined();

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/secret/anon-hash`);
    expect(init.method).toBe("DELETE");
  });

  it("owner can burn keyed secret", async () => {
    const keyed = new SirrClient({ server: BASE, key: "tok" });
    mockFetch.mockResolvedValueOnce(noContent());
    await expect(keyed.burn("owned-hash")).resolves.toBeUndefined();
  });

  it("throws SirrError(401) when no auth on keyed secret", async () => {
    mockFetch.mockResolvedValueOnce(json(401, { error: "authentication required" }));
    try {
      await sirr.burn("keyed-hash");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(SirrError);
      expect((e as SirrError).status).toBe(401);
    }
  });

  it("throws SirrError(410) on already burned", async () => {
    mockFetch.mockResolvedValueOnce(json(410, { error: "secret is gone" }));
    try {
      await sirr.burn("already-burned");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(SirrError);
      expect((e as SirrError).status).toBe(410);
    }
  });

  it("throws SirrError(404) when not found", async () => {
    mockFetch.mockResolvedValueOnce(json(404, { error: "not found" }));
    try {
      await sirr.burn("missing");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(SirrError);
      expect((e as SirrError).status).toBe(404);
    }
  });

  it("throws on empty hash", async () => {
    await expect(sirr.burn("")).rejects.toThrow("hash must not be empty");
  });
});

// ── GET /secret/{hash}/audit (audit) ─────────────────────

describe("audit", () => {
  const sirr = new SirrClient({ server: BASE, key: "owner-key" });

  it("returns audit response with events", async () => {
    const resp: AuditResponse = {
      hash: "abc",
      created_at: 1700000000,
      events: [
        { type: "secret.create", at: 1700000000, ip: "" },
        { type: "secret.read", at: 1700001234, ip: "" },
      ],
    };
    mockFetch.mockResolvedValueOnce(json(200, resp));
    const result = await sirr.audit("abc");
    expect(result.hash).toBe("abc");
    expect(result.events).toHaveLength(2);
    expect(result.events[0].type).toBe("secret.create");
    expect(result.events[1].type).toBe("secret.read");
  });

  it("throws SirrError(401) when no auth", async () => {
    const anon = new SirrClient({ server: BASE });
    mockFetch.mockResolvedValueOnce(json(401, { error: "authentication required" }));
    try {
      await anon.audit("h");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(SirrError);
      expect((e as SirrError).status).toBe(401);
    }
  });

  it("throws SirrError(404) for anonymous secret audit", async () => {
    mockFetch.mockResolvedValueOnce(json(404, { error: "not found" }));
    try {
      await sirr.audit("anon");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(SirrError);
      expect((e as SirrError).status).toBe(404);
    }
  });

  it("throws SirrError(404) for wrong key", async () => {
    mockFetch.mockResolvedValueOnce(json(404, { error: "not found" }));
    try {
      await sirr.audit("not-mine");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(SirrError);
      expect((e as SirrError).status).toBe(404);
    }
  });

  it("throws on empty hash", async () => {
    await expect(sirr.audit("")).rejects.toThrow("hash must not be empty");
  });
});

// ── GET /secrets (list) ──────────────────────────────────

describe("list", () => {
  it("returns array of secret metadata", async () => {
    const keyed = new SirrClient({ server: BASE, key: "tok" });
    const items: SecretMetadata[] = [
      {
        hash: "h1",
        created_at: 1700000000,
        ttl_expires_at: null,
        reads_remaining: null,
        burned: false,
        burned_at: null,
        owned: true,
      },
      {
        hash: "h2",
        created_at: 1700000001,
        ttl_expires_at: 1700009999,
        reads_remaining: 3,
        burned: false,
        burned_at: null,
        owned: true,
      },
    ];
    mockFetch.mockResolvedValueOnce(json(200, items));
    const result = await keyed.list();
    expect(result).toHaveLength(2);
    expect(result[0].hash).toBe("h1");
    expect(result[1].reads_remaining).toBe(3);
  });

  it("throws SirrError(401) when anonymous", async () => {
    const anon = new SirrClient({ server: BASE });
    mockFetch.mockResolvedValueOnce(json(401, { error: "authentication required" }));
    try {
      await anon.list();
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(SirrError);
      expect((e as SirrError).status).toBe(401);
    }
  });
});

// ── Health & Version ─────────────────────────────────────

describe("health", () => {
  const sirr = new SirrClient({ server: BASE });

  it("returns status on success", async () => {
    mockFetch.mockResolvedValueOnce(json(200, { status: "ok" }));
    const result = await sirr.health();
    expect(result.status).toBe("ok");
  });

  it("does not send auth header", async () => {
    const c = new SirrClient({ server: BASE, key: "secret-key" });
    mockFetch.mockResolvedValueOnce(json(200, { status: "ok" }));
    await c.health();
    // health() calls fetch() directly without RequestInit headers
    const callArgs = mockFetch.mock.calls[0] as unknown[];
    // If second arg exists, it should not have Authorization
    const init = callArgs[1] as RequestInit | undefined;
    if (init?.headers) {
      const h = init.headers as Record<string, string>;
      expect(h.Authorization).toBeUndefined();
    }
  });

  it("throws SirrError on failure", async () => {
    mockFetch.mockResolvedValueOnce(json(500, {}));
    await expect(sirr.health()).rejects.toThrow(SirrError);
  });
});

describe("version", () => {
  const sirr = new SirrClient({ server: BASE });

  it("returns version on success", async () => {
    mockFetch.mockResolvedValueOnce(json(200, { version: "1.0.42" }));
    const result = await sirr.version();
    expect(result.version).toBe("1.0.42");
  });

  it("throws SirrError on failure", async () => {
    mockFetch.mockResolvedValueOnce(json(500, {}));
    await expect(sirr.version()).rejects.toThrow(SirrError);
  });
});

// ── Error resilience ──────────────────────────────────────

describe("error resilience", () => {
  const sirr = new SirrClient({ server: BASE });

  it("handles HTML error pages (nginx 502 etc)", async () => {
    mockFetch.mockResolvedValueOnce(errHtml(502, "<html><body>502 Bad Gateway</body></html>"));
    try {
      await sirr.push("val");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(SirrError);
      expect((e as SirrError).status).toBe(502);
      expect((e as SirrError).message).toContain("502 Bad Gateway");
    }
  });

  it("handles empty error body gracefully", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      headers: new Headers(),
      json: () => Promise.reject(new Error("empty")),
      text: () => Promise.reject(new Error("empty")),
    } as unknown as Response);
    try {
      await sirr.push("val");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(SirrError);
      expect((e as SirrError).status).toBe(500);
    }
  });
});
