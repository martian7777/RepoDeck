# Changelog

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
