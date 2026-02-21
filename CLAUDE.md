# @sirr/sdk — Claude Development Guide

## Purpose

TypeScript fetch wrapper for the Sirr HTTP API. Published to npm as `@sirr/sdk`.
Thin client — no business logic, no dependencies beyond fetch (Node 18+).

## Planned API Surface

```typescript
class SirrClient {
  constructor(opts: { server: string; token: string })

  push(key: string, value: string, opts?: { ttl?: number; reads?: number }): Promise<void>
  get(key: string): Promise<string | null>         // null if burned/expired
  delete(key: string): Promise<void>
  list(): Promise<SecretMeta[]>
  pullAll(): Promise<Record<string, string>>
  withSecrets(fn: () => Promise<void>): Promise<void>
  prune(): Promise<number>
}
```

## Stack

- TypeScript, targeting Node 18+
- Native `fetch` — no axios, no node-fetch
- `tsup` for bundling (ESM + CJS)
- `vitest` for tests

## Key Rules

- Never log secret values
- `get()` returns `null` on 404 — do not throw
- All methods throw on non-2xx (except 404 for `get`)
- Keep this package zero-dependency

## Pre-Commit Checklist

Before every commit and push, review and update if needed:

1. **README.md** — Does it reflect new methods or behavior?
2. **CLAUDE.md** — New constraints or API decisions worth recording?
