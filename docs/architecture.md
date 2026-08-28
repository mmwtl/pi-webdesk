# Architecture

Pi Webdesk separates the browser workspace from the provider integration. The browser owns local-folder access; Vercel Functions own provider credentials and database access.

## System overview

```text
Desktop Chrome / Edge
├── React UI + Pi agent runtime
├── BrowserWorkspace (selected folder only)
├── Browser-native tools: read / ls / find / grep / edit / write / apply_patch / delete
├── IndexedDB: UI preferences, sessions, directory handles
└── same-origin /api requests
          │
          ▼
Vercel Functions
├── /api/chat/completions      provider proxy, provider/model allow-list
├── /api/config and /api/health public browser-safe catalog/health
├── /api/admin/*               password-protected administration
└── Neon/Postgres
    ├── providers: URL, enabled state, AES-256-GCM encrypted API key
    └── models: enabled state, display/reasoning metadata
          │
          ▼
OpenAI-compatible provider
```

## Request flow

1. The administrator signs in under **Settings** and saves a provider key. The browser submits it to same-origin `/api/admin/providers`; the key is encrypted before it enters Postgres and is never sent back.
2. The browser loads `/api/config`, which returns enabled provider/model IDs and reasoning metadata only.
3. Pi creates a Chat Completions request to `/api/chat/completions` and identifies the selected provider in a guarded header.
4. The Function verifies that the provider and requested model are enabled, decrypts the corresponding key, adds the upstream Authorization header, and streams the provider response back.
5. Pi dispatches tool calls in the browser. The tools validate relative paths against the `FileSystemDirectoryHandle` selected by the user.

## Security boundary

- The browser cannot choose upstream URLs or credentials. It may request only models exposed by `/api/config`.
- `CONFIG_ENCRYPTION_KEY` is server-only and encrypts provider keys with AES-256-GCM. Back up this secret securely; without it existing keys cannot be recovered.
- Admin routes require an HMAC-signed, HTTP-only, strict same-site cookie. Write requests with a foreign `Origin` are rejected.
- Upstream CORS is irrelevant: the browser calls its own Vercel origin, and the serverless Function calls the provider.
- This is not a sandbox for untrusted providers. Prompt and requested workspace content can be sent to the provider selected by the administrator.

## Persistence

Neon/Postgres is the durable source of truth for providers and models because Vercel Functions are stateless. IndexedDB keeps only browser-local state: UI settings, session snapshots, and saved directory handles. Legacy browser API keys are removed during settings migration.

## Deployment

Root `api/` files are Vercel Functions. The Vite SPA is built into `dist`; [`vercel.json`](../vercel.json) excludes `/api` from the SPA rewrite. Environment setup and local development are described in the [README](../README.md).
