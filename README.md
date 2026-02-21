# @sirr/sdk

Node.js / TypeScript client for [Sirr](https://github.com/SirrVault/sirr) — ephemeral secret management.

> Work in progress.

## Install

```bash
npm install @sirr/sdk
```

## Usage

```typescript
import { SirrClient } from '@sirr/sdk'

const sirr = new SirrClient({
  server: process.env.SIRR_SERVER ?? 'http://localhost:8080',
  token: process.env.SIRR_TOKEN!,
})

// Push a one-time secret
await sirr.push('API_KEY', 'sk-...', { ttl: 3600, reads: 1 })

// Retrieve (null if burned or expired)
const value = await sirr.get('API_KEY')

// Pull all secrets into a map
const secrets = await sirr.pullAll()

// Inject all secrets as env vars for the duration of a callback
await sirr.withSecrets(async () => {
  // process.env.API_KEY is set here
  await runTests()
})

// Delete immediately
await sirr.delete('API_KEY')
```

## Related

- [SirrVault/sirr](https://github.com/SirrVault/sirr) — server
- [SirrVault/cli](https://github.com/SirrVault/cli) — CLI
- [SirrVault/python](https://github.com/SirrVault/python) — Python client
- [SirrVault/dotnet](https://github.com/SirrVault/dotnet) — .NET client
