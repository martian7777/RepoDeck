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
- **Project boards** — create a project, link it to the repo, and work it as a
  drag-and-drop kanban. Add, rename, recolour, and delete columns. Add draft items and
  promote them into real issues. Create custom fields (text, number, date, single-select),
  and group the board by any single-select field you like.

## Roadmap

- **Later** — inline review comments on the diff.

## Two things GitHub's API won't let anyone do

**Iteration fields cannot be created or edited through the API** — only on github.com.
RepoDeck will say so rather than failing quietly. Existing iteration fields still work.

**Deleting a column deletes a value, not a container.** A board column is one option of a
single-select field, so removing it strips that value from every card that held it; the
cards stay on the board and fall into the "No Status" tray. RepoDeck tells you how many
cards that affects before you confirm.

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
