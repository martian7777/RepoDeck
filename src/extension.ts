import * as vscode from 'vscode';
import { getOctokit, onDidChangeAuthentication, signOut } from './auth/session';
import { initRepo, describe } from './features/initRepo';
import { checkoutPull, closePullRequest, mergePullRequest } from './features/pullRequests';
import { addIssueToProject } from './github/graphql';
import { refreshRepoContext } from './github/repoContext';
import type { PullSummary } from './github/prs';
import { openBoard, activeProjectId, refreshBoard } from './views/boardPanel';
import { openIssueForm, openPullForm } from './views/formPanel';
import { IssuesTreeProvider, type IssueItem } from './views/issuesTree';
import { PullsTreeProvider } from './views/prTree';
import { openPullPanel } from './views/prPanel';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	const issues = new IssuesTreeProvider(context);
	const pulls = new PullsTreeProvider(context);

	const refreshAll = () => {
		issues.refresh();
		pulls.refresh();
	};

	context.subscriptions.push(
		vscode.window.createTreeView('repodeck.issues', { treeDataProvider: issues }),
		vscode.window.createTreeView('repodeck.pulls', { treeDataProvider: pulls }),
		onDidChangeAuthentication(refreshAll),

		vscode.commands.registerCommand('repodeck.signIn', async () => {
			if (await getOctokit(context)) {
				await refreshRepoContext();
				refreshAll();
			}
		}),

		vscode.commands.registerCommand('repodeck.signOut', () => signOut(context)),

		vscode.commands.registerCommand('repodeck.initRepo', async () => {
			await initRepo(context);
			refreshAll();
		}),

		// ---- Issues ----

		vscode.commands.registerCommand('repodeck.createIssue', () =>
			openIssueForm(context, () => issues.refresh()),
		),

		vscode.commands.registerCommand('repodeck.refreshIssues', async () => {
			await refreshRepoContext();
			issues.refresh();
		}),

		vscode.commands.registerCommand('repodeck.openIssue', (issue: IssueItem) =>
			vscode.env.openExternal(vscode.Uri.parse(issue.url)),
		),

		vscode.commands.registerCommand('repodeck.addIssueToBoard', async (issue: IssueItem) => {
			const octokit = await getOctokit(context);
			if (!octokit) {
				return;
			}

			// Reuse whichever project the board is already on; otherwise opening the board
			// is what makes the user pick one.
			let projectId = activeProjectId();
			if (!projectId) {
				await openBoard(context);
				projectId = activeProjectId();
			}
			if (!projectId) {
				return;
			}

			try {
				await addIssueToProject(octokit, projectId, issue.nodeId);
				await refreshBoard(context);
				vscode.window.showInformationMessage(`RepoDeck: added #${issue.number} to the board.`);
			} catch (err) {
				vscode.window.showErrorMessage(`RepoDeck: couldn't add that issue. ${describe(err)}`);
			}
		}),

		// ---- Pull requests ----

		vscode.commands.registerCommand('repodeck.createPr', () =>
			openPullForm(context, () => pulls.refresh()),
		),

		vscode.commands.registerCommand('repodeck.refreshPulls', async () => {
			await refreshRepoContext();
			pulls.refresh();
		}),

		vscode.commands.registerCommand('repodeck.openPr', (pull: PullSummary) =>
			openPullPanel(context, pull.number, () => pulls.refresh()),
		),

		vscode.commands.registerCommand('repodeck.checkoutPr', (pull: PullSummary) =>
			checkoutPull(context, pull.number),
		),

		vscode.commands.registerCommand('repodeck.mergePr', async (pull: PullSummary) => {
			if (await mergePullRequest(context, pull.number)) {
				pulls.refresh();
			}
		}),

		vscode.commands.registerCommand('repodeck.closePr', async (pull: PullSummary) => {
			if (await closePullRequest(context, pull.number, 'closed')) {
				pulls.refresh();
			}
		}),

		// ---- Board ----

		vscode.commands.registerCommand('repodeck.openBoard', () => openBoard(context)),
	);

	// Seed `repodeck:hasRepo` so the welcome view is right on first paint, and try a
	// silent sign-in so a returning user doesn't get prompted on every window.
	await refreshRepoContext();
	await getOctokit(context, false);
	refreshAll();
}

export function deactivate(): void {}
