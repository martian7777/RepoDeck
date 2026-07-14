import * as vscode from 'vscode';
import { getOctokit } from '../auth/session';
import { pickOwner, describe } from '../features/initRepo';
import { createProjectCommand } from '../features/createProject';
import {
	addColumn,
	deleteColumn,
	manageFields,
	pickColor,
	recolorColumn,
	renameColumn,
} from '../features/boardAuthoring';
import {
	addDraftItem,
	addIssueToProject,
	convertDraftToIssue,
	deleteItem,
	fetchBoard,
	getRepositoryId,
	listProjects,
	moveCard,
	NoBoardFieldError,
} from '../github/graphql';
import { readRepoState } from '../github/repoContext';
import { renderHtml } from './webviewHost';

let panel: vscode.WebviewPanel | undefined;
let projectId: string | undefined;

const config = () => vscode.workspace.getConfiguration('repodeck');
const groupByField = () => config().get<string>('boardField', '') || undefined;

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
	const saved = config().get<string>('defaultProject', '');
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
		return createProjectCommand(context);
	}

	const picked = await vscode.window.showQuickPick(
		[
			{ label: '$(add) New project…', id: '' },
			{ label: '', kind: vscode.QuickPickItemKind.Separator, id: '' },
			...projects.map((p) => ({ label: p.title, description: `#${p.number}`, id: p.id })),
		],
		{ title: 'Open Project Board — project', ignoreFocusOut: true },
	);
	if (!picked) {
		return undefined;
	}
	if (!picked.id) {
		return createProjectCommand(context);
	}

	await config().update('defaultProject', picked.id, vscode.ConfigurationTarget.Workspace);
	await config().update('boardField', '', vscode.ConfigurationTarget.Workspace);
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
		const board = await fetchBoard(octokit, projectId, groupByField());
		panel.title = board.title;
		panel.webview.postMessage({ type: 'board', board });
	} catch (err) {
		// A project with no single-select field is a legitimate project, not a bug — it
		// just has nothing to render as columns. Offer to give it one.
		if (err instanceof NoBoardFieldError) {
			panel.webview.postMessage({ type: 'noField', message: err.message });
			return;
		}
		panel.webview.postMessage({ type: 'error', message: `Couldn't load the board. ${describe(err)}` });
	}
}

async function handleMessage(context: vscode.ExtensionContext, msg: any): Promise<void> {
	const octokit = await getOctokit(context, false);
	if (!octokit || !projectId) {
		return;
	}
	const project = projectId;
	const reload = () => pushBoard(context);

	try {
		switch (msg?.type) {
			case 'ready':
			case 'refresh':
				await reload();
				return;

			case 'moveCard':
				try {
					await moveCard(octokit, project, msg.itemId, msg.fieldId, msg.optionId);
				} catch (err) {
					// The webview moved the card optimistically, so a failure has to be
					// reflected back or the UI silently lies about the server state.
					vscode.window.showErrorMessage(`RepoDeck: couldn't move that card. ${describe(err)}`);
					await reload();
				}
				return;

			case 'openCard':
				// Routed through the command rather than calling openIssuePanel directly:
				// the issue panel already imports this module to refresh the board, and a
				// direct import back would be a cycle.
				if (msg.number !== undefined && msg.number !== null) {
					await vscode.commands.executeCommand('repodeck.openIssue', {
						number: msg.number,
						url: msg.url,
					});
				} else if (msg.url) {
					await vscode.env.openExternal(vscode.Uri.parse(msg.url));
				}
				return;

			case 'openCardExternal':
				if (msg.url) {
					await vscode.env.openExternal(vscode.Uri.parse(msg.url));
				}
				return;

			case 'changeProject':
				await config().update('defaultProject', '', vscode.ConfigurationTarget.Workspace);
				projectId = undefined;
				await openBoard(context);
				return;

			// ---- Authoring ----

			case 'addColumn': {
				const name = await vscode.window.showInputBox({
					title: 'New column',
					prompt: `A new option on the "${msg.fieldName}" field`,
					ignoreFocusOut: true,
					validateInput: (v) => (v.trim() ? undefined : 'A name is required.'),
				});
				if (!name) {
					return;
				}
				const color = await pickColor(`Colour for "${name.trim()}"`);
				if (!color) {
					return;
				}
				await addColumn(octokit, project, msg.fieldId, name.trim(), color);
				await reload();
				return;
			}

			case 'renameColumn': {
				const name = await vscode.window.showInputBox({
					title: `Rename "${msg.name}"`,
					value: msg.name,
					ignoreFocusOut: true,
					validateInput: (v) => (v.trim() ? undefined : 'A name is required.'),
				});
				if (name && name.trim() !== msg.name) {
					await renameColumn(octokit, project, msg.fieldId, msg.optionId, name.trim());
					await reload();
				}
				return;
			}

			case 'recolorColumn': {
				const color = await pickColor(`Colour for "${msg.name}"`);
				if (color) {
					await recolorColumn(octokit, project, msg.fieldId, msg.optionId, color);
					await reload();
				}
				return;
			}

			case 'deleteColumn': {
				// Deleting an option strips that value from every card holding it, and the
				// cards then land in the "no status" tray. Say so plainly.
				const CONFIRM = 'Delete column';
				const confirm = await vscode.window.showWarningMessage(
					msg.count > 0
						? `Delete the column "${msg.name}"? Its ${msg.count} card(s) stay on the board but lose their ${msg.fieldName}.`
						: `Delete the column "${msg.name}"?`,
					{ modal: true },
					CONFIRM,
				);
				if (confirm === CONFIRM) {
					await deleteColumn(octokit, project, msg.fieldId, msg.optionId);
					await reload();
				}
				return;
			}

			case 'addItem': {
				const kind = await vscode.window.showQuickPick(
					[
						{ label: '$(issues) Existing issue…', value: 'issue' as const },
						{ label: '$(edit) Draft item…', description: 'Lives only on the board', value: 'draft' as const },
					],
					{ title: `Add to "${msg.columnName}"`, ignoreFocusOut: true },
				);
				if (!kind) {
					return;
				}

				let itemId: string;

				if (kind.value === 'draft') {
					const title = await vscode.window.showInputBox({
						title: 'New draft item',
						prompt: 'Drafts live only on the board until you convert them into an issue.',
						ignoreFocusOut: true,
						validateInput: (v) => (v.trim() ? undefined : 'A title is required.'),
					});
					if (!title) {
						return;
					}
					itemId = await addDraftItem(octokit, project, title.trim(), '');
				} else {
					const state = await readRepoState();
					if (!state.ref) {
						vscode.window.showErrorMessage('RepoDeck: this folder has no GitHub remote.');
						return;
					}
					const { data } = await octokit.rest.issues.listForRepo({
						...state.ref,
						state: 'open',
						per_page: 100,
					});
					// listForRepo returns pull requests too; they are issues to the REST API
					// but not what anyone means by "add an issue".
					const issues = data.filter((i) => !i.pull_request);
					if (issues.length === 0) {
						vscode.window.showInformationMessage('RepoDeck: no open issues in this repository.');
						return;
					}
					const picked = await vscode.window.showQuickPick(
						issues.map((i) => ({
							label: `#${i.number} ${i.title}`,
							description: (i.assignees ?? []).map((a) => a.login).join(', '),
							nodeId: i.node_id,
						})),
						{ title: `Add to "${msg.columnName}"`, ignoreFocusOut: true },
					);
					if (!picked) {
						return;
					}
					// Idempotent: adding an issue already on the board returns its existing item.
					itemId = await addIssueToProject(octokit, project, picked.nodeId);
				}

				// A new item has no field values, so it would land in the "no status" tray
				// rather than the column the user clicked "+" on.
				if (msg.optionId) {
					await moveCard(octokit, project, itemId, msg.fieldId, msg.optionId);
				}
				await reload();
				return;
			}

			case 'convertDraft': {
				// The webview says it's a draft; GitHub is the authority. Converting a real
				// issue fails with "Cannot convert an issue into an issue".
				if (!msg.isDraft) {
					vscode.window.showInformationMessage('RepoDeck: that card is already a real issue.');
					return;
				}
				const state = await readRepoState();
				if (!state.ref) {
					vscode.window.showErrorMessage(
						'RepoDeck: a draft becomes an issue in a repository, and this folder has no GitHub remote.',
					);
					return;
				}
				const repositoryId = await getRepositoryId(octokit, state.ref.owner, state.ref.repo);
				await convertDraftToIssue(octokit, msg.itemId, repositoryId);
				vscode.window.showInformationMessage(
					`RepoDeck: converted the draft into an issue in ${state.ref.owner}/${state.ref.repo}.`,
				);
				await reload();
				return;
			}

			case 'deleteItem': {
				const CONFIRM = 'Remove from board';
				const confirm = await vscode.window.showWarningMessage(
					msg.isDraft
						? `Delete the draft "${msg.title}"? Drafts exist only on the board, so this cannot be undone.`
						: `Remove "${msg.title}" from the board? The issue itself is not deleted.`,
					{ modal: true },
					CONFIRM,
				);
				if (confirm === CONFIRM) {
					await deleteItem(octokit, project, msg.itemId);
					await reload();
				}
				return;
			}

			case 'manageFields':
				await manageFields(octokit, project, reload);
				return;

			case 'groupBy': {
				await config().update('boardField', msg.fieldId, vscode.ConfigurationTarget.Workspace);
				await reload();
				return;
			}

			case 'addStatusField': {
				await manageFields(octokit, project, reload);
				return;
			}
		}
	} catch (err) {
		vscode.window.showErrorMessage(`RepoDeck: ${describe(err)}`);
		await reload();
	}
}

/** Lets other features (e.g. "add issue to board") ask the open board to reload. */
export async function refreshBoard(context: vscode.ExtensionContext): Promise<void> {
	await pushBoard(context);
}

export function activeProjectId(): string | undefined {
	return projectId;
}

export function setActiveProject(id: string): void {
	projectId = id;
}
