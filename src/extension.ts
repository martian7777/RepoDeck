import * as vscode from 'vscode';
import { getOctokit, onDidChangeAuthentication, signOut } from './auth/session';
import { initRepo, describe } from './features/initRepo';
import { addIssueToProject } from './github/graphql';
import { refreshRepoContext } from './github/repoContext';
import { openBoard, activeProjectId, refreshBoard } from './views/boardPanel';
import { openIssueForm } from './views/formPanel';
import { IssuesTreeProvider, type IssueItem } from './views/issuesTree';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	const issues = new IssuesTreeProvider(context);

	context.subscriptions.push(
		vscode.window.createTreeView('repodeck.issues', { treeDataProvider: issues }),
		onDidChangeAuthentication(() => issues.refresh()),

		vscode.commands.registerCommand('repodeck.signIn', async () => {
			if (await getOctokit(context)) {
				await refreshRepoContext();
				issues.refresh();
			}
		}),

		vscode.commands.registerCommand('repodeck.signOut', () => signOut(context)),

		vscode.commands.registerCommand('repodeck.initRepo', async () => {
			await initRepo(context);
			issues.refresh();
		}),

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

		vscode.commands.registerCommand('repodeck.openBoard', () => openBoard(context)),

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
	);

	// Seed `repodeck:hasRepo` so the welcome view is right on first paint, and try a
	// silent sign-in so a returning user doesn't get prompted on every window.
	await refreshRepoContext();
	await getOctokit(context, false);
	issues.refresh();
}

export function deactivate(): void {}
