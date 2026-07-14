import * as vscode from 'vscode';
import { getOctokit, onDidChangeAuthentication, signOut } from './auth/session';
import { initRepo, describe } from './features/initRepo';
import {
	checkoutPull,
	closePullRequest,
	mergePullRequest,
	readyForReview,
	startWorkOnIssue,
} from './features/pullRequests';
import { createProjectCommand } from './features/createProject';
import { addIssueToProject } from './github/graphql';
import { refreshRepoContext } from './github/repoContext';
import type { PullSummary } from './github/prs';
import { openBoard, activeProjectId, refreshBoard, setActiveProject } from './views/boardPanel';
import { openIssueForm, openPullForm } from './views/formPanel';
import { IssuesTreeProvider, toIssue, type IssueItem } from './views/issuesTree';
import { openIssuePanel } from './views/issuePanel';
import { PullsTreeProvider, toPull } from './views/prTree';
import { openPullPanel } from './views/prPanel';

/** A view/item command is invoked with the tree element; a row click with the payload. */
type IssueArg = IssueItem | { issue: IssueItem };
type PullArg = PullSummary | { pull: PullSummary };

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

		vscode.commands.registerCommand('repodeck.openIssue', (arg: IssueArg) =>
			openIssuePanel(context, toIssue(arg).number, () => issues.refresh()),
		),

		vscode.commands.registerCommand('repodeck.openIssueOnGitHub', (arg: IssueArg) =>
			vscode.env.openExternal(vscode.Uri.parse(toIssue(arg).url)),
		),

		vscode.commands.registerCommand('repodeck.addIssueToBoard', async (arg: IssueArg) => {
			const issue = toIssue(arg);
			const octokit = await getOctokit(context);
			if (!octokit) {
				return;
			}
			if (!issue?.nodeId) {
				// GraphQL reports this as "Variable $contentId ... invalid value", which
				// says nothing about what actually went wrong.
				vscode.window.showErrorMessage('RepoDeck: that issue has no GitHub node id. Refresh the Issues view.');
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

		vscode.commands.registerCommand('repodeck.openPr', (arg: PullArg) =>
			openPullPanel(context, toPull(arg).number, () => pulls.refresh()),
		),

		vscode.commands.registerCommand('repodeck.checkoutPr', (arg: PullArg) =>
			checkoutPull(context, toPull(arg).number),
		),

		vscode.commands.registerCommand('repodeck.mergePr', async (arg: PullArg) => {
			if (await mergePullRequest(context, toPull(arg).number)) {
				pulls.refresh();
			}
		}),

		vscode.commands.registerCommand('repodeck.closePr', async (arg: PullArg) => {
			if (await closePullRequest(context, toPull(arg).number, 'closed')) {
				pulls.refresh();
			}
		}),

		vscode.commands.registerCommand('repodeck.readyForReview', async (arg: PullArg) => {
			if (await readyForReview(context, toPull(arg).number)) {
				pulls.refresh();
			}
		}),

		vscode.commands.registerCommand('repodeck.startWorkOnIssue', (arg: IssueArg) =>
			startWorkOnIssue(context, toIssue(arg)),
		),

		// ---- Board ----

		vscode.commands.registerCommand('repodeck.openBoard', () => openBoard(context)),

		vscode.commands.registerCommand('repodeck.createProject', async () => {
			const id = await createProjectCommand(context);
			if (id) {
				setActiveProject(id);
				await openBoard(context);
			}
		}),
	);

	// Seed `repodeck:hasRepo` so the welcome view is right on first paint, and try a
	// silent sign-in so a returning user doesn't get prompted on every window.
	await refreshRepoContext();
	await getOctokit(context, false);
	refreshAll();
}

export function deactivate(): void {}
