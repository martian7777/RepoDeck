# <img src="media/icon.png" align="center" width="40" height="40" /> RepoDeck

> Initialize repositories, create/assign issues, and manage GitHub Project boards with a real interactive Kanban — without leaving your editor.

[![VS Code Extension](https://img.shields.io/visual-studio-marketplace/v/martian7777.repodeck?style=for-the-badge&logo=visual-studio-code&color=007acc)](https://marketplace.visualstudio.com/items?itemName=martian7777.repodeck)
[![Open VSX](https://img.shields.io/open-vsx/v/martian7777/repodeck?style=for-the-badge&logo=open-vsx&color=f47a22)](https://open-vsx.org/extension/martian7777/repodeck)
[![License](https://img.shields.io/github/license/martian7777/repodeck?style=for-the-badge&color=2ea44f)](LICENSE)

**RepoDeck** is a lightweight, high-performance GitHub client built directly into VS Code. It is designed to run anywhere, especially on independent editor forks (such as **Google Antigravity**, **Cursor**, **Windsurf**, and **VSCodium**) where the official GitHub extension has limited functionality, licensing restrictions, or authentication hurdles.

---

## 🔍 The Problem & The Solution

### ❌ The Problem with the Official GitHub Extension
1. **No Project Board Support**: The official extension lists issues and PRs, but completely lacks interactive project board (Kanban) support. Tracking project boards forces you to jump out of your editor into a browser tab.
2. **Proprietary & Restricted Authentication**: The official extension relies heavily on VS Code’s built-in Microsoft/GitHub authentication providers. On alternative forks (Cursor, Windsurf, VSCodium, Antigravity), this provider is often broken, locked down, or requires complex workspace logins.
3. **No Setup/Initialization Workflow**: The official extension assumes your git repository is already created, configured, and pushed to GitHub. There is no helper to take a blank local workspace directory to a live GitHub repository.
4. **Heavyweight & Capped Search API**: Large projects frequently experience rate-limiting issues because the official extension queries search endpoints that are restricted to 30 requests per minute.

### ✔️ The RepoDeck Solution
1. **Interactive Kanban, Editable Tables, & Roadmaps**: An integrated Preact-powered Project Board panel supporting drag-and-drop status changes, spreadsheet-like table edits, and Gantt-style roadmap schedules.
2. **PAT Authentication Storage**: Authenticates using the standard session manager *or* a Personal Access Token (PAT). Token storage is encrypted locally via VS Code's `SecretStorage` API, working seamlessly on all VS Code forks.
3. **Complete Local-to-Remote Initializer**: Create a repository on GitHub (under a personal or organizational account), initialize local git, set remote `origin`, create the initial commit, and push it up — all from a single click.
4. **Background Caching & List APIs**: Instantly paint UI elements from a persistent cache upon window reload, and update states in the background. Uses optimized listing endpoints (capped at a generous 5,000/hour budget) rather than search endpoints.

---

## 🛠️ Architecture & System Design

RepoDeck divides its responsibilities between a backend running in the **VS Code Extension Host** (handling authentication, local Git CLI operations, and GitHub API communication) and a frontend running inside **VS Code Webviews** (powered by Preact).

```mermaid
graph TD
    subgraph Webview Panels (Preact Frontend)
        BP["Board Panel: Board / Table / Roadmap Views"]
        IP["Issue Panel: Timeline, Comments"]
        PRP["PR Panel: Details, Reviews, CI Status"]
        FP["Form Panels: Create Issue / PR"]
    end

    subgraph VS Code Extension Host
        EH["Command Registry & Main Controller"]
        ITP["Issues Tree Data Provider"]
        PTP["PR Tree Data Provider"]
        Auth["Auth Manager (SecretStorage/Session)"]
        GitCLI["Local Git CLI Wrapper"]
    end

    subgraph GitHub API
        REST["GitHub REST API (Issues, PRs, Refs)"]
        GraphQL["GitHub GraphQL API (Projects v2, Fields)"]
    end

    subgraph Local Environment
        Workspace["Local Git Workspace Folder"]
    end

    BP <-->|VSCode postMessage| EH
    IP <-->|VSCode postMessage| EH
    PRP <-->|VSCode postMessage| EH
    FP <-->|VSCode postMessage| EH

    EH -->|Updates & Sync| ITP
    EH -->|Updates & Sync| PTP
    EH -->|Retrieve Tokens| Auth
    EH -->|Execute commands| GitCLI
    
    GitCLI <-->|Git commands| Workspace
    EH <-->|octokit.rest| REST
    EH <-->|octokit.graphql| GraphQL
```

---

## ✨ Features

### 📦 1. Repository Initializer
Take a blank workspace folder from absolute zero to a fully wired GitHub repository:
- Runs `git init` locally.
- Authenticates and prompts for owner (Personal Account or Member Organization), repository name, description, and visibility (Public/Private).
- Creates the repository on GitHub.
- Configures local `origin` tracking.
- Performs an initial commit (empty-tree supported) and pushes it to the remote default branch.

```mermaid
sequenceDiagram
    autonumber
    actor Dev as Developer
    participant RD as RepoDeck Extension
    participant Git as Local Git CLI
    participant GH as GitHub API

    Dev->>RD: Click "Initialize Repository"
    RD->>Dev: Prompt for Name, Desc, Visibility & Owner
    RD->>GH: Create Repository
    GH-->>RD: Created metadata (clone URL, default branch)
    RD->>Git: Is folder initialized? (if not: git init)
    RD->>Git: git checkout -B <default_branch>
    RD->>Git: git add -A && git commit -m "Initial commit"
    RD->>Git: git remote add origin <clone_url>
    RD->>Git: git push -u origin <default_branch>
    Git-->>RD: Push completed successfully
    RD->>Dev: Show success message & refresh sidebar
```

---

### 📋 2. Project Boards (Kanban, Tables & Roadmaps)
Manage GitHub Projects (v2) with fluid, interactive layouts that switch instantly without refetching:
- **Board Layout**: A drag-and-drop Kanban view. Column headers are sticky, and columns have independent scrollbars. Cards feature visual status indicators, title, number, and assignees.
- **Table Layout**: A powerful, keyboard-friendly spreadsheet interface to edit all project fields (single-select status, iterations, dates, numbers, text, assignees, and titles) inline.
- **Roadmap Layout**: A visual timeline arranging cards across a time axis using start-date and target-date custom fields.
- **Custom Project Creation**: Create new Projects directly from the editor, link them to the repo, define custom columns, and add custom fields.
- **Optimistic Drag-and-Drop**: Moves cards instantly on the UI, and issues a GraphQL mutation behind the scenes. If the mutation fails, RepoDeck rolls back the card automatically to maintain data consistency.

```mermaid
sequenceDiagram
    autonumber
    actor Dev as Developer
    participant Webview as Preact Kanban Board
    participant RD as Extension Host
    participant GH as GitHub GraphQL API

    Dev->>Webview: Drag & drop card to column
    Note over Webview: Optimistically update card position on board
    Webview->>RD: postMessage("moveCard", itemId, optionId)
    RD->>GH: GraphQL Mutation: updateProjectV2ItemFieldValue
    alt Success
        GH-->>RD: Item updated successfully
        Note over RD: Keep optimistic position
    else Failure (e.g. rate limit, network loss)
        GH-->>RD: Error message
        RD->>Dev: Show error toast & rollback
        RD->>GH: Re-fetch correct board status
        GH-->>RD: Return actual board JSON
        RD->>Webview: postMessage("board", board)
        Note over Webview: Snap card back to previous position
    end
```

---

### 🌿 3. "Start Working on Issue" Workflow
Automates branching directly from an issue:
- Creates and checks out a new branch locally.
- Guarantees branch creation branches from the repository's default branch (e.g. `main` or `master`) rather than whatever branch you happen to have open, preventing dirty parent-branch commits.
- Sanitizes issue titles automatically into standard branch names (e.g., `42-add-markdown-support`).

```mermaid
sequenceDiagram
    autonumber
    actor Dev as Developer
    participant RD as RepoDeck Extension
    participant Git as Local Git CLI
    participant GH as GitHub API

    Dev->>RD: Click "Start Working on Issue" on Card/Tree
    Note over RD: Sanitize issue title: "42-issue-slug"
    RD->>Dev: Prompt branch name input (prefilled with slug)
    Dev->>RD: Confirms branch name
    RD->>Git: Check for uncommitted changes (git status)
    alt Uncommitted changes found
        RD->>Dev: Modal Warning ("Carry changes over?")
        Dev->>RD: Confirms checkout
    end
    RD->>GH: Fetch default branch name
    GH-->>RD: e.g. "main"
    RD->>Git: git fetch origin main
    RD->>Git: git checkout -b <new-branch> origin/main
    alt Success
        RD-->>Dev: Show info: "On branch..."
    else Branch exists locally
        RD->>Git: git checkout <existing-branch>
        RD-->>Dev: Show info: "Switched to existing branch..."
    end
```

---

### 💬 4. Issues & Pull Requests Detail Panels
Interact with issues and PRs in rich, responsive webviews:
- **Markdown Rendering**: Issue summaries, descriptions, PR descriptions, and timeline comments render full markdown (headings, links, lists, code highlighting, tables) instead of raw text.
- **Threaded Timeline**: Pull Request and Issue detail panels show full history, comment threads, reviews, events, and automated test check statuses (CI).
- **Draft Support**: Mark draft pull requests as "Ready for Review" directly from the editor panel.
- **One-click checkout**: Click to pull and check out any pull request branch locally.
- **Direct Merges**: Merge pull requests using **Merge Commit**, **Squash and Merge**, or **Rebase and Merge** methods directly, with full confirmation prompts and an option to prune/delete the remote branch immediately after.

---

## 🔑 Authentication Setup

RepoDeck asks the host editor for a GitHub account session first. If the editor does not provide one, RepoDeck prompts you to supply a **Personal Access Token (PAT)**.

To create a PAT, go to **GitHub Settings > Developer Settings > Personal Access Tokens (Classic)**. 

### Required Token Scopes
When generating the token, ensure you check the following permissions:
- `repo` — Read/Write repository code, commit history, pull requests, issues, and git refs.
- `read:org` — List organization memberships to fetch projects and create organization repositories.
- `project` — Read/Write GitHub Projects (v2). **Without this scope, Projects will be completely inaccessible via GitHub's GraphQL API, returning empty boards.**

---

## 🛠️ Developer Guide & Contributions

### Prerequisites
- [Node.js](https://nodejs.org/) (v18+)
- [Git](https://git-scm.com/)

### Setup & Run locally
1. Clone this repository:
   ```bash
   git clone https://github.com/martian7777/repodeck.git
   cd repodeck
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run the development watcher:
   ```bash
   npm run watch
   ```
4. In VS Code, press `F5` (or click `Run and Debug` > `Run Extension`) to launch an Extension Development Host window with RepoDeck loaded.

### Available Scripts
- `npm run build` — Compile extension sources and webview modules.
- `npm run watch` — Compile and watch files for hot-reloading changes.
- `npm run typecheck` — Perform static TypeScript type verification.
- `npm run package` — Compile production bundles and compile the final `.vsix` installer.

---

*Disclaimer: RepoDeck is an independent open-source project and is not affiliated with, authorized, or endorsed by GitHub, Inc.*
