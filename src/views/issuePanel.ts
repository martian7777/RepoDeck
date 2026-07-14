import * as vscode from 'vscode';
import { getOctokit } from '../auth/session';
import { describe, pickOwner } from '../features/initRepo';
import { createProjectCommand } from '../features/createProject';
import {
	addIssueToProject,
	clearItemField,
	deleteItem,
	listProjects,
	moveCard,
} from '../github/graphql';
import {
	commentOnIssue,
	fetchIssue,
	listMilestones,
	setAssignees,
	setIssueState,
	setLabels,
	setMilestone,
	type IssueDetail,
} from '../github/issues';
import { readRepoState } from '../github/repoContext';
import { refreshBoard } from './boardPanel';
import { renderHtml } from './webviewHost';

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

		const cached = cache.get(number);
		if (cached) {
			panel.title = `#${cached.number} ${cached.title}`;
			panel.webview.postMessage({ type: 'issue', issue: cached, repo });
		}

		panel.webview.postMessage({ type: 'loading' });
		try {
			const issue = await fetchIssue(client, state.ref, number);
			cache.set(number, issue);
			panel.title = `#${issue.number} ${issue.title}`;
			panel.webview.postMessage({ type: 'issue', issue, repo });
		} catch (err) {
			if (!cached) {
				panel.webview.postMessage({ type: 'error', message: describe(err) });
			}
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

				// ---- Sidebar edits ----

				case 'editAssignees': {
					const collaborators = await client.rest.repos
						.listCollaborators({ ...ref, per_page: 100 })
						.then((r) => r.data.map((c) => c.login))
						.catch(() => [] as string[]);
					if (collaborators.length === 0) {
						vscode.window.showInformationMessage(
							'RepoDeck: no assignable collaborators on this repository.',
						);
						return;
					}
					const picked = await vscode.window.showQuickPick(
						collaborators.map((c) => ({ label: c, picked: msg.current.includes(c) })),
						{ title: 'Assignees', canPickMany: true, ignoreFocusOut: true },
					);
					if (picked) {
						await setAssignees(client, ref, number, picked.map((p) => p.label));
						await push();
						onChanged();
					}
					return;
				}

				case 'editLabels': {
					const labels = await client.rest.issues
						.listLabelsForRepo({ ...ref, per_page: 100 })
						.then((r) => r.data.map((l) => l.name))
						.catch(() => [] as string[]);
					const picked = await vscode.window.showQuickPick(
						labels.map((l) => ({ label: l, picked: msg.current.includes(l) })),
						{ title: 'Labels', canPickMany: true, ignoreFocusOut: true },
					);
					if (picked) {
						await setLabels(client, ref, number, picked.map((p) => p.label));
						await push();
						onChanged();
					}
					return;
				}

				case 'editMilestone': {
					const milestones = await listMilestones(client, ref).catch(() => []);
					const picked = await vscode.window.showQuickPick(
						[
							{ label: '$(circle-slash) No milestone', number: null as number | null },
							...milestones.map((m) => ({ label: m.title, number: m.number as number | null })),
						],
						{ title: 'Milestone', ignoreFocusOut: true },
					);
					if (picked) {
						await setMilestone(client, ref, number, picked.number);
						await push();
					}
					return;
				}

				// ---- Projects ----

				case 'addToProject': {
					const owner = await pickOwner(context, 'Add to project — owner');
					if (!owner) {
						return;
					}

					let projects;
					try {
						projects = await listProjects(client, owner.login, owner.isOrg);
					} catch (err) {
						vscode.window.showErrorMessage(
							`RepoDeck: couldn't read projects for ${owner.login}. Your token probably lacks the 'project' scope — sign out and sign in again. (${describe(err)})`,
						);
						return;
					}

					// Adding an issue to a project it's already on is a no-op that looks
					// like a bug, so those projects aren't offered.
					const already = new Set<string>(msg.current ?? []);
					const available = projects.filter((p) => !already.has(p.id));

					const picked = await vscode.window.showQuickPick(
						[
							{ label: '$(add) New project…', id: '' },
							...available.map((p) => ({ label: p.title, description: `#${p.number}`, id: p.id })),
						],
						{ title: 'Add to project', ignoreFocusOut: true },
					);
					if (!picked) {
						return;
					}

					const projectId = picked.id || (await createProjectCommand(context));
					if (!projectId) {
						return;
					}

					await addIssueToProject(client, projectId, msg.nodeId);
					await push();
					await refreshBoard(context);
					vscode.window.showInformationMessage(`RepoDeck: added #${number} to the project.`);
					return;
				}

				case 'setProjectStatus':
					if (msg.optionId) {
						await moveCard(client, msg.projectId, msg.itemId, msg.fieldId, msg.optionId);
					} else {
						await clearItemField(client, msg.projectId, msg.itemId, msg.fieldId);
					}
					await push();
					await refreshBoard(context);
					return;

				case 'removeFromProject': {
					const CONFIRM = 'Remove';
					const confirm = await vscode.window.showWarningMessage(
						`Remove #${number} from "${msg.projectTitle}"? The issue itself is not deleted.`,
						{ modal: true },
						CONFIRM,
					);
					if (confirm === CONFIRM) {
						await deleteItem(client, msg.projectId, msg.itemId);
						await push();
						await refreshBoard(context);
					}
					return;
				}
			}
		} catch (err) {
			panel.webview.postMessage({ type: 'actionError', message: describe(err) });
		}
	});
}
