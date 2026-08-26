# Architecture

Pi Webdesk is a static, browser-only coding agent. The application runs in the user's desktop browser, talks directly to an OpenAI-compatible API, and accesses only the local folder the user selects through the File System Access API.

There is no application backend, WebSocket layer, shell, database server, or local daemon.

## System overview

```text
Static HTTPS host
        │
        ▼
Desktop Chrome / Edge
├── React UI
├── Pi agent runtime
│   ├── @earendil-works/pi-agent-core
│   └── @earendil-works/pi-ai
├── OpenAI-compatible adapter
│   └── fetch + streaming Chat Completions
├── BrowserWorkspace
│   └── File System Access API
├── Browser-native tools
│   ├── read / ls / find / grep
│   └── edit / write / apply_patch / delete
└── IndexedDB + localStorage
    ├── provider settings
    ├── sessions and transcripts
    └── saved directory handles
```

The production output is a static Vite bundle. After deployment, the only remote service the app needs is the provider endpoint configured by the user.

## Request flow

```text
1. User selects a folder
   └─ BrowserWorkspace stores its FileSystemDirectoryHandle
2. User writes a prompt
   └─ App creates or restores a session
3. Pi agent builds the request
   └─ createModel() + createStreamFunction()
4. Browser sends the request directly to the provider
   └─ OpenAI-compatible /chat/completions with streaming enabled
5. Provider returns assistant text and/or tool calls
   └─ Pi agent dispatches calls to browser-native tools
6. Tools validate relative paths and use the selected directory handle
   └─ read/search results or file changes return to the agent
7. UI renders the transcript and tool activity
   └─ the session snapshot is saved to IndexedDB
```

Model discovery and the **Check API** action use the provider's `/models` endpoint. Provider URLs are normalized and restricted so requests cannot escape the configured origin and base path.

## Main layers

| Layer | Responsibility | Main modules |
| --- | --- | --- |
| UI and state | Layout, composer, sessions, settings, workspace inspector, themes | `src/app/App.tsx`, `src/app/state.ts` |
| Pi integration | Agent lifecycle, model definition, streaming adapter, system prompt | `src/agent/` |
| Workspace | Folder selection, permissions, traversal, text reads, path validation | `src/filesystem/` |
| Tools | Agent-callable read and write operations | `src/tools/` |
| Persistence | IndexedDB schema, migrations, settings, sessions, saved workspaces | `src/persistence/` |
| Search worker | Keeps larger workspace searches off the UI thread | `src/workers/search.worker.ts` |

## Pi integration

The agent lifecycle is owned by `PiWebdeskAgent`. It wraps Pi's `Agent`, supplies a browser-specific system prompt and browser-native tools, and connects Pi's OpenAI Completions stream adapter to a guarded browser `fetch` implementation.

Pi Webdesk is based on the original [Pi project](https://github.com/earendil-works/pi). It uses the published `@earendil-works/pi-agent-core` and `@earendil-works/pi-ai` packages, while replacing Pi's native workspace/process assumptions with browser capabilities.

## Workspace and tool boundary

`BrowserWorkspace` is the only filesystem abstraction exposed to the tools. It receives a `FileSystemDirectoryHandle` from `showDirectoryPicker({ mode: "readwrite" })` and resolves paths relative to that directory.

The tools are split into two groups:

- Read tools: `read`, `ls`, `find`, and `grep`.
- Write tools: `edit`, `write`, `apply_patch`, and `delete`.

The selected access mode controls which tools are registered and whether write operations need confirmation:

| Mode | Runtime behavior |
| --- | --- |
| `read` | Registers read tools only. |
| `confirm` | Registers all tools and asks before each write operation. |
| `write` | Registers all tools and applies writes immediately. |

Paths are normalized before access. The workspace root cannot be deleted, and text reads are bounded to the configured file-size limit in the filesystem layer.

## Persistence

IndexedDB stores:

- provider settings and selected models;
- session metadata and Pi message transcripts;
- saved `FileSystemDirectoryHandle` records.

The browser may require permission to be granted again when a saved workspace is reopened. API keys are removed from the persisted settings unless the provider's **Remember** option is enabled.

`localStorage` stores UI-only preferences such as theme, sidebar width, and the selected workspace access mode.

## Security model

- The app has no server that receives API keys or workspace data.
- Requests are sent only to the configured provider origin and base path.
- A provider must explicitly allow the deployed app origin through CORS.
- Folder contents are not uploaded during folder selection; file content leaves the browser only as part of a provider request made for the agent task.
- The agent cannot access arbitrary absolute paths, the rest of the filesystem, or local processes.
- HTTPS deployment is required when the provider uses HTTPS; the browser blocks mixed-content API calls.

This is a browser permission boundary, not a sandbox for untrusted providers. Users should only configure providers they trust with the files they ask the agent to inspect.

## Deliberate non-goals

The architecture intentionally does not support:

- shell commands or arbitrary local processes;
- Git, test runners, compilers, or build commands from inside the app;
- native file watching;
- background work after the page is closed;
- arbitrary paths outside the selected workspace;
- bypassing provider CORS or browser permission policies.

Those capabilities would require a separate local or hosted backend and are outside the browser-only product boundary.

## Deployment assumptions

The app is built with the npm scripts in `package.json` and deployed as the contents of `dist/` to a static HTTPS host. The target browser is desktop Chrome or Edge 120+ because the workspace picker depends on `showDirectoryPicker()`.
