# Changelog

## 0.9.7

- New **Discussions** sidebar view, grouped by the repository's own categories the way
  github.com groups them, with the accepted-answer state on the icon.
- A **discussion panel** with the full conversation: top-level comments with their replies
  indented underneath and a **Reply** box on each thread — one level deep, which is all
  GitHub allows.
- Discussion comments carry the same **⋯ menu** as issues and pull requests — copy link,
  copy Markdown, quote reply, edit in place — and the same Write/Preview Markdown editor.
  Quoting inside a thread lands in that thread's reply box rather than the main composer.
- **Upvote** the opening post or any comment, **mark a comment as the answer** in Q&A
  categories, and **close, reopen, rename or re-categorise** a discussion.
- **New Discussion** from the view title, with a category picker.
- Discussions has no REST API, so the whole feature is GraphQL. A repository with
  Discussions turned off shows a note in the view instead of an error.

## 0.9.6

- The **pull request panel** now matches the GitHub conversation view: a threaded timeline
  with avatars, relative timestamps and events, a `Conversation` / `Commits` tab strip, and
  a sidebar for reviewers, assignees, labels, projects, milestone and participants.
- Checks are grouped and described the way GitHub describes them — "2 queued, 2 successful
  checks", "Successful in 53s", "Queued — Waiting to run this check…" — with a link through
  to each run.
- A merge box reports conflicts with the base branch and carries the merge method, check
  out, close, and convert to draft / ready for review.
- Comment boxes on issues **and** pull requests are a real editor: **Write** and **Preview**
  tabs and a formatting toolbar (heading, bold, italic, quote, code, link, lists, task
  list, mention, reference). Undo still works — the toolbar types into the box rather than
  replacing its contents.
- Every description and comment has a **⋯ menu**: copy link, copy Markdown, quote reply,
  and edit in place. Edit appears on your own comments.
- Avatars are the real ones from GitHub rather than a letter placeholder.

## 0.9.5

- New **GitHub Actions** sidebar view: browse workflow runs for the current branch and per
  workflow, and drill into jobs and their steps with live status icons.
- Open any run or job on GitHub, and re-run or cancel runs from the tree.
- Manage Actions **Secrets** and **Variables** at both repository and environment scope —
  add, update, and delete. Secret values are encrypted client-side (libsodium sealed box)
  before upload, so plaintext never leaves your machine.

## 0.9.4

- Add contributing guide (`CONTRIBUTING.md`).
- Update README to link to the new contributing guide and reference the new GitHub Discussions board.

## 0.9.0

- Sidebar refreshes no longer use GitHub's search API, which is capped at 30 requests a
  minute. One list call now serves every issue category and one serves every pull request
  category, against a 5,000/hour budget.
- Rate limits and transient failures are retried with backoff instead of failing a panel.
- Issue and pull request bodies and comments render **markdown** — headings, links, lists
  and code blocks — instead of raw text.
- Filter box on the board and table; sortable table columns.
- The table only renders the rows in view, so large projects stay smooth.
- Caches survive a window reload, so reopening a board or issue paints instantly.
- Draft pull requests can be marked ready for review.
- "Start working on issue" creates and checks out a branch from an issue.

## 0.8.0

- Switching between Table, Board and Roadmap is instant — it no longer refetches the project.
- Panels paint from cache immediately and refresh in the background.
- Rebuilt the board: full-height columns with their own scrollbars, sticky headers, a
  toolbar that no longer overlaps itself, and cards that stay inside their column.

## 0.7.0

- **Table**, **Board** and **Roadmap** layouts for project boards.
- The table is fully editable: single-select, iteration, date, number, text, assignees, title.
- The roadmap places items on a time axis from a start and target date field.
- Projects load every item (up to 1000) rather than only the first 100.

## 0.6.0

- Clicking a card on the board opens the issue in the editor.
- Issue view rebuilt with a threaded timeline of comments and events.

## 0.5.0

- Board columns show their colour and description; cards show labels.
- Add existing issues or draft items to a column.

## 0.4.0

- Issues open in an editor panel with a Projects section: add to a project, change status,
  remove from a project.

## 0.3.0

- Project board authoring: create projects, add/rename/recolour/delete columns, custom
  fields, draft items.

## 0.2.0

- Pull requests: list, create, check out, review, and merge (merge / squash / rebase).

## 0.1.0

- Initialize a repository, create and assign issues, and drag cards on a GitHub Project board.
