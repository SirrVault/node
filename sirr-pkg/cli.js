#!/usr/bin/env node
#\!/usr/bin/env node
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/cli.ts
var cli_exports = {};
__export(cli_exports, {
  parseArgs: () => parseArgs
});
module.exports = __toCommonJS(cli_exports);

// src/index.ts
var SirrError = class extends Error {
  constructor(status, message) {
    super(`Sirr API error ${status}: ${message}`);
    this.status = status;
    this.name = "SirrError";
  }
};
function validateKey(key) {
  if (!key) {
    throw new Error("Secret key must not be empty");
  }
}
var SirrClient = class {
  constructor(opts) {
    if (!opts.token) {
      throw new Error("SirrClient requires a non-empty token");
    }
    this.server = (opts.server ?? "http://localhost:39999").replace(/\/$/, "");
    this.token = opts.token;
    this.org = opts.org;
  }
  secretsPath(key) {
    const base = this.org ? `/orgs/${encodeURIComponent(this.org)}/secrets` : "/secrets";
    return key ? `${base}/${encodeURIComponent(key)}` : base;
  }
  auditPath() {
    return this.org ? `/orgs/${encodeURIComponent(this.org)}/audit` : "/audit";
  }
  webhooksPath(id) {
    const base = this.org ? `/orgs/${encodeURIComponent(this.org)}/webhooks` : "/webhooks";
    return id ? `${base}/${encodeURIComponent(id)}` : base;
  }
  prunePath() {
    return this.org ? `/orgs/${encodeURIComponent(this.org)}/prune` : "/prune";
  }
  headers() {
    return {
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json"
    };
  }
  async request(method, path, body) {
    const res = await fetch(`${this.server}${path}`, {
      method,
      headers: this.headers(),
      body: body !== void 0 ? JSON.stringify(body) : void 0
    });
    if (!res.ok) {
      let message = "unknown error";
      try {
        const json = await res.json();
        message = json.error ?? message;
      } catch {
        try {
          const text = await res.text();
          if (text) message = text.slice(0, 200);
        } catch {
        }
      }
      throw new SirrError(res.status, message);
    }
    return await res.json();
  }
  /** Check server health. Does not require authentication. */
  async health() {
    const res = await fetch(`${this.server}/health`);
    if (!res.ok) {
      throw new SirrError(res.status, "health check failed");
    }
    return res.json();
  }
  /**
   * Push a secret to the vault.
   *
   * @param key   Secret key name
   * @param value Secret value
   * @param opts  TTL (seconds) and/or max read count
   */
  async push(key, value, opts = {}) {
    validateKey(key);
    await this.request("POST", this.secretsPath(), {
      key,
      value,
      ttl_seconds: opts.ttl ?? null,
      max_reads: opts.reads ?? null
    });
  }
  /**
   * Retrieve a secret by key. Increments the read counter.
   * Returns `null` if the secret does not exist or has expired/burned.
   */
  async get(key) {
    validateKey(key);
    try {
      const data = await this.request(
        "GET",
        this.secretsPath(key)
      );
      return data.value;
    } catch (e) {
      if (e instanceof SirrError && e.status === 404) return null;
      throw e;
    }
  }
  /** List metadata for all active secrets. Values are never returned. */
  async list() {
    const data = await this.request("GET", this.secretsPath());
    return data.secrets;
  }
  /** Delete a secret immediately. Returns true if it existed. */
  async delete(key) {
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
  async pullAll() {
    const metas = await this.list();
    const result = {};
    await Promise.all(
      metas.map(async (m) => {
        const value = await this.get(m.key);
        if (value !== null) result[m.key] = value;
      })
    );
    return result;
  }
  /** Trigger an immediate sweep of expired secrets on the server. */
  async prune() {
    const data = await this.request("POST", this.prunePath());
    return data.pruned;
  }
  /**
   * Inject all vault secrets as process.env variables, then invoke `fn`.
   * Useful in test harnesses and scripts.
   */
  async withSecrets(fn) {
    const secrets = await this.pullAll();
    const originals = {};
    for (const [k, v] of Object.entries(secrets)) {
      originals[k] = process.env[k];
      process.env[k] = v;
    }
    try {
      return await fn();
    } finally {
      for (const [k, orig] of Object.entries(originals)) {
        if (orig === void 0) delete process.env[k];
        else process.env[k] = orig;
      }
    }
  }
  /** Query the audit log. */
  async getAuditLog(opts = {}) {
    const params = new URLSearchParams();
    if (opts.since != null) params.set("since", String(opts.since));
    if (opts.until != null) params.set("until", String(opts.until));
    if (opts.action != null) params.set("action", opts.action);
    if (opts.limit != null) params.set("limit", String(opts.limit));
    const qs = params.toString();
    const data = await this.request("GET", `${this.auditPath()}${qs ? `?${qs}` : ""}`);
    return data.events;
  }
  /** Register a webhook. Returns the ID and signing secret. */
  async createWebhook(url, opts) {
    const body = { url };
    if (opts?.events) body.events = opts.events;
    return this.request("POST", this.webhooksPath(), body);
  }
  /** List registered webhooks. Signing secrets are redacted. */
  async listWebhooks() {
    const data = await this.request("GET", this.webhooksPath());
    return data.webhooks;
  }
  /** Delete a webhook by ID. Returns false if not found. */
  async deleteWebhook(id) {
    try {
      await this.request("DELETE", this.webhooksPath(id));
      return true;
    } catch (e) {
      if (e instanceof SirrError && e.status === 404) return false;
      throw e;
    }
  }
  /** Create a scoped API key. The raw key is returned once. */
  async createApiKey(opts) {
    return this.request("POST", "/keys", opts);
  }
  /** List all scoped API keys. Key hashes are never returned. */
  async listApiKeys() {
    const data = await this.request("GET", "/keys");
    return data.keys;
  }
  /** Delete an API key by ID. Returns false if not found. */
  async deleteApiKey(id) {
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
  async me() {
    return this.request("GET", "/me");
  }
  /** Update the current principal's profile. */
  async updateMe(body) {
    return this.request("PATCH", "/me", body);
  }
  /** Create a new API key for the current principal. */
  async createKey(body) {
    return this.request("POST", "/me/keys", body);
  }
  /** Delete an API key belonging to the current principal. */
  async deleteKey(keyId) {
    await this.request("DELETE", `/me/keys/${encodeURIComponent(keyId)}`);
  }
  // ── Admin endpoints (master key only) ─────────────────────
  /** Create an org. */
  async createOrg(body) {
    return this.request("POST", "/orgs", body);
  }
  /** List all orgs. */
  async listOrgs() {
    return this.request("GET", "/orgs");
  }
  /** Delete an org by ID. */
  async deleteOrg(orgId) {
    await this.request("DELETE", `/orgs/${encodeURIComponent(orgId)}`);
  }
  /** Create a principal within an org. */
  async createPrincipal(orgId, body) {
    return this.request("POST", `/orgs/${encodeURIComponent(orgId)}/principals`, body);
  }
  /** List principals within an org. */
  async listPrincipals(orgId) {
    return this.request("GET", `/orgs/${encodeURIComponent(orgId)}/principals`);
  }
  /** Delete a principal within an org. */
  async deletePrincipal(orgId, principalId) {
    await this.request(
      "DELETE",
      `/orgs/${encodeURIComponent(orgId)}/principals/${encodeURIComponent(principalId)}`
    );
  }
  /** Create a role within an org. */
  async createRole(orgId, body) {
    return this.request("POST", `/orgs/${encodeURIComponent(orgId)}/roles`, body);
  }
  /** List roles within an org. */
  async listRoles(orgId) {
    return this.request("GET", `/orgs/${encodeURIComponent(orgId)}/roles`);
  }
  /** Delete a role within an org. */
  async deleteRole(orgId, roleName) {
    await this.request(
      "DELETE",
      `/orgs/${encodeURIComponent(orgId)}/roles/${encodeURIComponent(roleName)}`
    );
  }
};

// src/cli.ts
var server = process.env.SIRR_SERVER ?? "http://localhost:39999";
var token = process.env.SIRR_TOKEN ?? "";
function usage() {
  console.error(`
Usage: sirr <command> [options]

Commands:
  push KEY=value [--ttl <secs>] [--reads <n>]
  get KEY
  list
  delete KEY
  prune
  health
  audit [--since <ts>] [--action <action>] [--limit <n>]
  webhooks list
  webhooks add <url> [--events <csv>]
  webhooks remove <id>
  keys list
  keys create <label> [--permissions <csv>]
  keys remove <id>

Environment:
  SIRR_SERVER   Server URL (default: http://localhost:39999)
  SIRR_TOKEN    Bearer token
`);
  process.exit(1);
}
function parseArgs(argv) {
  const result = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        result[key] = next;
        i++;
      } else {
        result[key] = true;
      }
    } else {
      positional.push(arg);
      result[`_${positional.length - 1}`] = arg;
    }
  }
  result._count = positional.length;
  return result;
}
async function main() {
  const [, , subcmd, ...rest] = process.argv;
  if (!subcmd) usage();
  const args = parseArgs(rest);
  const client = new SirrClient({ server, token });
  try {
    switch (subcmd) {
      case "health": {
        const r = await client.health();
        console.log(JSON.stringify(r));
        break;
      }
      case "push": {
        const target = args._0;
        if (!target) usage();
        const ttlArg = args.ttl;
        const readsArg = args.reads;
        if (!target.includes("=")) {
          console.error("push: expected KEY=value");
          process.exit(1);
        }
        const eqIdx = target.indexOf("=");
        const key = target.slice(0, eqIdx);
        const value = target.slice(eqIdx + 1);
        await client.push(key, value, {
          ttl: ttlArg ? Number.parseInt(ttlArg, 10) : void 0,
          reads: readsArg ? Number.parseInt(readsArg, 10) : void 0
        });
        console.log(`\u2713 pushed ${key}`);
        break;
      }
      case "get": {
        const key = args._0;
        if (!key) usage();
        const value = await client.get(key);
        if (value === null) {
          console.error("not found or expired");
          process.exit(1);
        }
        console.log(value);
        break;
      }
      case "list": {
        const metas = await client.list();
        if (metas.length === 0) {
          console.log("(no active secrets)");
        } else {
          for (const m of metas) {
            console.log(
              `  ${m.key} \u2014 reads: ${m.read_count}${m.max_reads != null ? `/${m.max_reads}` : ""}`
            );
          }
        }
        break;
      }
      case "delete": {
        const key = args._0;
        if (!key) usage();
        const existed = await client.delete(key);
        console.log(existed ? `\u2713 deleted ${key}` : "not found");
        break;
      }
      case "prune": {
        const n = await client.prune();
        console.log(`pruned ${n} expired secret(s)`);
        break;
      }
      case "audit": {
        const events = await client.getAuditLog({
          since: args.since ? Number(args.since) : void 0,
          action: args.action,
          limit: args.limit ? Number(args.limit) : void 0
        });
        if (events.length === 0) {
          console.log("(no audit events)");
        } else {
          for (const e of events) {
            console.log(
              `  [${e.timestamp}] ${e.action} key=${e.key ?? "-"} ip=${e.source_ip} ${e.success ? "ok" : "FAIL"}`
            );
          }
        }
        break;
      }
      case "webhooks": {
        const sub = args._0;
        if (!sub) usage();
        switch (sub) {
          case "list": {
            const wh = await client.listWebhooks();
            if (wh.length === 0) {
              console.log("(no webhooks)");
            } else {
              for (const w of wh) {
                console.log(`  ${w.id}  ${w.url}  [${w.events.join(",")}]`);
              }
            }
            break;
          }
          case "add": {
            const url = args._1;
            if (!url) usage();
            const eventsArg = args.events;
            const events = eventsArg ? eventsArg.split(",") : void 0;
            const result = await client.createWebhook(url, { events });
            console.log("webhook registered");
            console.log(`  id:     ${result.id}`);
            console.log(`  secret: ${result.secret}`);
            break;
          }
          case "remove": {
            const id = args._1;
            if (!id) usage();
            await client.deleteWebhook(id);
            console.log(`webhook ${id} removed`);
            break;
          }
          default:
            usage();
        }
        break;
      }
      case "keys": {
        const sub = args._0;
        if (!sub) usage();
        switch (sub) {
          case "list": {
            const keys = await client.listApiKeys();
            if (keys.length === 0) {
              console.log("(no API keys)");
            } else {
              for (const k of keys) {
                console.log(
                  `  ${k.id}  ${k.label}  [${k.permissions.join(",")}]  prefix=${k.prefix ?? "*"}`
                );
              }
            }
            break;
          }
          case "create": {
            const label = args._1;
            if (!label) usage();
            const permsArg = args.permissions;
            const permissions = permsArg ? permsArg.split(",") : ["read", "write"];
            const prefix = args.prefix;
            const result = await client.createApiKey({ label, permissions, prefix });
            console.log("API key created");
            console.log(`  id:  ${result.id}`);
            console.log(`  key: ${result.key}`);
            console.log(`  (save the key \u2014 it won't be shown again)`);
            break;
          }
          case "remove": {
            const id = args._1;
            if (!id) usage();
            await client.deleteApiKey(id);
            console.log(`API key ${id} removed`);
            break;
          }
          default:
            usage();
        }
        break;
      }
      default:
        usage();
    }
  } catch (e) {
    console.error(e.message ?? String(e));
    process.exit(1);
  }
}
if (require.main === module) {
  main();
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  parseArgs
});
