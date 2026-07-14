import * as vscode from 'vscode';
import { getOctokit } from '../auth/session';
import { describe } from '../features/initRepo';
import { readRepoState } from '../github/repoContext';
import { renderHtml } from './webviewHost';

/** The Create Issue form. */
export async function openIssueForm(
	context: vscode.ExtensionContext,
	onCreated: () => void,
): Promise<void> {
	const [state, octokit] = await Promise.all([readRepoState(), getOctokit(context)]);
	if (!octokit) {
		return;
	}
	if (!state.ref) {
		vscode.window.showErrorMessage(
			'RepoDeck: no GitHub remote for this folder. Run "RepoDeck: Initialize Repository" first.',
		);
		return;
	}
	const ref = state.ref;

	const panel = vscode.window.createWebviewPanel(
		'repodeck.issueForm',
		'New Issue',
		vscode.ViewColumn.Active,
		{
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
		},
	);
	panel.webview.html = renderHtml(panel.webview, context.extensionUri, 'form', 'New Issue');

	panel.webview.onDidReceiveMessage(async (msg) => {
		switch (msg?.type) {
			case 'ready': {
				// Assignees and labels are repo-specific, so the form can't be static.
				const [collaborators, labels] = await Promise.all([
					octokit.rest.repos
						.listCollaborators({ ...ref, per_page: 100 })
						.then((r) => r.data.map((c) => c.login))
						.catch(() => []),
					octokit.rest.issues
						.listLabelsForRepo({ ...ref, per_page: 100 })
						.then((r) => r.data.map((l) => ({ name: l.name, color: l.color })))
						.catch(() => []),
				]);
				panel.webview.postMessage({
					type: 'init',
					repo: `${ref.owner}/${ref.repo}`,
					collaborators,
					labels,
				});
				return;
			}

			case 'submit': {
				try {
					const { data } = await octokit.rest.issues.create({
						...ref,
						title: msg.title,
						body: msg.body || undefined,
						assignees: msg.assignees ?? [],
						labels: msg.labels ?? [],
					});
					panel.dispose();
					onCreated();

					const OPEN = 'Open on GitHub';
					const choice = await vscode.window.showInformationMessage(
						`RepoDeck: created #${data.number}.`,
						OPEN,
					);
					if (choice === OPEN) {
						await vscode.env.openExternal(vscode.Uri.parse(data.html_url));
					}
				} catch (err) {
					panel.webview.postMessage({ type: 'error', message: describe(err) });
				}
				return;
			}

			case 'cancel':
				panel.dispose();
				return;
		}
	});
}
