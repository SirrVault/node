# @sirrlock/node — Claude Development Guide

## Purpose

Node.js client and npx CLI for the Sirr HTTP API.
Published to npm as `@sirrlock/node`. Zero production dependencies — uses native `fetch`.

## What Lives Here

- `src/index.ts` — `SirrClient` class, `SirrError`, and all types (the library)
- `src/cli.ts` — CLI entrypoint (`npx @sirrlock/node push ...`)
- `src/index.test.ts` — unit tests (mock-fetch, mirrors server http_api.rs tests)
- `src/cli.test.ts` — CLI arg parser tests

## API Surface

```typescript
class SirrClient {
  constructor(opts?: { server?: string; key?: string })

  // Secrets
  push(value: string, opts?: { ttl_seconds?: number; reads?: number; prefix?: string }): Promise<SecretResponse>
  get(hash: string): Promise<string | null>        // null on 410 (gone/burned/expired)
  inspect(hash: string): Promise<SecretStatus | null>  // HEAD, does not consume a read
  patch(hash: string, opts: PatchOptions): Promise<SecretResponse>  // owner key required
  burn(hash: string): Promise<void>                // DELETE, 204 on success
  audit(hash: string): Promise<AuditResponse>      // owner key required
  list(): Promise<SecretMetadata[]>                // authenticated, own secrets only

  // Server info
  health(): Promise<{ status: string }>
  version(): Promise<{ version: string }>
}

class SirrError extends Error {
  readonly status: number
  readonly name: "SirrError"
}
```

## Stack

- TypeScript, Node 18+
- Native `fetch` — no axios, no node-fetch
- `tsc` for build (CommonJS output)
- `jest` + `ts-jest` for tests
- `@biomejs/biome` for lint + format

## Key Rules

- `SirrError` is exported — consumers can do `instanceof` checks
- `get()` returns `null` on 410 — never throw for gone/burned/expired
- `inspect()` returns `null` on 410 — same rationale
- All other non-2xx responses throw `SirrError`
- `get()`, `inspect()`, `patch()`, `burn()`, `audit()` validate that hash is non-empty
- Constructor allows empty key (anonymous operations are valid)
- `request()` checks `res.ok` before `res.json()` — handles HTML error pages (nginx 502 etc.)
- `health()` and `version()` throw `SirrError` on non-2xx (do not send auth header)
- Never log secret values
- Keep zero production dependencies
- Test files excluded from `tsconfig.json` — never compiled into `dist/`

## Commands

```bash
npm install       # install deps
npm run build     # tsc → dist/
npm test          # jest
npm run lint      # biome check
npm run lint:fix  # biome check --write
```

## CI

GitHub Actions (`.github/workflows/ci.yml`) — runs on push to main and PRs.
Matrix: Node 18, 20, 22. Steps: install → lint → build → test.

## Relationship to sirr/

The MCP server (`@sirrlock/mcp`) has its own repo at [sirrlock/mcp](https://github.com/sirrlock/mcp).
This client has an independent release cadence.

## Pre-Commit Checklist

Before every commit and push, review and update if needed:

1. **README.md** — Does it reflect new methods or behavior?
2. **CLAUDE.md** — New constraints or API decisions worth recording?
