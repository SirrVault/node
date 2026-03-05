#!/usr/bin/env node
/**
 * Sirr CLI — thin Node.js wrapper for use via `npx sirr` or `npm i -g sirr`.
 *
 * Reads SIRR_SERVER (default: http://localhost:39999) and SIRR_TOKEN.
 */

import { SirrClient } from "./index";

const server = process.env.SIRR_SERVER ?? "http://localhost:39999";
const token = process.env.SIRR_TOKEN ?? "";

function usage(): never {
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

export function parseArgs(argv: string[]): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
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
        const target = args._0 as string | undefined;
        if (!target) usage();
        const ttlArg = args.ttl as string | undefined;
        const readsArg = args.reads as string | undefined;

        if (!target.includes("=")) {
          console.error("push: expected KEY=value");
          process.exit(1);
        }
        const eqIdx = target.indexOf("=");
        const key = target.slice(0, eqIdx);
        const value = target.slice(eqIdx + 1);
        await client.push(key, value, {
          ttl: ttlArg ? Number.parseInt(ttlArg, 10) : undefined,
          reads: readsArg ? Number.parseInt(readsArg, 10) : undefined,
        });
        console.log(`✓ pushed ${key}`);
        break;
      }

      case "get": {
        const key = args._0 as string | undefined;
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
              `  ${m.key} — reads: ${m.read_count}${m.max_reads != null ? `/${m.max_reads}` : ""}`,
            );
          }
        }
        break;
      }

      case "delete": {
        const key = args._0 as string | undefined;
        if (!key) usage();
        const existed = await client.delete(key);
        console.log(existed ? `✓ deleted ${key}` : "not found");
        break;
      }

      case "prune": {
        const n = await client.prune();
        console.log(`pruned ${n} expired secret(s)`);
        break;
      }

      case "audit": {
        const events = await client.getAuditLog({
          since: args.since ? Number(args.since) : undefined,
          action: args.action as string | undefined,
          limit: args.limit ? Number(args.limit) : undefined,
        });
        if (events.length === 0) {
          console.log("(no audit events)");
        } else {
          for (const e of events) {
            console.log(
              `  [${e.timestamp}] ${e.action} key=${e.key ?? "-"} ip=${e.source_ip} ${e.success ? "ok" : "FAIL"}`,
            );
          }
        }
        break;
      }

      case "webhooks": {
        const sub = args._0 as string | undefined;
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
            const url = args._1 as string | undefined;
            if (!url) usage();
            const eventsArg = args.events as string | undefined;
            const events = eventsArg ? eventsArg.split(",") : undefined;
            const result = await client.createWebhook(url, { events });
            console.log("webhook registered");
            console.log(`  id:     ${result.id}`);
            console.log(`  secret: ${result.secret}`);
            break;
          }
          case "remove": {
            const id = args._1 as string | undefined;
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
        const sub = args._0 as string | undefined;
        if (!sub) usage();
        switch (sub) {
          case "list": {
            // No list-keys endpoint on the server API.
            console.log("Key listing is not supported by the server API.");
            break;
          }
          case "create": {
            const name = args._1 as string | undefined;
            if (!name) usage();
            const validFor = args["valid-for"] as string | undefined;
            const result = await client.createKey({
              name,
              valid_for_seconds: validFor ? Number(validFor) : undefined,
            });
            console.log("API key created");
            console.log(`  id:  ${result.id}`);
            console.log(`  key: ${result.key}`);
            console.log(`  (save the key — it won't be shown again)`);
            break;
          }
          case "remove": {
            const id = args._1 as string | undefined;
            if (!id) usage();
            await client.deleteKey(id);
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
  } catch (e: unknown) {
    console.error((e as Error).message ?? String(e));
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
