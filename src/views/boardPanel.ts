import * as vscode from 'vscode';
import { getOctokit } from '../auth/session';
import { pickOwner, describe } from '../features/initRepo';
import { fetchBoard, listProjects, moveCard, NoBoardFieldError } from '../github/graphql';
import { renderHtml } from './webviewHost';

let panel: vscode.WebviewPanel | undefined;
let projectId: string | undefined;

export async function openBoard(context: vscode.ExtensionContext): Promise<void> {
	const octokit = await getOctokit(context);
	if (!octokit) {
		return;
	}

	const id = await resolveProject(context);
	if (!id) {
		return;
	}
	projectId = id;

	if (panel) {
		panel.reveal();
	} else {
		panel = vscode.window.createWebviewPanel('repodeck.board', 'Project Board', vscode.ViewColumn.One, {
			enableScripts: true,
			retainContextWhenHidden: true,
			localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
		});
		panel.webview.html = renderHtml(panel.webview, context.extensionUri, 'board', 'Project Board');
		panel.onDidDispose(() => {
			panel = undefined;
		});
		panel.webview.onDidReceiveMessage((msg) => handleMessage(context, msg));
	}

	await pushBoard(context);
}

async function resolveProject(context: vscode.ExtensionContext): Promise<string | undefined> {
	const config = vscode.workspace.getConfiguration('repodeck');
	const saved = config.get<string>('defaultProject', '');
	if (saved) {
		return saved;
	}

	const octokit = await getOctokit(context);
	if (!octokit) {
		return undefined;
	}

	const owner = await pickOwner(context, 'Open Project Board — owner');
	if (!owner) {
		return undefined;
	}

	let projects;
	try {
		projects = await listProjects(octokit, owner.login, owner.isOrg);
	} catch (err) {
		// The overwhelmingly likely cause is a token without `project` scope.
		vscode.window.showErrorMessage(
			`RepoDeck: couldn't read projects for ${owner.login}. Your token probably lacks the 'project' scope — sign out and sign in again. (${describe(err)})`,
		);
		return undefined;
	}

	if (projects.length === 0) {
		const CREATE = 'Create one on GitHub';
		const choice = await vscode.window.showInformationMessage(
			`${owner.login} has no open projects. RepoDeck v0.1 works with an existing project.`,
			CREATE,
		);
		if (choice === CREATE) {
			const url = owner.isOrg
				? `https://github.com/orgs/${owner.login}/projects/new`
				: `https://github.com/users/${owner.login}/projects/new`;
			await vscode.env.openExternal(vscode.Uri.parse(url));
		}
		return undefined;
	}

	const picked = await vscode.window.showQuickPick(
		projects.map((p) => ({ label: p.title, description: `#${p.number}`, id: p.id })),
		{ title: 'Open Project Board — project', ignoreFocusOut: true },
	);
	if (!picked) {
		return undefined;
	}

	await config.update('defaultProject', picked.id, vscode.ConfigurationTarget.Workspace);
	return picked.id;
}

async function pushBoard(context: vscode.ExtensionContext): Promise<void> {
	if (!panel || !projectId) {
		return;
	}
	const octokit = await getOctokit(context, false);
	if (!octokit) {
		return;
	}

	panel.webview.postMessage({ type: 'loading' });
	try {
		const board = await fetchBoard(octokit, projectId);
		panel.title = board.title;
		panel.webview.postMessage({ type: 'board', board });
	} catch (err) {
		// A project with no single-select field is a legitimate project, not a bug — it
		// just has nothing to render as columns. Say so instead of throwing.
		const message =
			err instanceof NoBoardFieldError ? err.message : `Couldn't load the board. ${describe(err)}`;
		panel.webview.postMessage({ type: 'error', message });
	}
}

async function handleMessage(context: vscode.ExtensionContext, msg: any): Promise<void> {
	switch (msg?.type) {
		case 'ready':
		case 'refresh':
			await pushBoard(context);
			return;

		case 'moveCard': {
			const octokit = await getOctokit(context, false);
			if (!octokit || !projectId) {
				return;
			}
			try {
				await moveCard(octokit, projectId, msg.itemId, msg.fieldId, msg.optionId);
			} catch (err) {
				// The webview moved the card optimistically, so a failure has to be
				// reflected back or the UI silently lies about the server state.
				vscode.window.showErrorMessage(`RepoDeck: couldn't move that card. ${describe(err)}`);
				await pushBoard(context);
			}
			return;
		}

		case 'openCard':
			if (msg.url) {
				await vscode.env.openExternal(vscode.Uri.parse(msg.url));
			}
			return;

		case 'changeProject':
			await vscode.workspace
				.getConfiguration('repodeck')
				.update('defaultProject', '', vscode.ConfigurationTarget.Workspace);
			projectId = undefined;
			await openBoard(context);
			return;
	}
}

/** Lets other features (e.g. "add issue to board") ask the open board to reload. */
export async function refreshBoard(context: vscode.ExtensionContext): Promise<void> {
	await pushBoard(context);
}

export function activeProjectId(): string | undefined {
	return projectId;
}
