# @sirrlock/node

[![npm version](https://img.shields.io/npm/v/@sirrlock/node)](https://www.npmjs.com/package/@sirrlock/node)
[![npm downloads](https://img.shields.io/npm/dm/@sirrlock/node)](https://www.npmjs.com/package/@sirrlock/node)
[![CI](https://github.com/sirrlock/node/actions/workflows/ci.yml/badge.svg)](https://github.com/sirrlock/node/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Node.js client for [Sirr](https://github.com/sirrlock/sirr) — ephemeral secret vault.**

Zero dependencies. Uses native `fetch`. Works in Node 18+, Deno, Bun, and edge runtimes.

## Install

```bash
npm install @sirrlock/node
```

## Quick Start

```typescript
import { SirrClient } from '@sirrlock/node'

const sirr = new SirrClient({
  server: 'http://localhost:7843',
  key: process.env.SIRR_KEY,  // optional — omit for anonymous push
})

// Push a secret — returns { hash, url, expires_at, reads_remaining, owned }
const { hash } = await sirr.push('postgres://...', { reads: 1, ttl_seconds: 3600 })

// Read it back (consumes a read)
const value = await sirr.get(hash)  // → 'postgres://...' or null if gone

// Inspect metadata without consuming a read
const status = await sirr.inspect(hash)
// → { created, ttlExpires, readsRemaining, owned }

// Update value (owner key required)
await sirr.patch(hash, { value: 'new-value', reads: 5 })

// Burn immediately
await sirr.burn(hash)

// Audit trail (owner key required)
const { events } = await sirr.audit(hash)

// List your secrets (authenticated)
const secrets = await sirr.list()
```

## CLI

```bash
# Push
sirr push "postgres://..." --reads 1 --ttl 3600 --prefix db-

# Read
sirr get <hash>

# Inspect (HEAD — no read consumed)
sirr inspect <hash>

# Patch (requires SIRR_KEY)
sirr patch <hash> "new-value" --reads 5

# Burn
sirr burn <hash>

# Audit (requires SIRR_KEY)
sirr audit <hash>

# List own secrets (requires SIRR_KEY)
sirr list

# Server info
sirr health
sirr version
```

Config via env vars:
```bash
export SIRR_SERVER=http://localhost:7843   # default: https://sirrlock.com
export SIRR_KEY=your-api-key               # for authenticated operations
```

## API Reference

### Constructor

```typescript
new SirrClient(opts?: {
  server?: string   // default: 'https://sirrlock.com'
  key?: string      // Bearer API key. Omit for anonymous operations.
})
```

### Methods

| Method | HTTP | Auth | Returns |
|--------|------|------|---------|
| `push(value, opts?)` | `POST /secret` | Optional | `SecretResponse` |
| `get(hash)` | `GET /secret/{hash}` | No | `string \| null` |
| `inspect(hash)` | `HEAD /secret/{hash}` | No | `SecretStatus \| null` |
| `patch(hash, opts)` | `PATCH /secret/{hash}` | Required | `SecretResponse` |
| `burn(hash)` | `DELETE /secret/{hash}` | Owner or anon | `void` |
| `audit(hash)` | `GET /secret/{hash}/audit` | Required | `AuditResponse` |
| `list()` | `GET /secrets` | Required | `SecretMetadata[]` |
| `health()` | `GET /health` | No | `{ status }` |
| `version()` | `GET /version` | No | `{ version }` |

### Error Handling

```typescript
import { SirrClient, SirrError } from '@sirrlock/node'

// get() and inspect() return null when secret is gone (410)
const value = await sirr.get(hash)
if (value === null) console.log('secret is gone')

// All other errors throw SirrError
try {
  await sirr.patch(hash, { value: 'new' })
} catch (e) {
  if (e instanceof SirrError) {
    console.error(`API error ${e.status}: ${e.message}`)
    // e.status: 401 (no auth), 404 (not found/wrong key), 410 (gone), 405 (anon patch)
  }
}
```

## AI Workflows

### One-time credential for an agent

```typescript
const { hash } = await sirr.push(process.env.DB_URL!, { reads: 1 })
// Pass hash to agent — burned after one read
```

### LangChain tool with ephemeral credential

```typescript
import { DynamicTool } from 'langchain/tools'

const dbTool = new DynamicTool({
  name: 'query_database',
  func: async (query) => {
    const connStr = await sirr.get(hash)
    if (!connStr) throw new Error('credential expired')
    return runQuery(connStr, query)
  },
})
```

## Related

| Package | Description |
|---------|-------------|
| [sirr](https://github.com/sirrlock/sirr) | Rust monorepo: `sirrd` server + `sirr` CLI |
| [@sirrlock/mcp](https://github.com/sirrlock/mcp) | MCP server for AI assistants |
| [sirr (PyPI)](https://github.com/sirrlock/python) | Python SDK |
| [Sirr.Client (NuGet)](https://github.com/sirrlock/dotnet) | .NET SDK |
| [sirr.dev](https://sirr.dev) | Documentation |
| [sirrlock.com](https://sirrlock.com) | Managed cloud |
