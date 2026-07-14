# Troubleshooting & FAQ

This page documents common issues, error messages, and questions encountered while using RepoDeck.

---

## 1. Authentication Problems

### Issue: "RepoDeck: couldn't read projects for <owner>. Your token probably lacks the 'project' scope."
- **Why this happens**: When you authenticate with a Personal Access Token (PAT), you might only select the standard `repo` scope. Since GitHub Projects v2 live on the organizational/user level (not inside the git repository itself), the Project Board queries use the GraphQL API. These queries require the explicit **`project`** scope.
- **The fix**:
  1. Go to your [GitHub Personal Access Token Settings](https://github.com/settings/tokens).
  2. Edit your active token or generate a new one.
  3. Ensure **`project`**, **`repo`**, and **`read:org`** are checked.
  4. In VS Code, run the command `RepoDeck: Sign out` from the Command Palette.
  5. Click `Sign in` and paste the updated token.

### Issue: Secret Storage issues on Linux / VSCodium forks
- **Why this happens**: VS Code forks use keychains to save user details. In environments without a keyring daemon (like headless servers or custom Linux installs), VS Code's `SecretStorage` falls back to an unencrypted text file or fails.
- **The fix**: Ensure a keyring (such as `gnome-keyring` or `kwallet`) is installed and configured, or use the standard browser sign-in route if supported by the editor's OS build.

---

## 2. Project Board Errors

### Issue: "No single-select field..." (`NoBoardFieldError`)
- **Why this happens**: RepoDeck needs to know how to group cards into board columns. A board column in GitHub Projects v2 is actually just one choice inside a single-select custom field (by default, a field named `Status`). If a project has no single-select fields, RepoDeck cannot render columns.
- **The fix**: Go to GitHub.com, open the project, and add a single-select field (e.g., named `Status`) containing column options (e.g., "Todo", "In Progress", "Done"). Reload the project board in RepoDeck.

### Issue: Deleting a column warns that cards will fall into "No Status"
- **Why this happens**: Deleting a column in GitHub Projects v2 does not delete a container — it deletes a single-select option value. When the option is deleted, all cards that had that status lose it, and they default back to having "No Status".
- **The fix**: RepoDeck warns you about how many cards are affected before you confirm. You can safely let them fall to the "No Status" tray or assign them a different status before deleting the column.

---

## 3. GitHub API Limitations

### Question: Why can't I edit Iteration fields in the Table layout?
- **Answer**: The GitHub GraphQL API does not allow creating or editing **Iteration** fields programmatically at this time. Iteration fields can only be set or adjusted directly on github.com. RepoDeck will display a warning dialog rather than failing silently if you try to mutate an iteration cell.

### Issue: Slow refreshes or API Rate Limits
- **Why this happens**: The GitHub REST Search API has a strict limit of 30 queries per minute, which is easily exhausted when rendering sidebar trees.
- **The fix**: RepoDeck v0.9.0 was redesigned to avoid Search endpoints. It uses standard listing endpoints that draw from GitHub's 5,000 requests/hour budget, resolving rate-limiting issues for heavy users.

---

## 4. Git Workspaces

### Issue: "Start Working on Issue" checkout fails
- **Why this happens**: If you have uncommitted modifications in files that would be overwritten by checking out the remote default branch, Git blocks the switch.
- **The fix**: Commit your changes, stash them (`git stash`), or allow RepoDeck to carry them onto the new branch by accepting the warnings.
