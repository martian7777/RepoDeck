import * as vscode from 'vscode';
import { getLogin, getOctokit } from '../auth/session';
import { describe } from '../features/initRepo';
import {
	commentOnIssue,
	fetchIssue,
	setIssueState,
	updateBody,
	updateComment,
	type IssueDetail,
} from '../github/issues';
import { readRepoState } from '../github/repoContext';
import {
	addToProject,
	editAssignees,
	editLabels,
	editMilestone,
	removeFromProject,
	setProjectStatus,
	type SidebarContext,
} from './sidebarActions';
import { onPanelMessage, renderHtml } from './webviewHost';

const panels = new Map<number, vscode.WebviewPanel>();

/** Last-known detail per issue, so reopening one paints instantly. */
const cache = new Map<number, IssueDetail>();

export async function openIssuePanel(
	context: vscode.ExtensionContext,
	number: number,
	onChanged: () => void,
): Promise<void> {
	const existing = panels.get(number);
	if (existing) {
		existing.reveal();
		return;
	}

	const octokit = await getOctokit(context);
	if (!octokit) {
		return;
	}

	const panel = vscode.window.createWebviewPanel(
		'repodeck.issue',
		`Issue #${number}`,
		vscode.ViewColumn.Active,
		{
			enableScripts: true,
			retainContextWhenHidden: true,
			localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
		},
	);
	panel.webview.html = renderHtml(panel.webview, context.extensionUri, 'issue', `Issue #${number}`);
	panels.set(number, panel);
	panel.onDidDispose(() => panels.delete(number));

	const push = async () => {
		const state = await readRepoState();
		const client = await getOctokit(context, false);
		if (!state.ref || !client) {
			return;
		}
		const repo = `${state.ref.owner}/${state.ref.repo}`;
		const viewer = getLogin() ?? '';

		const cached = cache.get(number);
		if (cached) {
			panel.title = `#${cached.number} ${cached.title}`;
			panel.webview.postMessage({ type: 'issue', issue: cached, repo, viewer });
		}

		panel.webview.postMessage({ type: 'loading' });
		try {
			const issue = await fetchIssue(client, state.ref, number);
			cache.set(number, issue);
			panel.title = `#${issue.number} ${issue.title}`;
			panel.webview.postMessage({ type: 'issue', issue, repo, viewer });
		} catch (err) {
			if (!cached) {
				panel.webview.postMessage({ type: 'error', message: describe(err) });
			}
		}
	};

	onPanelMessage(panel, async (msg) => {
		const state = await readRepoState();
		const client = await getOctokit(context, false);
		if (!state.ref || !client) {
			return;
		}
		const ref = state.ref;
		const sidebar: SidebarContext = { context, client, ref, number };

		switch (msg?.type) {
			case 'ready':
			case 'refresh':
				await push();
				return;

			case 'comment':
				if (msg.body?.trim()) {
					await commentOnIssue(client, ref, number, msg.body);
					await push();
				}
				return;

			case 'setState':
				await setIssueState(client, ref, number, msg.state);
				await push();
				onChanged();
				return;

			case 'openExternal':
				await vscode.env.openExternal(vscode.Uri.parse(msg.url));
				return;

			// ---- Comment actions ----

			case 'copyLink':
				await vscode.env.clipboard.writeText(msg.url);
				vscode.window.setStatusBarMessage('RepoDeck: link copied.', 2000);
				return;

			case 'copyMarkdown':
				await vscode.env.clipboard.writeText(msg.body ?? '');
				vscode.window.setStatusBarMessage('RepoDeck: Markdown copied.', 2000);
				return;

			case 'editComment':
				if (typeof msg.id === 'number') {
					await updateComment(client, ref, msg.id, msg.body ?? '');
					await push();
				}
				return;

			case 'editBody':
				await updateBody(client, ref, number, msg.body ?? '');
				await push();
				onChanged();
				return;

			// ---- Sidebar edits ----

			case 'editAssignees':
				if (await editAssignees(sidebar, msg.current ?? [])) {
					await push();
					onChanged();
				}
				return;

			case 'editLabels':
				if (await editLabels(sidebar, msg.current ?? [])) {
					await push();
					onChanged();
				}
				return;

			case 'editMilestone':
				if (await editMilestone(sidebar)) {
					await push();
				}
				return;

			// ---- Projects ----

			case 'addToProject':
				if (await addToProject(sidebar, msg.nodeId, msg.current ?? [])) {
					await push();
				}
				return;

			case 'setProjectStatus':
				await setProjectStatus(sidebar, msg);
				await push();
				return;

			case 'removeFromProject':
				if (await removeFromProject(sidebar, msg)) {
					await push();
				}
				return;
		}
	});
}
