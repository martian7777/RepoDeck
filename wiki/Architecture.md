# Architecture & Technical Design

This document details the architectural layout, core design decisions, and system protocols governing the RepoDeck extension.

---

## 1. Directory Structure

The project code is divided into extension host-level TypeScript and front-end Preact/TypeScript webviews:

```text
├── .vscode/               # VS Code launch & settings configurations
├── dist/                  # Compiled production bundles
├── esbuild.mjs            # Build script configuring bundles for extension & webviews
├── media/                 # Static assets (icons, styles)
├── src/                   # Backend Extension Code
│   ├── auth/              # GitHub Authentication handlers & SecretStorage storage
│   ├── features/          # Core command workflows (initRepo, pullRequests, createProject)
│   ├── github/            # API Clients (REST & GraphQL query structures)
│   └── views/             # VS Code TreeDataProvider and Webview panel hosts
├── webview/               # Frontend Preact Code
│   ├── board/             # Kanban board view component (main.tsx)
│   ├── form/              # Issue and PR creation forms
│   ├── issue/             # Issue detail and comment timeline view
│   ├── pr/                # PR detail, CI checks, and checkout/merge panel
│   └── shared/            # Common UI elements and utilities
└── package.json           # Extension manifests, commands, and contributions
```

---

## 2. Backend vs. Frontend Split

RepoDeck operates a strict client-server architecture inside VS Code:

- **Extension Host (Backend Server)**:
  - Runs in a secure node process.
  - Accesses OS APIs, file systems, local `.git` CLI binaries, and native encryption.
  - Controls authentication sessions and stores credentials safely via `SecretStorage`.
  - Performs network communications using Octokit (REST) and GraphQL queries.
- **Webviews (Frontend Client)**:
  - Runs in isolated sandboxed iframe elements (HTML/CSS/JS).
  - Uses Preact for UI reactive state management.
  - Stylized with vanilla CSS to match VS Code dark, light, and high-contrast themes.
  - Disallowed from making direct network calls or accessing local files.

---

## 3. Communication Protocol (IPC)

The Extension Host and Webviews communicate asynchronously using VS Code's `postMessage` API. Below is the list of messages passed:

### Frontend to Backend Messages
- `{ type: 'ready' }` - Sent by the webview when it finishes loading and is ready to receive data.
- `{ type: 'refresh' }` - Triggers a background fetch to reload data.
- `{ type: 'changeProject' }` - Clears the workspace's default project board configuration and prompts selection.
- `{ type: 'moveCard', itemId, fieldId, optionId }` - Signals that a Kanban card was dragged into a column.
- `{ type: 'openCard', url }` - Asks the host to open an issue or PR link in the default browser.

### Backend to Frontend Messages
- `{ type: 'loading' }` - Sets the webview into a loading/spinner state.
- `{ type: 'board', board }` - Delivers the Project Board data payload.
- `{ type: 'error', message }` - Communicates an error status to render in place of the UI.

---

## 4. API Strategy: GraphQL vs. REST

GitHub organizes its resources across two main endpoints. RepoDeck strategically uses both:

### GraphQL API
- **Used for**: GitHub Projects v2 (`project` scope required).
- **Rationale**: GitHub Projects v2 has **no REST API**. All operations (listing projects, retrieving card details, editing custom fields, moving cards, and adding items) must be performed via GraphQL.
- **Operations**:
  - `listProjects`: Fetch user/org project summaries.
  - `fetchBoard`: Fetch project schemas (fields, columns) and up to 1,000 project items.
  - `moveCard`: Mutation updating status options.
  - `addIssueToProject`: Mutation associating issues to boards.

### REST API
- **Used for**: Repository management, Issues, Pull Requests, comments, checks, and Git references.
- **Rationale**: The REST API is highly optimized for traditional operations and does not require complex schemas. It is well-documented and has built-in retry/throttling support.
- **Operations**:
  - `octokit.rest.repos.createInOrg` / `createForAuthenticatedUser`
  - `octokit.rest.pulls.get` / `merge` / `update`
  - `octokit.rest.issues.create` / `get` / `createComment`

---

## 5. Performance & Caching

To ensure the extension feels native and instant, RepoDeck implements a caching mechanism:
- **Instant Paint**: The board and detail views paint cached JSON payloads immediately when launched, ensuring the developer doesn't wait on network requests.
- **Background Fetch**: Once the cached UI renders, RepoDeck triggers a background request to fetch fresh data and silently updates the UI.
- **Persistent Storage**: Caches are stored in VS Code's workspace-level `mementos`, surviving window reloads.
