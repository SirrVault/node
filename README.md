# @sirrlock/node

[![CI](https://github.com/sirrlock/node/actions/workflows/ci.yml/badge.svg)](https://github.com/sirrlock/node/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@sirrlock/node)](https://www.npmjs.com/package/@sirrlock/node)
[![npm downloads](https://img.shields.io/npm/dm/@sirrlock/node)](https://www.npmjs.com/package/@sirrlock/node)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
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
sirr push .env --ttl 24h   # not yet implemented, use key=value form

# Manage
sirr list
sirr delete API_KEY
sirr prune
sirr health
```

Config via env vars:
```bash
export SIRR_SERVER=http://localhost:8080
export SIRR_TOKEN=your-master-key
```

## Programmatic API

```typescript
import { SirrClient, SirrError } from '@sirrlock/node'

const sirr = new SirrClient({
  server: process.env.SIRR_SERVER ?? 'http://localhost:8080',
  token: process.env.SIRR_TOKEN!,
})

// Push a one-time secret
await sirr.push('API_KEY', 'sk-...', { ttl: 3600, reads: 1 })

// Retrieve — null if burned or expired
const value = await sirr.get('API_KEY')

// Pull all secrets into a plain object
const secrets = await sirr.pullAll()

// Inject all secrets as env vars for the duration of a callback
await sirr.withSecrets(async () => {
  // process.env.API_KEY is set here
  await runAgentTask()
})

// Delete immediately
await sirr.delete('API_KEY')

// List active secrets (metadata only — no values)
const list = await sirr.list()
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
