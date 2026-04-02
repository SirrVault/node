import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// node/src/e2e-multitenant.test.ts
// Multi-tenant E2E: two companies on one server, full isolation.
// NO license key — tests the real free-tier experience.
// Run with: npm run test:integration
import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { SirrClient, SirrError } from "./index";

const PORT = 39996;
const BASE = `http://localhost:${PORT}`;
const MASTER_KEY = "node-mt-e2e-master-key";

let sirrd: ChildProcess;
let dataDir: string;
let master: SirrClient;

// Acme
let acmeOrgId: string;
let aliceKey: string; // owner
let bobKey: string; // writer
let carolKey: string; // reader

// Globex
let globexOrgId: string;
let hankKey: string; // owner
let margeKey: string; // writer

async function waitForHealth(retries = 30): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("sirrd did not start in time");
}

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "sirr-e2e-mt-"));

  // Use locally built sirrd if available (e.g. ../sirr/target/release/sirrd)
  const sirrdBin = process.env.SIRRD_BIN || "sirrd";
  sirrd = spawn(sirrdBin, ["serve", "--port", String(PORT)], {
    env: {
      ...process.env,
      SIRR_MASTER_API_KEY: MASTER_KEY,
      SIRR_DATA_DIR: dataDir,
      SIRR_RATE_LIMIT_PER_SECOND: "1000",
      SIRR_RATE_LIMIT_BURST: "1000",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  await waitForHealth();
  master = new SirrClient({ server: BASE, token: MASTER_KEY });

  // ── Acme: org + 3 principals + keys ──────────────────────────────
  const acme = await master.createOrg({ name: "acme" });
  acmeOrgId = acme.id;

  const alice = await master.createPrincipal(acmeOrgId, { name: "alice", role: "owner" });
  const bob = await master.createPrincipal(acmeOrgId, { name: "bob", role: "writer" });
  const carol = await master.createPrincipal(acmeOrgId, { name: "carol", role: "reader" });

  const aliceKeyResult = await master.createPrincipalKey(acmeOrgId, alice.id, { name: "alice-key" });
  const bobKeyResult = await master.createPrincipalKey(acmeOrgId, bob.id, { name: "bob-key" });
  const carolKeyResult = await master.createPrincipalKey(acmeOrgId, carol.id, { name: "carol-key" });

  aliceKey = aliceKeyResult.key;
  bobKey = bobKeyResult.key;
  carolKey = carolKeyResult.key;

  // ── Globex: org + 2 principals + keys ────────────────────────────
  const globex = await master.createOrg({ name: "globex" });
  globexOrgId = globex.id;

  const hank = await master.createPrincipal(globexOrgId, { name: "hank", role: "owner" });
  const marge = await master.createPrincipal(globexOrgId, { name: "marge", role: "writer" });

  const hankKeyResult = await master.createPrincipalKey(globexOrgId, hank.id, { name: "hank-key" });
  const margeKeyResult = await master.createPrincipalKey(globexOrgId, marge.id, { name: "marge-key" });

  hankKey = hankKeyResult.key;
  margeKey = margeKeyResult.key;
}, 15_000);

afterAll(() => {
  sirrd.kill();
  try {
    rmSync(dataDir, { recursive: true });
  } catch {}
});

// ── Helpers ──────────────────────────────────────────────────────────────────

const acmeAs = (token: string) => new SirrClient({ server: BASE, token, org: acmeOrgId });
const globexAs = (token: string) => new SirrClient({ server: BASE, token, org: globexOrgId });

// ── Tests ────────────────────────────────────────────────────────────────────

describe("setup", () => {
  it("server is healthy", async () => {
    const h = await master.health();
    expect(h.status).toBe("ok");
  });

  it("two orgs created", async () => {
    const orgs = await master.listOrgs();
    const names = orgs.map((o) => o.name);
    expect(names).toContain("acme");
    expect(names).toContain("globex");
  });
});

describe("authentication", () => {
  it("alice authenticates as alice", async () => {
    const me = await acmeAs(aliceKey).me();
    expect(me.name).toBe("alice");
    expect(me.role).toBe("owner");
  });

  it("bob authenticates as bob", async () => {
    const me = await acmeAs(bobKey).me();
    expect(me.name).toBe("bob");
    expect(me.role).toBe("writer");
  });

  it("hank authenticates as hank", async () => {
    const me = await globexAs(hankKey).me();
    expect(me.name).toBe("hank");
    expect(me.role).toBe("owner");
  });
});

describe("acme secrets", () => {
  it("alice (owner) can set and read DB_URL", async () => {
    const client = acmeAs(aliceKey);
    await client.set("DB_URL", "postgres://acme-db:5432/acme", { reads: 10 });
    expect(await client.get("DB_URL")).toBe("postgres://acme-db:5432/acme");
  });

  it("bob (writer) can set and read API_KEY", async () => {
    const client = acmeAs(bobKey);
    await client.set("API_KEY", "acme-api-key-42", { reads: 10 });
    expect(await client.get("API_KEY")).toBe("acme-api-key-42");
  });

  it("carol (reader) cannot create secrets", async () => {
    const client = acmeAs(carolKey);
    await expect(client.set("NOPE", "denied")).rejects.toThrow(SirrError);
    try {
      await client.set("NOPE", "denied");
    } catch (e) {
      expect(e).toBeInstanceOf(SirrError);
      expect((e as SirrError).status).toBe(403);
    }
  });
});

describe("globex secrets", () => {
  it("hank (owner) sets DB_URL — same key name as acme", async () => {
    const client = globexAs(hankKey);
    await client.set("DB_URL", "postgres://globex-db:5432/globex", { reads: 10 });
    expect(await client.get("DB_URL")).toBe("postgres://globex-db:5432/globex");
  });

  it("marge (writer) can set and read in globex", async () => {
    const client = globexAs(margeKey);
    await client.set("STRIPE_KEY", "sk_test_globex", { reads: 10 });
    expect(await client.get("STRIPE_KEY")).toBe("sk_test_globex");
  });
});

describe("org isolation — same key name, different values", () => {
  it("acme DB_URL still has acme value", async () => {
    expect(await acmeAs(aliceKey).get("DB_URL")).toBe("postgres://acme-db:5432/acme");
  });

  it("globex DB_URL has globex value", async () => {
    expect(await globexAs(hankKey).get("DB_URL")).toBe("postgres://globex-db:5432/globex");
  });
});

describe("cross-org isolation — principals cannot reach other orgs", () => {
  it("hank (globex) cannot read acme secrets", async () => {
    // hank's token is bound to globex org — reading acme should fail
    const hankInAcme = acmeAs(hankKey);
    await expect(hankInAcme.get("DB_URL")).rejects.toThrow(SirrError);
  });

  it("alice (acme) cannot read globex secrets", async () => {
    const aliceInGlobex = globexAs(aliceKey);
    await expect(aliceInGlobex.get("DB_URL")).rejects.toThrow(SirrError);
  });

  it("marge (globex) cannot write to acme", async () => {
    const margeInAcme = acmeAs(margeKey);
    await expect(margeInAcme.set("HACK", "nope")).rejects.toThrow(SirrError);
  });

  it("bob (acme) cannot write to globex", async () => {
    const bobInGlobex = globexAs(bobKey);
    await expect(bobInGlobex.set("HACK", "nope")).rejects.toThrow(SirrError);
  });
});

describe("public dead drop", () => {
  it("push and get without org", async () => {
    const anon = new SirrClient({ server: BASE });
    const { id } = await anon.push("hello-from-node");
    expect(id).toBeTruthy();
    expect(await anon.get(id)).toBe("hello-from-node");
  });
});

describe("burn-after-read", () => {
  it("first read returns value, second returns null", async () => {
    const client = acmeAs(aliceKey);
    await client.set("BURN_NODE", "burnme", { reads: 1 });
    expect(await client.get("BURN_NODE")).toBe("burnme");
    expect(await client.get("BURN_NODE")).toBeNull();
  });
});

describe("self-service key", () => {
  it("alice creates her own key and authenticates with it", async () => {
    const client = acmeAs(aliceKey);
    const newKey = await client.createKey({ name: "alice-self-key" });
    expect(newKey.key).toBeTruthy();

    const client2 = acmeAs(newKey.key);
    const me = await client2.me();
    expect(me.name).toBe("alice");
  });
});
