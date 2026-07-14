import * as vscode from 'vscode';
import { getOctokit } from '../auth/session';
import { describe } from '../features/initRepo';
import { checkoutPull, closePullRequest, mergePullRequest } from '../features/pullRequests';
import { readRepoState } from '../github/repoContext';
import { commentOnPull, fetchPull, reviewPull, type ReviewEvent } from '../github/prs';
import { renderHtml } from './webviewHost';

/** One panel per PR number, reused if it's already open. */
const panels = new Map<number, vscode.WebviewPanel>();

export async function openPullPanel(
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
		'repodeck.pr',
		`#${number}`,
		vscode.ViewColumn.Active,
		{
			enableScripts: true,
			retainContextWhenHidden: true,
			localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
		},
	);
	panel.webview.html = renderHtml(panel.webview, context.extensionUri, 'pr', `#${number}`);
	panels.set(number, panel);
	panel.onDidDispose(() => panels.delete(number));

	const push = async () => {
		const state = await readRepoState();
		const client = await getOctokit(context, false);
		if (!state.ref || !client) {
			return;
		}
		panel.webview.postMessage({ type: 'loading' });
		try {
			const pr = await fetchPull(client, state.ref, number);
			panel.title = `#${pr.number} ${pr.title}`;
			panel.webview.postMessage({ type: 'pr', pr, viewer: (await client.rest.users.getAuthenticated()).data.login });
		} catch (err) {
			panel.webview.postMessage({ type: 'error', message: describe(err) });
		}
	};

	panel.webview.onDidReceiveMessage(async (msg) => {
		const state = await readRepoState();
		const client = await getOctokit(context, false);
		if (!state.ref || !client) {
			return;
		}
		const ref = state.ref;

		try {
			switch (msg?.type) {
				case 'ready':
				case 'refresh':
					await push();
					return;

				case 'comment':
					if (msg.body?.trim()) {
						await commentOnPull(client, ref, number, msg.body);
						await push();
					}
					return;

				case 'review':
					// GitHub rejects an empty REQUEST_CHANGES or COMMENT review, and it
					// rejects reviewing your own PR — both surface as a plain 422.
					await reviewPull(client, ref, number, msg.event as ReviewEvent, msg.body ?? '');
					await push();
					onChanged();
					return;

				case 'merge': {
					const merged = await mergePullRequest(context, number, msg.method);
					if (merged) {
						await push();
						onChanged();
					}
					return;
				}

				case 'checkout':
					await checkoutPull(context, number);
					return;

				case 'setState':
					if (await closePullRequest(context, number, msg.state)) {
						await push();
						onChanged();
					}
					return;

				case 'openExternal':
					await vscode.env.openExternal(vscode.Uri.parse(msg.url));
					return;
			}
		} catch (err) {
			panel.webview.postMessage({ type: 'actionError', message: describe(err) });
		}
	});
}
