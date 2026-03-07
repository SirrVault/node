# @sirrlock/node

[![npm version](https://img.shields.io/npm/v/@sirrlock/node)](https://www.npmjs.com/package/@sirrlock/node)
[![npm downloads](https://img.shields.io/npm/dm/@sirrlock/node)](https://www.npmjs.com/package/@sirrlock/node)
[![CI](https://github.com/sirrlock/node/actions/workflows/ci.yml/badge.svg)](https://github.com/sirrlock/node/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![GitHub stars](https://img.shields.io/github/stars/sirrlock/node)](https://github.com/sirrlock/node)
[![Last commit](https://img.shields.io/github/last-commit/sirrlock/node)](https://github.com/sirrlock/node)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Node.js client and npx CLI for [Sirr](https://github.com/sirrlock/sirr) — ephemeral secret management.**

Give AI agents exactly the credentials they need, for exactly as long as they need them. Read once and it's gone. Expired by time and you never have to clean anything up.

## Install

```bash
npm install @sirrlock/node
```

Or use without installing:

```bash
npx @sirrlock/node push DB_URL="postgres://..." --reads 1 --ttl 1h
```

## CLI

```bash
# Push a secret that burns after one read
sirr push DB_URL="postgres://..." --reads 1 --ttl 1h

# Retrieve (burns on read if reads=1)
sirr get DB_URL

# Push entire .env — expires in 24h
sirr push .env --ttl 24h

# Manage
sirr list
sirr delete API_KEY
sirr prune
sirr health
```

Config via env vars:
```bash
export SIRR_SERVER=http://localhost:39999
export SIRR_TOKEN=your-master-key
```

## Programmatic API

```typescript
import { SirrClient, SirrError } from '@sirrlock/node'

const sirr = new SirrClient({
  server: process.env.SIRR_SERVER ?? 'http://localhost:39999',
  token: process.env.SIRR_TOKEN!,
})

// Push a one-time secret (burned after first read)
await sirr.push('API_KEY', 'sk-...', { ttl: 3600, reads: 1 })

// Push a persistent secret (survives reads; patchable)
await sirr.push('DB_URL', 'postgres://...', { ttl: 86400, burnOnRead: false })

// Update TTL or value in place (only works if burnOnRead: false)
const meta = await sirr.patch('DB_URL', { ttl: 172800 })

// Retrieve — null if burned, expired, or sealed
const value = await sirr.get('API_KEY')

// Pull all secrets into a plain object
const secrets = await sirr.pullAll()

// Inject all secrets as env vars for the duration of a callback
await sirr.withSecrets(async () => {
  // process.env.API_KEY is set here
  await runAgentTask()
})

// Inspect metadata without consuming a read (HEAD request)
const status = await sirr.check('API_KEY')
// { status: 'active', readCount: 0, readsRemaining: 1, burnOnRead: true, ... }

// Delete immediately
await sirr.delete('API_KEY')

// List active secrets (metadata only — no values)
const list = await sirr.list()
```

### Multi-Tenant / Org Mode

When working with a multi-tenant Sirr server, pass an `org` slug to scope all
secret, audit, webhook, and prune operations under that org:

```typescript
const sirr = new SirrClient({
  server: 'http://localhost:39999',
  token: process.env.SIRR_TOKEN!,
  org: 'acme',   // all paths become /orgs/acme/...
})

// These now hit /orgs/acme/secrets, /orgs/acme/audit, etc.
await sirr.push('DB_URL', 'postgres://...', { reads: 1 })
const secrets = await sirr.list()
const events = await sirr.audit()
```

Without `org`, the client behaves exactly as before (`/secrets`, `/audit`, etc.).

#### /me endpoints

Manage the current principal's profile and API keys:

```typescript
const profile = await sirr.me()                                // GET /me
await sirr.updateMe({ metadata: { team: 'platform' } })       // PATCH /me
const key = await sirr.createKey({ name: 'ci' })              // POST /me/keys
const revoked = await sirr.deleteKey(key.id)                   // DELETE /me/keys/{id} → boolean
```

#### Admin endpoints (master key only)

Manage orgs, principals, and roles. Available both as flat methods and through
namespaced sub-clients (`sirr.orgs.*`, `sirr.principals.*`, `sirr.webhooks.*`):

```typescript
// Orgs
const org = await sirr.orgs.create({ name: 'acme' })  // or sirr.createOrg(...)
const orgs = await sirr.orgs.list()                    // returns Org[]
await sirr.orgs.delete(org.id)

// Principals
const p = await sirr.principals.create(org.id, { name: 'alice', role: 'writer' })
const principals = await sirr.principals.list(org.id)  // returns Principal[]
await sirr.principals.delete(org.id, p.id)

// Roles — permissions is a letter string, not an array
await sirr.createRole(org.id, { name: 'reader', permissions: 'rRlL' })
await sirr.listRoles(org.id)
await sirr.deleteRole(org.id, 'reader')

// Webhooks
const wh = await sirr.webhooks.create('https://example.com/hook')
const webhooks = await sirr.webhooks.list()
await sirr.webhooks.delete(wh.id)

// Audit log
const events = await sirr.audit({ action: 'secret.read', limit: 50 })
```

### Error Handling

```typescript
import { SirrError } from '@sirrlock/node'

try {
  await sirr.push('KEY', 'value')
} catch (e) {
  if (e instanceof SirrError) {
    console.error(`API error ${e.status}: ${e.message}`)
  }
}
```

## AI Workflows

### LangChain.js tool with scoped credential

```typescript
import { DynamicTool } from 'langchain/tools'

const dbTool = new DynamicTool({
  name: 'query_database',
  description: 'Run a SQL query against the production database',
  func: async (query) => {
    const connStr = await sirr.get('AGENT_DB')
    if (!connStr) throw new Error('DB credential expired or burned')
    return runQuery(connStr, query)
  },
})
```

### Inject secrets into a subprocess

```typescript
await sirr.withSecrets(async () => {
  await execa('python', ['agent.py'])
})
```

### CI/CD: one-time deploy credential

```typescript
await sirr.push('DEPLOY_TOKEN', process.env.PERMANENT_TOKEN!, { reads: 1 })
await execa('sirr', ['run', '--', './deploy.sh'])
// DEPLOY_TOKEN was read once and is now deleted
```

### pytest-style fixture for Node.js tests

```typescript
beforeAll(async () => {
  await sirr.withSecrets(async () => {
    // All vault secrets set as process.env for the test suite
    await runTestSuite()
  })
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
| [sirrlock.com](https://sirrlock.com) | Managed cloud + license keys |
