# Pi Webdesk

Pi Webdesk is a browser-based coding agent for a locally selected workspace. The browser runs the React UI, Pi runtime, and File System Access API tools. Vercel Functions hold the upstream provider credentials and proxy Chat Completions requests.

> Early-stage software (`v0.1.0`). The backend does not get shell or filesystem access.

## What it does

- Streams OpenAI-compatible Chat Completions through same-origin `/api` routes.
- Keeps provider URLs and API keys out of the browser.
- Lets an administrator add, disable, discover, and remove providers and models in **Settings**.
- Encrypts provider keys in Postgres with AES-256-GCM before storage.
- Opens one local folder through the File System Access API and exposes browser-native read/edit/search tools to Pi.
- Stores UI preferences, sessions, and directory handles in IndexedDB; it never stores provider keys there.

## Requirements

- Node.js `^20.19.0` or `>=22.12.0`.
- Desktop Chrome or Edge 120+ for `showDirectoryPicker()`.
- A Vercel project and Neon/Postgres database.

## Run locally

Install dependencies, create a local `.env` from [`.env.example`](.env.example), then use Vercel's local runtime so both Vite and Functions run together:

```bash
npm install
npx vercel dev
```

`npm run dev` still starts only the Vite frontend and is useful for UI work, but it cannot serve `/api` functions by itself.

Open the URL printed by Vercel. In **Settings**, sign in with `ADMIN_PASSWORD`, add an OpenAI-compatible provider, enter its API key, and either discover or add the models. The key is sent only to the same-origin admin endpoint and is never returned to the browser.

## Deploy to Vercel

1. Create or connect a Neon Postgres database. Vercel's Marketplace integration is the easiest path.
2. In Vercel Project Settings → Environment Variables, add these values for each required environment:

   - `DATABASE_URL` — Neon/Postgres connection string;
   - `CONFIG_ENCRYPTION_KEY` — exactly 32 random bytes, normally 64 hex characters (`openssl rand -hex 32`);
   - `ADMIN_PASSWORD` — long, unique administrator password;
   - `SESSION_SECRET` — random HMAC secret (`openssl rand -base64 48`).

   Mark the last three as **Sensitive** variables where that option is available. Never place provider keys in Vercel environment variables or frontend `VITE_*` variables: enter them through Settings instead.

3. Deploy the repository. [`vercel.json`](vercel.json) builds Vite, keeps `/api/*` routed to Functions, and sends all other paths to the SPA entry point.
4. Open **Settings**, sign in, and configure providers/models once. They are persisted in Postgres.

Provider CORS errors go away for model traffic because the browser talks only to its own `/api` origin; the Function calls the provider server-to-server. This does not make the admin UI public: its write endpoints require the signed, HTTP-only administrator session.

The configured 60-second Function duration is the portable Vercel baseline. Long-running streams need a Vercel plan and a corresponding `maxDuration` increase; Vercel will otherwise terminate them.

## Security notes

- API keys are AES-256-GCM encrypted at rest. Losing `CONFIG_ENCRYPTION_KEY` makes existing keys unrecoverable; changing it requires re-entering the provider keys.
- The admin session is an HTTP-only, `SameSite=Strict`, signed cookie, with an additional same-origin check for writes. Put the site behind your own identity layer if several people should administer it.
- Chat requests are limited to enabled models attached to the selected enabled provider. Browser-supplied upstream URLs and `Authorization` headers are ignored.
- The application still sends requested workspace content to whichever provider the administrator configures. Use providers you trust.

## Verification

```bash
npm run typecheck
npm test
npm run build
```

## Browser boundary

The agent can access only the folder selected in the browser. It cannot run shell commands, Git, tests, builds, native watchers, or access paths outside that folder. These remain terminal tasks outside the app.

## Project structure

```text
api/              Vercel Functions, auth, encrypted Postgres configuration
src/agent/        Pi runtime adapter and same-origin fetch guard
src/app/          React UI and provider administration
src/filesystem/   File System Access API workspace layer
src/persistence/  IndexedDB sessions/settings/workspaces (no API keys)
src/tools/        Browser-native file tools
```

Pi Webdesk uses [Pi](https://github.com/earendil-works/pi) packages from Mario Zechner and contributors. See [NOTICE.md](NOTICE.md) for attribution.
