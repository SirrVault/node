# @sirrlock/node — Claude Development Guide

## Purpose

Node.js client and npx CLI for the Sirr HTTP API.
Published to npm as `@sirrlock/node`. Zero production dependencies — uses native `fetch`.

## What Lives Here

- `src/index.ts` — `SirrClient` class and `SirrError` (the library)
- `src/cli.ts` — CLI entrypoint (`npx @sirrlock/node push ...`)
- `src/index.test.ts` — unit tests (SirrClient, SirrError, validation, resilience)
- `src/cli.test.ts` — CLI arg parser tests

## API Surface

```typescript
class SirrClient {
  constructor(opts: { server?: string; token: string })  // throws if token empty

  push(key: string, value: string, opts?: { ttl?: number; reads?: number }): Promise<void>
  get(key: string): Promise<string | null>   // null if burned/expired
  delete(key: string): Promise<boolean>
  list(): Promise<SecretMeta[]>
  pullAll(): Promise<Record<string, string>>
  withSecrets<T>(fn: () => Promise<T>): Promise<T>
  prune(): Promise<number>
  health(): Promise<{ status: string }>
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
- `get()` returns `null` on 404 — never throw for not-found
- All other non-2xx responses throw `SirrError`
- `push()`, `get()`, `delete()` validate that key is non-empty
- Constructor validates that token is non-empty
- `request()` checks `res.ok` before `res.json()` — handles HTML error pages (nginx 502 etc.)
- `health()` throws `SirrError` on non-2xx (does not send auth header)
- Never log secret values
- `withSecrets()` must restore original env on exit, even on exception
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

This repo was extracted from `sirr/packages/node/`. The MCP server (`@sirrlock/mcp`)
remains in the [sirrlock/sirr](https://github.com/sirrlock/sirr) monorepo
because it is co-released with the server binary. This client has an independent
release cadence once the HTTP API stabilises.

## Pre-Commit Checklist

Before every commit and push, review and update if needed:

1. **README.md** — Does it reflect new methods or behavior?
2. **CLAUDE.md** — New constraints or API decisions worth recording?
