# RepoDeck

GitHub issues, pull requests, and **real project boards** inside your editor — including
editors that can't run the official GitHub extension.

Works in **VS Code** and in VS Code forks such as **Google Antigravity**, **Cursor**, and
**Windsurf** (published to Open VSX as well as the VS Code Marketplace).

## Features

- **Initialize Repository** — takes an empty folder from nothing to a pushed GitHub repo:
  `git init`, creates the repo under your account or an org, sets `origin`, makes the first
  commit, and pushes.
- **Issues** — a sidebar tree (Assigned to Me / Created by Me / All Open) and a real form
  for creating issues with a markdown body, assignees, and labels.
- **Pull requests** — a sidebar tree (Waiting for My Review / Assigned / Created / All Open),
  a create form that pushes your branch for you, and a detail view with the description,
  CI checks, and the full conversation. Approve or request changes, check the PR out
  locally, and merge by merge commit, squash, or rebase.
- **Project board** — a drag-and-drop kanban over a GitHub Project. Drag a card to change
  its status; add any repo issue to the board from the sidebar.

## Roadmap

- **v0.3** — board authoring: create projects, custom fields, draft items, iterations.
- **Later** — inline review comments on the diff.

## Signing in

RepoDeck asks your editor for a GitHub account first. If your editor doesn't provide one —
which is common in forks — it will offer to open GitHub so you can create a personal access
token, then store it in your editor's encrypted secret storage.

The token needs **`repo`**, **`read:org`**, and **`project`** scopes. The `project` scope is
the one people miss: without it, GitHub's API returns nothing for boards, because Projects
are only reachable over GraphQL and `repo` does not cover them.

## Notes

GitHub Projects belong to a **user or an organization**, not to a repository, so RepoDeck
asks you to pick an owner and a project the first time you open the board. It remembers your
choice per workspace.

A board column is a value of a single-select field (usually called `Status`). If a project
has no single-select field, it has no columns — RepoDeck will tell you rather than showing
an empty screen.

---

Not affiliated with GitHub, Inc.
