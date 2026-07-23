import * as vscode from 'vscode';
import { getLogin, getOctokit } from '../auth/session';
import { describe } from '../features/initRepo';
import { readRepoState } from '../github/repoContext';
import {
	addComment,
	fetchDiscussion,
	listCategories,
	setAnswer,
	setDiscussionClosed,
	setUpvote,
	updateCommentBody,
	updateDiscussion,
	type DiscussionDetail,
} from '../github/discussions';
import { onPanelMessage, renderHtml } from './webviewHost';

/** One panel per discussion number, reused if it's already open. */
const panels = new Map<number, vscode.WebviewPanel>();

/** Last-known detail per discussion, so reopening one paints instantly. */
const cache = new Map<number, DiscussionDetail>();

export async function openDiscussionPanel(
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
		'repodeck.discussion',
		`Discussion #${number}`,
		vscode.ViewColumn.Active,
		{
			enableScripts: true,
			retainContextWhenHidden: true,
			localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
		},
	);
	panel.webview.html = renderHtml(
		panel.webview,
		context.extensionUri,
		'discussion',
		`Discussion #${number}`,
	);
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

		const post = (discussion: DiscussionDetail) => {
			panel.title = `#${discussion.number} ${discussion.title}`;
			panel.webview.postMessage({ type: 'discussion', discussion, repo, viewer });
		};

		const cached = cache.get(number);
		if (cached) {
			post(cached);
		}

		panel.webview.postMessage({ type: 'loading' });
		try {
			const discussion = await fetchDiscussion(client, state.ref, number);
			cache.set(number, discussion);
			post(discussion);
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

		// Every mutation below needs the discussion's node id, which only the last fetch
		// knows. It's always there by the time the webview can post one of these.
		const current = cache.get(number);

		switch (msg?.type) {
			case 'ready':
			case 'refresh':
				await push();
				return;

			case 'comment':
				if (current && msg.body?.trim()) {
					await addComment(client, current.id, msg.body);
					await push();
					onChanged();
				}
				return;

			// A reply always hangs off a top-level comment — GitHub rejects a reply to a
			// reply, so the webview only offers this on the outer cards.
			case 'reply':
				if (current && typeof msg.replyToId === 'string' && msg.body?.trim()) {
					await addComment(client, current.id, msg.body, msg.replyToId);
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

			// Discussion ids are opaque node id strings, not the numbers the issue and
			// pull request panels edit through.
			case 'editComment':
				if (typeof msg.id === 'string') {
					await updateCommentBody(client, msg.id, msg.body ?? '');
					await push();
				}
				return;

			case 'editBody':
				if (current) {
					await updateDiscussion(client, current.id, { body: msg.body ?? '' });
					await push();
				}
				return;

			// ---- Discussion edits ----

			case 'editTitle': {
				if (!current) {
					return;
				}
				const title = await vscode.window.showInputBox({
					title: 'RepoDeck: rename discussion',
					value: current.title,
					validateInput: (v) => (v.trim().length === 0 ? 'Title cannot be empty.' : undefined),
				});
				if (title && title.trim() !== current.title) {
					await updateDiscussion(client, current.id, { title: title.trim() });
					await push();
					onChanged();
				}
				return;
			}

			case 'editCategory': {
				if (!current) {
					return;
				}
				const categories = await listCategories(client, ref);
				const picked = await vscode.window.showQuickPick(
					categories.map((c) => ({
						label: c.emoji ? `${c.emoji} ${c.name}` : c.name,
						description: c.id === current.category.id ? 'current' : undefined,
						id: c.id,
					})),
					{ title: 'RepoDeck: move discussion to category' },
				);
				if (picked && picked.id !== current.category.id) {
					await updateDiscussion(client, current.id, { categoryId: picked.id });
					await push();
					onChanged();
				}
				return;
			}

			case 'setState':
				if (current) {
					await setDiscussionClosed(client, current.id, msg.closed === true);
					await push();
					onChanged();
				}
				return;

			case 'upvote':
				if (typeof msg.subjectId === 'string') {
					await setUpvote(client, msg.subjectId, msg.on === true);
					await push();
				}
				return;

			case 'markAnswer':
				if (typeof msg.id === 'string') {
					await setAnswer(client, msg.id, msg.on === true);
					await push();
					onChanged();
				}
				return;
		}
	});
}
