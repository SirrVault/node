#!/usr/bin/env node
/**
 * Sirr CLI — thin Node.js wrapper for use via `npx @sirrlock/node` or `npm i -g @sirrlock/node`.
 *
 * Reads SIRR_SERVER (default: https://sirr.sirrlock.com) and SIRR_TOKEN.
 */

import { SirrClient, SirrError } from "./index";

const server = process.env.SIRR_SERVER ?? "https://sirr.sirrlock.com";
const token = process.env.SIRR_TOKEN ?? "";

function usage(): never {
  console.error(`
Usage: sirr <command> [options]

Commands:
  push <value> [--ttl <secs>] [--reads <n>] [--prefix <p>]
  get <hash>
  inspect <hash>
  patch <hash> <value> [--ttl <secs>] [--reads <n>]
  burn <hash>
  audit <hash>
  list
  health
  version

Environment:
  SIRR_SERVER   Server URL (default: https://sirr.sirrlock.com)
  SIRR_TOKEN    Bearer API token
`);
  process.exit(1);
}

export function parseArgs(argv: string[]): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg.startsWith("--")) {
      const k = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        result[k] = next;
        i++;
      } else {
        result[k] = true;
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

      case "version": {
        const r = await client.version();
        console.log(JSON.stringify(r));
        break;
      }

      case "push": {
        const value = args._0 as string | undefined;
        if (!value) usage();
        const result = await client.push(value, {
          ttl_seconds: args.ttl ? Number(args.ttl) : undefined,
          reads: args.reads ? Number(args.reads) : undefined,
          prefix: args.prefix as string | undefined,
        });
        console.log(result.hash);
        break;
      }

      case "get": {
        const hash = args._0 as string | undefined;
        if (!hash) usage();
        const value = await client.get(hash);
        if (value === null) {
          console.error("gone");
          process.exit(1);
        }
        console.log(value);
        break;
      }

      case "inspect": {
        const hash = args._0 as string | undefined;
        if (!hash) usage();
        const status = await client.inspect(hash);
        if (status === null) {
          console.error("gone");
          process.exit(1);
        }
        console.log(JSON.stringify(status, null, 2));
        break;
      }

      case "patch": {
        const hash = args._0 as string | undefined;
        const value = args._1 as string | undefined;
        if (!hash || !value) usage();
        const result = await client.patch(hash, {
          value,
          ttl_seconds: args.ttl ? Number(args.ttl) : undefined,
          reads: args.reads ? Number(args.reads) : undefined,
        });
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case "burn": {
        const hash = args._0 as string | undefined;
        if (!hash) usage();
        await client.burn(hash);
        console.log("burned");
        break;
      }

      case "audit": {
        const hash = args._0 as string | undefined;
        if (!hash) usage();
        const result = await client.audit(hash);
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case "list": {
        const secrets = await client.list();
        if (secrets.length === 0) {
          console.log("(no secrets)");
        } else {
          for (const s of secrets) {
            const reads = s.reads_remaining != null ? ` reads=${s.reads_remaining}` : "";
            const burned = s.burned ? " [burned]" : "";
            console.log(`  ${s.hash}${reads}${burned}`);
          }
        }
        break;
      }

      default:
        usage();
    }
  } catch (e: unknown) {
    if (e instanceof SirrError) {
      console.error(`error ${(e as SirrError).status}: ${(e as Error).message}`);
      process.exit(1);
    }
    console.error((e as Error).message ?? String(e));
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
