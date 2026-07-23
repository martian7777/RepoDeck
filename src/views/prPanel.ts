import * as vscode from 'vscode';
import { getLogin, getOctokit } from '../auth/session';
import { describe } from '../features/initRepo';
import {
	checkoutPull,
	closePullRequest,
	convertPullToDraft,
	mergePullRequest,
	readyForReview,
} from '../features/pullRequests';
import { readRepoState } from '../github/repoContext';
import { updateBody, updateComment } from '../github/issues';
import {
	commentOnPull,
	fetchPull,
	reviewPull,
	updateReview,
	type PullDetail,
	type ReviewEvent,
} from '../github/prs';
import {
	addToProject,
	editAssignees,
	editLabels,
	editMilestone,
	editReviewers,
	removeFromProject,
	setProjectStatus,
	type SidebarContext,
} from './sidebarActions';
import { onPanelMessage, renderHtml } from './webviewHost';

/** One panel per PR number, reused if it's already open. */
const panels = new Map<number, vscode.WebviewPanel>();

/** Last-known detail per PR, so reopening one paints instantly. */
const cache = new Map<number, PullDetail>();

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

	const post = (pr: PullDetail) => {
		panel.title = `#${pr.number} ${pr.title}`;
		panel.webview.postMessage({ type: 'pr', pr, viewer: getLogin() ?? '' });
	};

	const push = async () => {
		const state = await readRepoState();
		const client = await getOctokit(context, false);
		if (!state.ref || !client) {
			return;
		}

		const cached = cache.get(number);
		if (cached) {
			post(cached);
		}

		panel.webview.postMessage({ type: 'loading' });
		try {
			const pr = await fetchPull(client, state.ref, number);
			cache.set(number, pr);
			post(pr);
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

			case 'readyForReview':
				if (await readyForReview(context, number)) {
					cache.delete(number);
					await push();
					onChanged();
				}
				return;

			case 'convertToDraft':
				if (await convertPullToDraft(context, number)) {
					cache.delete(number);
					await push();
					onChanged();
				}
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

			// ---- Comment actions ----

			case 'copyLink':
				await vscode.env.clipboard.writeText(msg.url);
				vscode.window.setStatusBarMessage('RepoDeck: link copied.', 2000);
				return;

			case 'copyMarkdown':
				await vscode.env.clipboard.writeText(msg.body ?? '');
				vscode.window.setStatusBarMessage('RepoDeck: Markdown copied.', 2000);
				return;

			// A conversation comment is an issue comment; a review body is not, and
			// needs the pulls endpoint instead.
			case 'editComment':
				if (typeof msg.id === 'number') {
					await updateComment(client, ref, msg.id, msg.body ?? '');
					await push();
				}
				return;

			case 'editReview':
				if (typeof msg.id === 'number') {
					await updateReview(client, ref, number, msg.id, msg.body ?? '');
					await push();
				}
				return;

			case 'editBody':
				await updateBody(client, ref, number, msg.body ?? '');
				await push();
				onChanged();
				return;

			// ---- Sidebar edits ----

			case 'editReviewers': {
				const pr = cache.get(number);
				if (await editReviewers(sidebar, msg.current ?? [], pr?.author ?? '')) {
					await push();
					onChanged();
				}
				return;
			}

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
