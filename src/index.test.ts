import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { SirrClient, SirrError } from "./index";

const mockFetch = jest.fn<typeof fetch>();
global.fetch = mockFetch;

function ok(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function err(status: number, body: unknown): Response {
  return {
    ok: false,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function errHtml(status: number, html: string): Response {
  return {
    ok: false,
    status,
    json: () => Promise.reject(new SyntaxError("Unexpected token <")),
    text: () => Promise.resolve(html),
  } as unknown as Response;
}

const sirr = new SirrClient({ server: "http://localhost:39999", token: "test" });

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

// ── Constructor validation ─────────────────────────────────

describe("constructor", () => {
  it("throws on empty token", () => {
    expect(() => new SirrClient({ token: "" })).toThrow("non-empty token");
  });

  it("uses default server when not provided", () => {
    const c = new SirrClient({ token: "t" });
    // We can't inspect private fields, but pushing should use the default
    expect(c).toBeInstanceOf(SirrClient);
  });

  it("strips trailing slash from server", async () => {
    const c = new SirrClient({ server: "http://example.com/", token: "t" });
    mockFetch.mockResolvedValueOnce(ok({ key: "X" }));
    await c.push("X", "v");
    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toBe("http://example.com/secrets");
  });
});

// ── Key validation ─────────────────────────────────────────

describe("key validation", () => {
  it("push throws on empty key", async () => {
    await expect(sirr.push("", "val")).rejects.toThrow("key must not be empty");
  });

  it("get throws on empty key", async () => {
    await expect(sirr.get("")).rejects.toThrow("key must not be empty");
  });

  it("delete throws on empty key", async () => {
    await expect(sirr.delete("")).rejects.toThrow("key must not be empty");
  });
});

// ── Authorization header ───────────────────────────────────

describe("authorization header", () => {
  it("sends Bearer token on authenticated requests", async () => {
    mockFetch.mockResolvedValueOnce(ok({ secrets: [] }));
    await sirr.list();
    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((opts.headers as Record<string, string>).Authorization).toBe("Bearer test");
  });

  it("does NOT send auth header on health()", async () => {
    mockFetch.mockResolvedValueOnce(ok({ status: "ok" }));
    await sirr.health();
    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit | undefined];
    expect(opts?.headers).toBeUndefined();
  });
});

// ── health ─────────────────────────────────────────────────

describe("health", () => {
  it("returns status", async () => {
    mockFetch.mockResolvedValueOnce(ok({ status: "ok" }));
    expect(await sirr.health()).toEqual({ status: "ok" });
  });

  it("throws SirrError on non-2xx", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 } as Response);
    await expect(sirr.health()).rejects.toThrow(SirrError);
  });
});

// ── push ───────────────────────────────────────────────────

describe("push", () => {
  it("sends POST /secrets with correct body", async () => {
    mockFetch.mockResolvedValueOnce(ok({ key: "FOO" }));
    await sirr.push("FOO", "bar", { ttl: 60, reads: 1 });

    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:39999/secrets");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body as string)).toEqual({
      key: "FOO",
      value: "bar",
      ttl_seconds: 60,
      max_reads: 1,
    });
  });

  it("sends null for omitted ttl and reads", async () => {
    mockFetch.mockResolvedValueOnce(ok({ key: "FOO" }));
    await sirr.push("FOO", "bar");
    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(opts.body as string)).toMatchObject({
      ttl_seconds: null,
      max_reads: null,
    });
  });
});

// ── get ────────────────────────────────────────────────────

describe("get", () => {
  it("returns value on 200", async () => {
    mockFetch.mockResolvedValueOnce(ok({ key: "FOO", value: "bar" }));
    expect(await sirr.get("FOO")).toBe("bar");
  });

  it("returns null on 404", async () => {
    mockFetch.mockResolvedValueOnce(err(404, { error: "not found" }));
    expect(await sirr.get("FOO")).toBeNull();
  });

  it("returns null on 410 Gone (sealed secret)", async () => {
    mockFetch.mockResolvedValueOnce(err(410, { error: "gone" }));
    expect(await sirr.get("FOO")).toBeNull();
  });

  it("throws on non-404 errors", async () => {
    mockFetch.mockResolvedValueOnce(err(500, { error: "server error" }));
    await expect(sirr.get("FOO")).rejects.toThrow("500");
  });

  it("URL-encodes the key", async () => {
    mockFetch.mockResolvedValueOnce(ok({ key: "A B", value: "v" }));
    await sirr.get("A B");
    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain("A%20B");
  });
});

// ── list ───────────────────────────────────────────────────

describe("list", () => {
  it("returns secret metadata array", async () => {
    const meta = [
      {
        key: "FOO",
        created_at: 1,
        expires_at: null,
        max_reads: null,
        read_count: 0,
      },
    ];
    mockFetch.mockResolvedValueOnce(ok({ secrets: meta }));
    expect(await sirr.list()).toEqual(meta);
  });
});

// ── delete ─────────────────────────────────────────────────

describe("delete", () => {
  it("returns true when secret existed", async () => {
    mockFetch.mockResolvedValueOnce(ok({ deleted: true }));
    expect(await sirr.delete("FOO")).toBe(true);
  });

  it("returns false on 404", async () => {
    mockFetch.mockResolvedValueOnce(err(404, { error: "not found" }));
    expect(await sirr.delete("FOO")).toBe(false);
  });
});

// ── prune ──────────────────────────────────────────────────

describe("prune", () => {
  it("returns pruned count", async () => {
    mockFetch.mockResolvedValueOnce(ok({ pruned: 3 }));
    expect(await sirr.prune()).toBe(3);
  });
});

// ── pullAll ────────────────────────────────────────────────

describe("pullAll", () => {
  it("lists then fetches each value", async () => {
    mockFetch
      .mockResolvedValueOnce(
        ok({
          secrets: [
            { key: "A", created_at: 0, expires_at: null, max_reads: null, read_count: 0 },
            { key: "B", created_at: 0, expires_at: null, max_reads: null, read_count: 0 },
          ],
        }),
      )
      .mockResolvedValueOnce(ok({ key: "A", value: "1" }))
      .mockResolvedValueOnce(ok({ key: "B", value: "2" }));

    const result = await sirr.pullAll();
    expect(result).toEqual({ A: "1", B: "2" });
  });
});

// ── withSecrets ────────────────────────────────────────────

describe("withSecrets", () => {
  it("injects env vars and restores them after", async () => {
    mockFetch
      .mockResolvedValueOnce(
        ok({
          secrets: [
            { key: "INJECTED", created_at: 0, expires_at: null, max_reads: null, read_count: 0 },
          ],
        }),
      )
      .mockResolvedValueOnce(ok({ key: "INJECTED", value: "hello" }));

    delete process.env.INJECTED;
    let inside = "";

    await sirr.withSecrets(async () => {
      inside = process.env.INJECTED ?? "";
    });

    expect(inside).toBe("hello");
    expect(process.env.INJECTED).toBeUndefined();
  });

  it("restores env vars even if fn throws", async () => {
    mockFetch
      .mockResolvedValueOnce(
        ok({
          secrets: [
            { key: "TEMP", created_at: 0, expires_at: null, max_reads: null, read_count: 0 },
          ],
        }),
      )
      .mockResolvedValueOnce(ok({ key: "TEMP", value: "x" }));

    delete process.env.TEMP;
    await expect(
      sirr.withSecrets(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(process.env.TEMP).toBeUndefined();
  });
});

// ── Non-JSON error body (nginx 502 etc.) ───────────────────

describe("request() resilience", () => {
  it("handles HTML error bodies gracefully", async () => {
    mockFetch.mockResolvedValueOnce(errHtml(502, "<html><body>502 Bad Gateway</body></html>"));
    await expect(sirr.list()).rejects.toThrow(SirrError);
    await expect(
      (async () => {
        mockFetch.mockResolvedValueOnce(errHtml(502, "<html><body>502 Bad Gateway</body></html>"));
        try {
          await sirr.list();
        } catch (e) {
          expect((e as SirrError).status).toBe(502);
          expect((e as SirrError).message).toContain("502");
          throw e;
        }
      })(),
    ).rejects.toThrow();
  });

  it("network error propagates", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(sirr.list()).rejects.toThrow("fetch failed");
  });
});

// ── audit / getAuditLog ───────────────────────────────────

describe("audit", () => {
  it("returns audit events array", async () => {
    const events = [
      {
        id: 1,
        timestamp: 1000,
        action: "secret.create",
        key: "K",
        source_ip: "127.0.0.1",
        success: true,
        detail: null,
      },
    ];
    mockFetch.mockResolvedValueOnce(ok({ events }));
    expect(await sirr.audit()).toEqual(events);
  });

  it("sends query params", async () => {
    mockFetch.mockResolvedValueOnce(ok({ events: [] }));
    await sirr.audit({ since: 100, action: "secret.create", limit: 10 });
    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain("since=100");
    expect(url).toContain("action=secret.create");
    expect(url).toContain("limit=10");
  });
});

describe("getAuditLog (deprecated alias)", () => {
  it("delegates to audit()", async () => {
    mockFetch.mockResolvedValueOnce(ok({ events: [] }));
    const result = await sirr.getAuditLog();
    expect(result).toEqual([]);
  });
});

// ── webhooks ──────────────────────────────────────────────

describe("createWebhook", () => {
  it("sends POST /webhooks", async () => {
    mockFetch.mockResolvedValueOnce(ok({ id: "wh_1", secret: "s3cr3t" }));
    const result = await sirr.createWebhook("https://example.com/hook");
    expect(result).toEqual({ id: "wh_1", secret: "s3cr3t" });
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/webhooks");
    expect(opts.method).toBe("POST");
  });
});

describe("listWebhooks", () => {
  it("returns webhook array", async () => {
    const webhooks = [{ id: "wh_1", url: "https://example.com", events: ["*"], created_at: 1000 }];
    mockFetch.mockResolvedValueOnce(ok({ webhooks }));
    expect(await sirr.listWebhooks()).toEqual(webhooks);
  });
});

describe("deleteWebhook", () => {
  it("returns true on success", async () => {
    mockFetch.mockResolvedValueOnce(ok({ deleted: true }));
    expect(await sirr.deleteWebhook("wh_1")).toBe(true);
  });

  it("returns false on 404", async () => {
    mockFetch.mockResolvedValueOnce(err(404, { error: "not found" }));
    expect(await sirr.deleteWebhook("wh_x")).toBe(false);
  });
});

// ── check (HEAD) ──────────────────────────────────────────

function headOk(headers: Record<string, string>): Response {
  return {
    ok: true,
    status: 200,
    headers: {
      get: (k: string) => headers[k] ?? null,
    },
  } as unknown as Response;
}

function headSealed(headers: Record<string, string>): Response {
  return {
    ok: false,
    status: 410,
    headers: {
      get: (k: string) => headers[k] ?? null,
    },
  } as unknown as Response;
}

describe("check", () => {
  const activeHeaders = {
    "X-Sirr-Status": "active",
    "X-Sirr-Read-Count": "2",
    "X-Sirr-Reads-Remaining": "8",
    "X-Sirr-Delete": "true",
    "X-Sirr-Created-At": "1700000000",
    "X-Sirr-Expires-At": "1700086400",
  };

  it("sends HEAD to correct path", async () => {
    mockFetch.mockResolvedValueOnce(headOk(activeHeaders));
    await sirr.check("FOO");
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:39999/secrets/FOO");
    expect(opts.method).toBe("HEAD");
  });

  it("returns SecretStatus on 200", async () => {
    mockFetch.mockResolvedValueOnce(headOk(activeHeaders));
    const result = await sirr.check("FOO");
    expect(result).toEqual({
      status: "active",
      readCount: 2,
      readsRemaining: 8,
      burnOnRead: true,
      createdAt: 1700000000,
      expiresAt: 1700086400,
    });
  });

  it("returns sealed status on 410", async () => {
    mockFetch.mockResolvedValueOnce(
      headSealed({ ...activeHeaders, "X-Sirr-Status": "sealed", "X-Sirr-Reads-Remaining": "0" }),
    );
    const result = await sirr.check("FOO");
    expect(result?.status).toBe("sealed");
    expect(result?.readsRemaining).toBe(0);
  });

  it("returns null on 404", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      headers: { get: () => null },
    } as unknown as Response);
    expect(await sirr.check("GONE")).toBeNull();
  });

  it("handles unlimited reads", async () => {
    mockFetch.mockResolvedValueOnce(
      headOk({ ...activeHeaders, "X-Sirr-Reads-Remaining": "unlimited" }),
    );
    const result = await sirr.check("FOO");
    expect(result?.readsRemaining).toBe("unlimited");
  });

  it("returns null expiresAt when header absent", async () => {
    const { "X-Sirr-Expires-At": _, ...noExpiry } = activeHeaders;
    mockFetch.mockResolvedValueOnce(headOk(noExpiry));
    const result = await sirr.check("FOO");
    expect(result?.expiresAt).toBeNull();
  });

  it("uses org-scoped path", async () => {
    const orgSirr = new SirrClient({
      server: "http://localhost:39999",
      token: "test",
      org: "acme",
    });
    mockFetch.mockResolvedValueOnce(headOk(activeHeaders));
    await orgSirr.check("FOO");
    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toBe("http://localhost:39999/orgs/acme/secrets/FOO");
  });

  it("throws on empty key", async () => {
    await expect(sirr.check("")).rejects.toThrow("key must not be empty");
  });

  it("throws SirrError on unexpected non-2xx", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      headers: { get: () => null },
    } as unknown as Response);
    await expect(sirr.check("FOO")).rejects.toThrow(SirrError);
  });
});

// ── patch ─────────────────────────────────────────────────

describe("patch", () => {
  it("sends PATCH /secrets/{key} with only provided fields", async () => {
    mockFetch.mockResolvedValueOnce(
      ok({ key: "FOO", created_at: 0, expires_at: null, max_reads: null, read_count: 0 }),
    );
    await sirr.patch("FOO", { ttl: 120 });
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:39999/secrets/FOO");
    expect(opts.method).toBe("PATCH");
    expect(JSON.parse(opts.body as string)).toEqual({ ttl_seconds: 120 });
  });

  it("maps value and reads fields correctly", async () => {
    mockFetch.mockResolvedValueOnce(
      ok({ key: "FOO", created_at: 0, expires_at: null, max_reads: 5, read_count: 0 }),
    );
    await sirr.patch("FOO", { value: "newval", reads: 5 });
    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(opts.body as string)).toEqual({ value: "newval", max_reads: 5 });
  });

  it("returns null on 404", async () => {
    mockFetch.mockResolvedValueOnce(err(404, { error: "not found" }));
    expect(await sirr.patch("GONE", { ttl: 60 })).toBeNull();
  });

  it("throws on empty key", async () => {
    await expect(sirr.patch("", { ttl: 60 })).rejects.toThrow("key must not be empty");
  });

  it("uses org-scoped path", async () => {
    const orgSirr = new SirrClient({
      server: "http://localhost:39999",
      token: "test",
      org: "acme",
    });
    mockFetch.mockResolvedValueOnce(
      ok({ key: "FOO", created_at: 0, expires_at: null, max_reads: null, read_count: 0 }),
    );
    await orgSirr.patch("FOO", { ttl: 60 });
    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toBe("http://localhost:39999/orgs/acme/secrets/FOO");
  });
});

// ── Org-scoped path prefix ────────────────────────────────

describe("org-scoped client", () => {
  const orgSirr = new SirrClient({ server: "http://localhost:39999", token: "test", org: "acme" });

  it("push uses /orgs/{org}/secrets path", async () => {
    mockFetch.mockResolvedValueOnce(ok({ key: "FOO" }));
    await orgSirr.push("FOO", "bar");
    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toBe("http://localhost:39999/orgs/acme/secrets");
  });

  it("get uses /orgs/{org}/secrets/{key} path", async () => {
    mockFetch.mockResolvedValueOnce(ok({ key: "FOO", value: "bar" }));
    await orgSirr.get("FOO");
    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toBe("http://localhost:39999/orgs/acme/secrets/FOO");
  });

  it("list uses /orgs/{org}/secrets path", async () => {
    mockFetch.mockResolvedValueOnce(ok({ secrets: [] }));
    await orgSirr.list();
    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toBe("http://localhost:39999/orgs/acme/secrets");
  });

  it("delete uses /orgs/{org}/secrets/{key} path", async () => {
    mockFetch.mockResolvedValueOnce(ok({ deleted: true }));
    await orgSirr.delete("FOO");
    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toBe("http://localhost:39999/orgs/acme/secrets/FOO");
  });

  it("prune uses /orgs/{org}/prune path", async () => {
    mockFetch.mockResolvedValueOnce(ok({ pruned: 0 }));
    await orgSirr.prune();
    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toBe("http://localhost:39999/orgs/acme/prune");
  });

  it("getAuditLog uses /orgs/{org}/audit path", async () => {
    mockFetch.mockResolvedValueOnce(ok({ events: [] }));
    await orgSirr.getAuditLog();
    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toBe("http://localhost:39999/orgs/acme/audit");
  });

  it("createWebhook uses /orgs/{org}/webhooks path", async () => {
    mockFetch.mockResolvedValueOnce(ok({ id: "wh_1", secret: "s" }));
    await orgSirr.createWebhook("https://example.com/hook");
    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toBe("http://localhost:39999/orgs/acme/webhooks");
  });

  it("deleteWebhook uses /orgs/{org}/webhooks/{id} path", async () => {
    mockFetch.mockResolvedValueOnce(ok({ deleted: true }));
    await orgSirr.deleteWebhook("wh_1");
    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toBe("http://localhost:39999/orgs/acme/webhooks/wh_1");
  });
});

describe("non-org client paths", () => {
  it("push uses /secrets path", async () => {
    mockFetch.mockResolvedValueOnce(ok({ key: "FOO" }));
    await sirr.push("FOO", "bar");
    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toBe("http://localhost:39999/secrets");
  });

  it("prune uses /prune path", async () => {
    mockFetch.mockResolvedValueOnce(ok({ pruned: 0 }));
    await sirr.prune();
    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toBe("http://localhost:39999/prune");
  });

  it("getAuditLog uses /audit path", async () => {
    mockFetch.mockResolvedValueOnce(ok({ events: [] }));
    await sirr.getAuditLog();
    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toBe("http://localhost:39999/audit");
  });
});

// ── /me endpoints ─────────────────────────────────────────

describe("me", () => {
  it("sends GET /me", async () => {
    mockFetch.mockResolvedValueOnce(ok({ id: "p_1", name: "alice" }));
    const result = await sirr.me();
    expect(result).toEqual({ id: "p_1", name: "alice" });
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:39999/me");
    expect(opts.method).toBe("GET");
  });
});

describe("updateMe", () => {
  it("sends PATCH /me with metadata body", async () => {
    mockFetch.mockResolvedValueOnce(ok({ id: "p_1", name: "bob" }));
    await sirr.updateMe({ metadata: { team: "platform" } });
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:39999/me");
    expect(opts.method).toBe("PATCH");
    expect(JSON.parse(opts.body as string)).toEqual({ metadata: { team: "platform" } });
  });
});

describe("createKey", () => {
  it("sends POST /me/keys with correct fields", async () => {
    mockFetch.mockResolvedValueOnce(ok({ id: "k_1", key: "sirr_key_abc" }));
    await sirr.createKey({ name: "ci", valid_for_seconds: 86400 });
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:39999/me/keys");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body as string)).toMatchObject({ name: "ci", valid_for_seconds: 86400 });
  });
});

describe("deleteKey", () => {
  it("sends DELETE /me/keys/{keyId}", async () => {
    mockFetch.mockResolvedValueOnce(ok({}));
    await sirr.deleteKey("k_1");
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:39999/me/keys/k_1");
    expect(opts.method).toBe("DELETE");
  });
});

// ── Admin endpoints ───────────────────────────────────────

describe("createOrg", () => {
  it("sends POST /orgs with name", async () => {
    mockFetch.mockResolvedValueOnce(ok({ id: "org_1", name: "acme" }));
    const result = await sirr.createOrg({ name: "acme" });
    expect(result).toEqual({ id: "org_1", name: "acme" });
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:39999/orgs");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body as string)).toEqual({ name: "acme" });
  });
});

describe("listOrgs", () => {
  it("sends GET /orgs and unwraps envelope", async () => {
    const orgs = [{ id: "org_1", name: "acme" }];
    mockFetch.mockResolvedValueOnce(ok({ orgs }));
    const result = await sirr.listOrgs();
    expect(result).toEqual(orgs);
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:39999/orgs");
    expect(opts.method).toBe("GET");
  });
});

describe("deleteOrg", () => {
  it("sends DELETE /orgs/{orgId}", async () => {
    mockFetch.mockResolvedValueOnce(ok({}));
    await sirr.deleteOrg("org_1");
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:39999/orgs/org_1");
    expect(opts.method).toBe("DELETE");
  });
});

describe("createPrincipal", () => {
  it("sends POST /orgs/{orgId}/principals with name and role", async () => {
    mockFetch.mockResolvedValueOnce(
      ok({ id: "p_1", name: "alice", role: "reader", org_id: "org_1" }),
    );
    const result = await sirr.createPrincipal("org_1", { name: "alice", role: "reader" });
    expect(result.id).toBe("p_1");
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:39999/orgs/org_1/principals");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body as string)).toMatchObject({ name: "alice", role: "reader" });
  });
});

describe("listPrincipals", () => {
  it("sends GET /orgs/{orgId}/principals", async () => {
    mockFetch.mockResolvedValueOnce(ok({ principals: [] }));
    await sirr.listPrincipals("org_1");
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:39999/orgs/org_1/principals");
    expect(opts.method).toBe("GET");
  });
});

describe("deletePrincipal", () => {
  it("sends DELETE /orgs/{orgId}/principals/{principalId}", async () => {
    mockFetch.mockResolvedValueOnce(ok({}));
    await sirr.deletePrincipal("org_1", "p_1");
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:39999/orgs/org_1/principals/p_1");
    expect(opts.method).toBe("DELETE");
  });
});

describe("createRole", () => {
  it("sends POST /orgs/{orgId}/roles with permission string", async () => {
    mockFetch.mockResolvedValueOnce(ok({ name: "reader", permissions: "rRlL" }));
    const result = await sirr.createRole("org_1", { name: "reader", permissions: "rRlL" });
    expect(result.name).toBe("reader");
    expect(result.permissions).toBe("rRlL");
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:39999/orgs/org_1/roles");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body as string)).toEqual({ name: "reader", permissions: "rRlL" });
  });
});

describe("listRoles", () => {
  it("sends GET /orgs/{orgId}/roles", async () => {
    mockFetch.mockResolvedValueOnce(ok({ roles: [] }));
    await sirr.listRoles("org_1");
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:39999/orgs/org_1/roles");
    expect(opts.method).toBe("GET");
  });
});

describe("deleteRole", () => {
  it("sends DELETE /orgs/{orgId}/roles/{roleName}", async () => {
    mockFetch.mockResolvedValueOnce(ok({}));
    await sirr.deleteRole("org_1", "admin");
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:39999/orgs/org_1/roles/admin");
    expect(opts.method).toBe("DELETE");
  });
});

// ── Namespaced sub-clients ────────────────────────────────

describe("sirr.webhooks sub-client", () => {
  it("create delegates to createWebhook", async () => {
    mockFetch.mockResolvedValueOnce(ok({ id: "wh_1", secret: "s" }));
    const result = await sirr.webhooks.create("https://example.com/hook");
    expect(result).toEqual({ id: "wh_1", secret: "s" });
  });

  it("list delegates to listWebhooks", async () => {
    mockFetch.mockResolvedValueOnce(ok({ webhooks: [] }));
    const result = await sirr.webhooks.list();
    expect(result).toEqual([]);
  });

  it("delete delegates to deleteWebhook", async () => {
    mockFetch.mockResolvedValueOnce(ok({}));
    const result = await sirr.webhooks.delete("wh_1");
    expect(result).toBe(true);
  });
});

describe("sirr.orgs sub-client", () => {
  it("create delegates to createOrg", async () => {
    mockFetch.mockResolvedValueOnce(ok({ id: "org_1", name: "test" }));
    const result = await sirr.orgs.create({ name: "test" });
    expect(result.id).toBe("org_1");
  });

  it("list delegates to listOrgs", async () => {
    mockFetch.mockResolvedValueOnce(ok({ orgs: [] }));
    const result = await sirr.orgs.list();
    expect(result).toEqual([]);
  });

  it("delete delegates to deleteOrg", async () => {
    mockFetch.mockResolvedValueOnce(ok({}));
    await sirr.orgs.delete("org_1");
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/orgs/org_1");
    expect(opts.method).toBe("DELETE");
  });
});

describe("sirr.principals sub-client", () => {
  it("create delegates to createPrincipal", async () => {
    mockFetch.mockResolvedValueOnce(
      ok({ id: "p_1", name: "alice", role: "reader", org_id: "org_1" }),
    );
    const result = await sirr.principals.create("org_1", { name: "alice", role: "reader" });
    expect(result.id).toBe("p_1");
  });

  it("list delegates to listPrincipals", async () => {
    mockFetch.mockResolvedValueOnce(ok({ principals: [] }));
    const result = await sirr.principals.list("org_1");
    expect(result).toEqual([]);
  });

  it("delete delegates to deletePrincipal", async () => {
    mockFetch.mockResolvedValueOnce(ok({}));
    await sirr.principals.delete("org_1", "p_1");
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/orgs/org_1/principals/p_1");
    expect(opts.method).toBe("DELETE");
  });
});
