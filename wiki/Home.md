# RepoDeck Wiki

Welcome to the **RepoDeck** wiki! RepoDeck is a lightweight, high-performance GitHub client built directly into VS Code and designed to support alternative editor forks (such as Google Antigravity, Cursor, Windsurf, VSCodium, etc.) by bridging the gaps in standard GitHub integration.

RepoDeck provides:
- **Interactive Project Boards (v2)**: Support for Kanban (Board), spreadsheet (Table), and Gantt-style (Roadmap) views.
- **Robust Authentication**: Session integration or Personal Access Tokens (PAT) stored securely in `SecretStorage`.
- **Developer Workflows**: One-click repository initializer and automated issue-to-branch setup ("Start Working on Issue").
- **Performant Detail Panels**: Fast loading via local caching and rich markdown rendering for issue/PR descriptions, comments, and events.

---

## 📖 Wiki Sections

Explore the documentation sections to learn more about using and developing RepoDeck:

### 🌟 [Features & Capabilities](Features.md)
Learn about the core capabilities of RepoDeck, including the repo initializer, interactive Kanban boards, inline editable tables, timeline views, and branch generation.

### 🏗️ [Architecture & Technical Design](Architecture.md)
Deep dive into the extension codebase. Understand the relationship between the VS Code Extension Host (backend) and Preact Webviews (frontend), state management, caching systems, and GraphQL vs REST APIs.

### 💻 [Developer & Contributor Guide](Developer-Guide.md)
Find instructions on setting up your local development workspace, compiling sources, launching debug sessions, running type-checks, packaging vsix bundles, and coding guidelines.

### ❓ [Troubleshooting & FAQ](Troubleshooting-&-FAQ.md)
Solve common issues such as missing token scopes, Project Board error states, API rate limit exhaustion, and fork-specific configurations.

---

## 🚀 Quick Start for Users

1. Install RepoDeck from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=martian7777.repodeck) or [Open VSX Registry](https://open-vsx.org/extension/martian7777/repodeck).
2. Open a folder in VS Code.
3. Open the **RepoDeck** sidebar tab (represented by a custom icon in the Activity Bar).
4. Click **Sign in to GitHub** (or trigger `RepoDeck: Sign in to GitHub` from the command palette).
5. If your editor is a fork and cannot automatically sign you in, create a Personal Access Token (PAT) with `repo`, `read:org`, and `project` scopes, and paste it into the prompt.
6. Open your project board via **Open Project Board**!
