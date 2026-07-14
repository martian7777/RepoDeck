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
	createField,
	deleteItem,
	getRepositoryId,
	listProjects,
} from '../github/graphql';
import { fetchProject, setItemField, type Project, type Value } from '../github/project';
import { readRepoState } from '../github/repoContext';
import { renderHtml } from './webviewHost';

let panel: vscode.WebviewPanel | undefined;
let projectId: string | undefined;

/**
 * Last-known project, per id. Reopening the panel paints from this immediately and the
 * real fetch lands behind it — a project with 1000 items is several sequential GraphQL
 * pages, and waiting on that with a blank panel is what made this feel broken.
 */
const cache = new Map<string, Project>();

const config = () => vscode.workspace.getConfiguration('repodeck');
const setConfig = (key: string, value: string) =>
	config().update(key, value, vscode.ConfigurationTarget.Workspace);

/** An item's issue can live in any repo the project spans, so its repo comes from its URL. */
function parseIssueUrl(url: string | undefined): { owner: string; repo: string; number: number } | undefined {
	const m = url ? /github\.com\/([^/]+)\/([^/]+)\/(?:issues|pull)\/(\d+)/.exec(url) : undefined;
	return m ? { owner: m[1], repo: m[2], number: Number(m[3]) } : undefined;
}

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
		panel = vscode.window.createWebviewPanel('repodeck.board', 'Project', vscode.ViewColumn.One, {
			enableScripts: true,
			retainContextWhenHidden: true,
			localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
		});
		panel.webview.html = renderHtml(panel.webview, context.extensionUri, 'board', 'Project');
		panel.onDidDispose(() => {
			panel = undefined;
		});
		panel.webview.onDidReceiveMessage((msg) => handleMessage(context, msg));
	}

	await push(context);
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

	const owner = await pickOwner(context, 'Open Project — owner');
	if (!owner) {
		return undefined;
	}

	let projects;
	try {
		projects = await listProjects(octokit, owner.login, owner.isOrg);
	} catch (err) {
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
		{ title: 'Open Project', ignoreFocusOut: true },
	);
	if (!picked) {
		return undefined;
	}
	if (!picked.id) {
		return createProjectCommand(context);
	}

	await setConfig('defaultProject', picked.id);
	await setConfig('boardField', '');
	return picked.id;
}

function post(project: Project): void {
	if (!panel) {
		return;
	}
	panel.title = project.title;
	panel.webview.postMessage({
		type: 'project',
		project,
		layout: config().get<string>('layout', 'board'),
		groupById: config().get<string>('boardField', '') || undefined,
		roadmap: {
			startFieldId: config().get<string>('roadmapStart', '') || undefined,
			targetFieldId: config().get<string>('roadmapTarget', '') || undefined,
		},
	});
}

async function push(context: vscode.ExtensionContext): Promise<void> {
	if (!panel || !projectId) {
		return;
	}
	const octokit = await getOctokit(context, false);
	if (!octokit) {
		return;
	}
	const id = projectId;

	// Paint what we had, if anything, so the panel is never blank while the network runs.
	const cached = cache.get(id);
	if (cached) {
		post(cached);
	}

	panel.webview.postMessage({ type: 'loading' });
	try {
		const project = await fetchProject(octokit, id);
		cache.set(id, project);
		post(project);
	} catch (err) {
		if (cached) {
			// We're already showing something real; don't blow it away over a failed refresh.
			panel.webview.postMessage({
				type: 'stale',
				message: `Couldn't refresh. ${describe(err)}`,
			});
		} else {
			panel.webview.postMessage({
				type: 'error',
				message: `Couldn't load the project. ${describe(err)}`,
			});
		}
	}
}

async function handleMessage(context: vscode.ExtensionContext, msg: any): Promise<void> {
	const octokit = await getOctokit(context, false);
	if (!octokit || !projectId) {
		return;
	}
	const project = projectId;
	const reload = () => push(context);

	try {
		switch (msg?.type) {
			case 'ready':
			case 'refresh':
				await reload();
				return;

			// The webview already holds every item and field, so a layout or group-by change
			// is a redraw, not a fetch. These messages only persist the choice.
			case 'setLayout':
				await setConfig('layout', msg.layout);
				return;

			case 'groupBy':
				await setConfig('boardField', msg.fieldId);
				return;

			case 'changeProject':
				await setConfig('defaultProject', '');
				projectId = undefined;
				await openBoard(context);
				return;

			// ---- Field values (every layout writes through here) ----

			case 'setField':
				try {
					await setItemField(
						octokit,
						project,
						msg.itemId,
						msg.fieldId,
						(msg.value ?? undefined) as Value | undefined,
					);
					// The webview updated optimistically; only reload when it can't have
					// predicted the result.
					if (msg.reload) {
						await reload();
					}
				} catch (err) {
					vscode.window.showErrorMessage(`RepoDeck: couldn't save that value. ${describe(err)}`);
					await reload();
				}
				return;

			case 'setAssignees': {
				const ref = parseIssueUrl(msg.url);
				if (!ref) {
					vscode.window.showInformationMessage(
						'RepoDeck: draft items have no assignees — convert it to an issue first.',
					);
					return;
				}
				const collaborators = await octokit.rest.repos
					.listCollaborators({ owner: ref.owner, repo: ref.repo, per_page: 100 })
					.then((r) => r.data.map((c) => c.login))
					.catch(() => [] as string[]);
				if (collaborators.length === 0) {
					vscode.window.showInformationMessage('RepoDeck: no assignable collaborators on that repository.');
					return;
				}
				const picked = await vscode.window.showQuickPick(
					collaborators.map((c) => ({ label: c, picked: (msg.current ?? []).includes(c) })),
					{ title: `Assignees — #${ref.number}`, canPickMany: true, ignoreFocusOut: true },
				);
				if (picked) {
					await octokit.rest.issues.update({
						owner: ref.owner,
						repo: ref.repo,
						issue_number: ref.number,
						assignees: picked.map((p) => p.label),
					});
					await reload();
				}
				return;
			}

			case 'editTitle': {
				const title = await vscode.window.showInputBox({
					title: 'Rename',
					value: msg.title,
					ignoreFocusOut: true,
					validateInput: (v) => (v.trim() ? undefined : 'A title is required.'),
				});
				if (!title || title === msg.title) {
					return;
				}
				const ref = parseIssueUrl(msg.url);
				if (ref) {
					await octokit.rest.issues.update({
						owner: ref.owner,
						repo: ref.repo,
						issue_number: ref.number,
						title: title.trim(),
					});
				} else {
					// A draft's title lives on the project item, not on any issue.
					await octokit.graphql(
						`mutation($projectId: ID!, $itemId: ID!, $title: String!) {
							updateProjectV2DraftIssue(input: { draftIssueId: $itemId, title: $title }) {
								draftIssue { id }
							}
						}`,
						{ projectId: project, itemId: msg.itemId, title: title.trim() },
					).catch(async () => {
						vscode.window.showWarningMessage("RepoDeck: couldn't rename that draft.");
					});
				}
				await reload();
				return;
			}

			// ---- Roadmap setup ----

			case 'pickRoadmapFields': {
				const dateFields = (msg.dateFields ?? []) as { id: string; name: string }[];
				const start = await vscode.window.showQuickPick(
					dateFields.map((f) => ({ label: f.name, id: f.id })),
					{ title: 'Roadmap (1/2) — start date field', ignoreFocusOut: true },
				);
				if (!start) {
					return;
				}
				const target = await vscode.window.showQuickPick(
					dateFields.map((f) => ({ label: f.name, id: f.id })),
					{ title: 'Roadmap (2/2) — target date field', ignoreFocusOut: true },
				);
				if (!target) {
					return;
				}
				await setConfig('roadmapStart', start.id);
				await setConfig('roadmapTarget', target.id);
				await reload();
				return;
			}

			case 'createDateFields':
				await createField(octokit, project, 'Start date', 'DATE');
				await createField(octokit, project, 'Target date', 'DATE');
				vscode.window.showInformationMessage(
					'RepoDeck: created "Start date" and "Target date". Pick them as the roadmap fields.',
				);
				await reload();
				return;

			// ---- Items ----

			case 'openCard':
				if (msg.number !== undefined && msg.number !== null) {
					await vscode.commands.executeCommand('repodeck.openIssue', {
						number: msg.number,
						url: msg.url,
					});
				}
				return;

			case 'openCardExternal':
				if (msg.url) {
					await vscode.env.openExternal(vscode.Uri.parse(msg.url));
				}
				return;

			case 'addItem': {
				const kind = await vscode.window.showQuickPick(
					[
						{ label: '$(issues) Existing issue…', value: 'issue' as const },
						{ label: '$(edit) Draft item…', description: 'Lives only on the board', value: 'draft' as const },
					],
					{ title: msg.columnName ? `Add to "${msg.columnName}"` : 'Add an item', ignoreFocusOut: true },
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
						{ title: 'Add an issue', ignoreFocusOut: true },
					);
					if (!picked) {
						return;
					}
					// Idempotent: adding an issue already on the board returns its existing item.
					itemId = await addIssueToProject(octokit, project, picked.nodeId);
				}

				// A new item has no field values, so without this it lands in the "no
				// status" tray rather than the column the user clicked "+" on.
				if (msg.fieldId && msg.optionId) {
					await setItemField(octokit, project, itemId, msg.fieldId, {
						kind: 'select',
						optionId: msg.optionId,
					});
				}
				await reload();
				return;
			}

			case 'convertDraft': {
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
				const CONFIRM = 'Remove from project';
				const confirm = await vscode.window.showWarningMessage(
					msg.isDraft
						? `Delete the draft "${msg.title}"? Drafts exist only on the project, so this cannot be undone.`
						: `Remove "${msg.title}" from the project? The issue itself is not deleted.`,
					{ modal: true },
					CONFIRM,
				);
				if (confirm === CONFIRM) {
					await deleteItem(octokit, project, msg.itemId);
					await reload();
				}
				return;
			}

			// ---- Columns / fields ----

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
				const CONFIRM = 'Delete column';
				const confirm = await vscode.window.showWarningMessage(
					msg.count > 0
						? `Delete the column "${msg.name}"? Its ${msg.count} card(s) stay on the project but lose their ${msg.fieldName}.`
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

			case 'manageFields':
				await manageFields(octokit, project, reload);
				return;
		}
	} catch (err) {
		vscode.window.showErrorMessage(`RepoDeck: ${describe(err)}`);
		await reload();
	}
}

/** Lets other features (e.g. the issue panel) ask the open project to reload. */
export async function refreshBoard(context: vscode.ExtensionContext): Promise<void> {
	await push(context);
}

export function activeProjectId(): string | undefined {
	return projectId;
}

export function setActiveProject(id: string): void {
	projectId = id;
}
