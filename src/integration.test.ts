import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// node/src/integration.test.ts
// Real integration tests against a live sirrd process.
// Starts sirrd on port 39997 with SIRR_AUTOINIT=1 to bootstrap an admin principal + key.
// Run with: npm run test:integration
import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { SirrClient } from "./index";

const PORT = 39997;
const BASE = `http://localhost:${PORT}`;
const MASTER_KEY = "node-integration-test-key";
const LICENSE_KEY = "sirr_lic_0000000000000000000000000000000000000000";

let sirrd: ChildProcess;
let dataDir: string;
let adminClient: SirrClient;
let orgId: string;
let bootstrapKey: string;

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

async function adminFetch(path: string, body: unknown): Promise<Record<string, string>> {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${MASTER_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json() as Promise<Record<string, string>>;
}

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "sirr-e2e-node-"));

  sirrd = spawn("sirrd", ["serve", "--port", String(PORT)], {
    env: {
      ...process.env,
      SIRR_API_KEY: MASTER_KEY,
      SIRR_LICENSE_KEY: LICENSE_KEY,
      SIRR_AUTOINIT: "1",
      SIRR_DATA_DIR: dataDir,
      // Disable effective rate limiting for integration tests.
      SIRR_RATE_LIMIT_PER_SECOND: "1000",
      SIRR_RATE_LIMIT_BURST: "1000",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  // Collect log output (sirrd writes startup info to stderr)
  const logChunks: Buffer[] = [];
  sirrd.stderr?.on("data", (chunk: Buffer) => logChunks.push(chunk));
  sirrd.stdout?.on("data", (chunk: Buffer) => logChunks.push(chunk));

  await waitForHealth();

  // Give sirrd a moment to flush auto-init output
  await new Promise((r) => setTimeout(r, 200));
  const log = Buffer.concat(logChunks).toString("utf8");

  const orgMatch = log.match(/org_id:\s+([0-9a-f]{32})/);
  const keyMatch = log.match(/key=(sirr_key_[0-9a-f]+)/);
  if (!orgMatch || !keyMatch) throw new Error(`Failed to parse bootstrap info:\n${log}`);

  orgId = orgMatch[1];
  bootstrapKey = keyMatch[1];
  adminClient = new SirrClient({ server: BASE, token: MASTER_KEY });

  // Create alice (writer) and bob (reader) in the bootstrapped org
  await adminFetch(`/orgs/${orgId}/principals`, { name: "alice", role: "writer" });
  await adminFetch(`/orgs/${orgId}/principals`, { name: "bob", role: "reader" });
}, 15_000);

afterAll(() => {
  sirrd.kill();
  try {
    rmSync(dataDir, { recursive: true });
  } catch {}
});

describe("health", () => {
  it("server is up", async () => {
    const r = await fetch(`${BASE}/health`);
    expect(r.ok).toBe(true);
    const body = (await r.json()) as Record<string, string>;
    expect(body.status).toBe("ok");
  });
});

describe("public bucket", () => {
  it("admin can push and get a public secret", async () => {
    await adminClient.push("NODE_PUBLIC", "hello-public", { ttl: 3600 });
    expect(await adminClient.get("NODE_PUBLIC")).toBe("hello-public");
  });
});

describe("org-scoped secrets — access control", () => {
  // BOOTSTRAP_KEY is the auto-init admin principal key (tied to orgId)
  const orgAdmin = () => new SirrClient({ server: BASE, token: bootstrapKey, org: orgId });

  it("admin bootstrap key can push org secret", async () => {
    await orgAdmin().push("NODE_PRIVATE", "secret123", { ttl: 3600, reads: 10 });
  });

  it("admin bootstrap key can read org secret", async () => {
    expect(await orgAdmin().get("NODE_PRIVATE")).toBe("secret123");
  });

  it("no auth returns 401", async () => {
    const r = await fetch(`${BASE}/orgs/${orgId}/secrets/NODE_PRIVATE`);
    expect(r.status).toBe(401);
  });

  it("wrong key returns 401", async () => {
    const r = await fetch(`${BASE}/orgs/${orgId}/secrets/NODE_PRIVATE`, {
      headers: { Authorization: "Bearer definitely-wrong-key" },
    });
    expect(r.status).toBe(401);
  });
});

describe("burn-after-read", () => {
  it("value returned on first read, null on second", async () => {
    const orgAdmin = new SirrClient({ server: BASE, token: bootstrapKey, org: orgId });
    await orgAdmin.push("NODE_BURN", "burnme", { ttl: 3600, reads: 1 });
    expect(await orgAdmin.get("NODE_BURN")).toBe("burnme");
    expect(await orgAdmin.get("NODE_BURN")).toBeNull();
  });
});

describe("patch — update TTL in place", () => {
  it("can update ttl_seconds on a persistent secret", async () => {
    // burnOnRead: false makes the secret patchable (server default is burn=true)
    const orgAdmin = new SirrClient({ server: BASE, token: bootstrapKey, org: orgId });
    await orgAdmin.push("NODE_PATCH", "patch-me", { ttl: 60, burnOnRead: false });

    const updated = await orgAdmin.patch("NODE_PATCH", { ttl: 7200 });
    expect(updated).not.toBeNull();
    expect(updated?.expires_at).not.toBeNull();

    // secret still readable after patch
    expect(await orgAdmin.get("NODE_PATCH")).toBe("patch-me");
    await orgAdmin.delete("NODE_PATCH");
  });

  it("patch returns null for a non-existent key", async () => {
    const orgAdmin = new SirrClient({ server: BASE, token: bootstrapKey, org: orgId });
    expect(await orgAdmin.patch("NODE_DOES_NOT_EXIST", { ttl: 60 })).toBeNull();
  });
});

describe("org lifecycle", () => {
  it("createOrg → listOrgs → deleteOrg", async () => {
    let createdOrgId: string | undefined;
    try {
      const created = await adminClient.createOrg({ name: "node-test-org" });
      createdOrgId = created.id;
      expect(createdOrgId).toBeTruthy();

      const listed = await adminClient.listOrgs();
      expect(listed.some((o) => o.id === createdOrgId)).toBe(true);
    } finally {
      if (createdOrgId) await adminClient.deleteOrg(createdOrgId);
    }

    // confirm deleted
    const after = await adminClient.listOrgs();
    expect(after.some((o) => o.id === createdOrgId)).toBe(false);
  });
});

describe("check (HEAD) — does not consume a read", () => {
  it("returns active status before read, read count unchanged", async () => {
    const orgAdmin = new SirrClient({ server: BASE, token: bootstrapKey, org: orgId });
    await orgAdmin.push("NODE_CHECK", "check-me", { ttl: 3600, reads: 5 });

    const before = await orgAdmin.check("NODE_CHECK");
    expect(before).not.toBeNull();
    expect(before?.status).toBe("active");
    expect(before?.readCount).toBe(0);
    expect(before?.readsRemaining).toBe(5);

    // Actually read — increments counter
    await orgAdmin.get("NODE_CHECK");

    const after = await orgAdmin.check("NODE_CHECK");
    expect(after?.readCount).toBe(1);
    expect(after?.readsRemaining).toBe(4);

    await orgAdmin.delete("NODE_CHECK");
  });

  it("returns null for non-existent key", async () => {
    const orgAdmin = new SirrClient({ server: BASE, token: bootstrapKey, org: orgId });
    expect(await orgAdmin.check("NODE_CHECK_MISSING")).toBeNull();
  });

  it("returns sealed status after reads exhausted", async () => {
    const orgAdmin = new SirrClient({ server: BASE, token: bootstrapKey, org: orgId });
    await orgAdmin.push("NODE_SEAL_CHECK", "seal-me", { ttl: 3600, reads: 1, burnOnRead: false });
    await orgAdmin.get("NODE_SEAL_CHECK"); // exhausts the read

    const status = await orgAdmin.check("NODE_SEAL_CHECK");
    expect(status?.status).toBe("sealed");
    expect(status?.readsRemaining).toBe(0);
  });
});

describe("webhook lifecycle", () => {
  it("create → list → delete", async () => {
    let webhookId: string | undefined;
    try {
      const created = await adminClient.webhooks.create("https://example.com/sirr-hook");
      webhookId = created.id;
      expect(created.secret).toBeTruthy();

      const listed = await adminClient.webhooks.list();
      expect(listed.some((w) => w.id === webhookId)).toBe(true);
    } finally {
      if (webhookId) await adminClient.webhooks.delete(webhookId);
    }

    const after = await adminClient.webhooks.list();
    expect(after.some((w) => w.id === webhookId)).toBe(false);
  });
});

describe("role lifecycle", () => {
  it("createRole → listRoles → deleteRole", async () => {
    const roleName = "node-test-role";
    let created = false;
    try {
      const role = await adminClient.createRole(orgId, {
        name: roleName,
        permissions: "rRlL",
      });
      created = true;
      expect(role.name).toBe(roleName);
      expect(role.permissions).toBe("rRlL");

      const roles = await adminClient.listRoles(orgId);
      expect(roles.some((r) => r.name === roleName)).toBe(true);
    } finally {
      if (created) await adminClient.deleteRole(orgId, roleName);
    }

    const after = await adminClient.listRoles(orgId);
    expect(after.some((r) => r.name === roleName)).toBe(false);
  });
});

describe("principal lifecycle", () => {
  it("createPrincipal → listPrincipals → deletePrincipal", async () => {
    let principalId: string | undefined;
    try {
      const created = await adminClient.createPrincipal(orgId, {
        name: "node-test-principal",
        role: "reader",
      });
      principalId = created.id;
      expect(principalId).toBeTruthy();

      const listed = await adminClient.listPrincipals(orgId);
      expect(listed.some((p) => p.id === principalId)).toBe(true);
    } finally {
      if (principalId) await adminClient.deletePrincipal(orgId, principalId);
    }

    // confirm deleted
    const after = await adminClient.listPrincipals(orgId);
    expect(after.some((p) => p.id === principalId)).toBe(false);
  });
});
