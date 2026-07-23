import * as vscode from 'vscode';
import type { Octokit } from '@octokit/rest';
import { describe, pickOwner } from '../features/initRepo';
import { createProjectCommand } from '../features/createProject';
import {
	addIssueToProject,
	clearItemField,
	deleteItem,
	listProjects,
	moveCard,
} from '../github/graphql';
import { listMilestones, setAssignees, setLabels, setMilestone } from '../github/issues';
import { removeReviewers, requestReviewers } from '../github/prs';
import type { RepoRef } from '../github/repoContext';
import { refreshBoard } from './boardPanel';

/**
 * The sidebar edits an issue and a pull request share.
 *
 * Assignees, labels and milestones live on the *issue* endpoints for both kinds — GitHub
 * treats a PR as an issue with a branch — so one implementation serves both panels. Each
 * handler returns true when something actually changed, which is the panel's cue to refetch.
 */
export interface SidebarContext {
	context: vscode.ExtensionContext;
	client: Octokit;
	ref: RepoRef;
	number: number;
}

export async function editAssignees(
	{ client, ref, number }: SidebarContext,
	current: string[],
): Promise<boolean> {
	const collaborators = await client.rest.repos
		.listCollaborators({ ...ref, per_page: 100 })
		.then((r) => r.data.map((c) => c.login))
		.catch(() => [] as string[]);
	if (collaborators.length === 0) {
		vscode.window.showInformationMessage(
			'RepoDeck: no assignable collaborators on this repository.',
		);
		return false;
	}
	const picked = await vscode.window.showQuickPick(
		collaborators.map((c) => ({ label: c, picked: current.includes(c) })),
		{ title: 'Assignees', canPickMany: true, ignoreFocusOut: true },
	);
	if (!picked) {
		return false;
	}
	await setAssignees(client, ref, number, picked.map((p) => p.label));
	return true;
}

export async function editLabels(
	{ client, ref, number }: SidebarContext,
	current: string[],
): Promise<boolean> {
	const labels = await client.rest.issues
		.listLabelsForRepo({ ...ref, per_page: 100 })
		.then((r) => r.data.map((l) => l.name))
		.catch(() => [] as string[]);
	const picked = await vscode.window.showQuickPick(
		labels.map((l) => ({ label: l, picked: current.includes(l) })),
		{ title: 'Labels', canPickMany: true, ignoreFocusOut: true },
	);
	if (!picked) {
		return false;
	}
	await setLabels(client, ref, number, picked.map((p) => p.label));
	return true;
}

export async function editMilestone({ client, ref, number }: SidebarContext): Promise<boolean> {
	const milestones = await listMilestones(client, ref).catch(() => []);
	const picked = await vscode.window.showQuickPick(
		[
			{ label: '$(circle-slash) No milestone', number: null as number | null },
			...milestones.map((m) => ({ label: m.title, number: m.number as number | null })),
		],
		{ title: 'Milestone', ignoreFocusOut: true },
	);
	if (!picked) {
		return false;
	}
	await setMilestone(client, ref, number, picked.number);
	return true;
}

/**
 * Reviewers are PR-only, and the endpoints are add/remove rather than replace — so the
 * diff against what's currently requested has to be computed here.
 */
export async function editReviewers(
	{ client, ref, number }: SidebarContext,
	current: string[],
	author: string,
): Promise<boolean> {
	const collaborators = await client.rest.repos
		.listCollaborators({ ...ref, per_page: 100 })
		.then((r) => r.data.map((c) => c.login))
		.catch(() => [] as string[]);

	// GitHub rejects a review request for the PR's own author with a bare 422.
	const candidates = collaborators.filter((c) => c !== author);
	if (candidates.length === 0) {
		vscode.window.showInformationMessage('RepoDeck: no one else can be asked to review this.');
		return false;
	}

	const picked = await vscode.window.showQuickPick(
		candidates.map((c) => ({ label: c, picked: current.includes(c) })),
		{ title: 'Reviewers', canPickMany: true, ignoreFocusOut: true },
	);
	if (!picked) {
		return false;
	}

	const wanted = new Set(picked.map((p) => p.label));
	const added = [...wanted].filter((r) => !current.includes(r));
	const removed = current.filter((r) => !wanted.has(r));

	if (added.length > 0) {
		await requestReviewers(client, ref, number, added);
	}
	if (removed.length > 0) {
		await removeReviewers(client, ref, number, removed);
	}
	return added.length > 0 || removed.length > 0;
}

export async function addToProject(
	{ context, client, number }: SidebarContext,
	nodeId: string,
	current: string[],
): Promise<boolean> {
	const owner = await pickOwner(context, 'Add to project — owner');
	if (!owner) {
		return false;
	}

	let projects;
	try {
		projects = await listProjects(client, owner.login, owner.isOrg);
	} catch (err) {
		vscode.window.showErrorMessage(
			`RepoDeck: couldn't read projects for ${owner.login}. Your token probably lacks the 'project' scope — sign out and sign in again. (${describe(err)})`,
		);
		return false;
	}

	// Adding an item to a project it's already on is a no-op that looks like a bug, so
	// those projects aren't offered.
	const already = new Set<string>(current ?? []);
	const available = projects.filter((p) => !already.has(p.id));

	const picked = await vscode.window.showQuickPick(
		[
			{ label: '$(add) New project…', id: '' },
			...available.map((p) => ({ label: p.title, description: `#${p.number}`, id: p.id })),
		],
		{ title: 'Add to project', ignoreFocusOut: true },
	);
	if (!picked) {
		return false;
	}

	const projectId = picked.id || (await createProjectCommand(context));
	if (!projectId) {
		return false;
	}

	await addIssueToProject(client, projectId, nodeId);
	await refreshBoard(context);
	vscode.window.showInformationMessage(`RepoDeck: added #${number} to the project.`);
	return true;
}

export async function setProjectStatus(
	{ context, client }: SidebarContext,
	msg: { projectId: string; itemId: string; fieldId: string; optionId?: string },
): Promise<boolean> {
	if (msg.optionId) {
		await moveCard(client, msg.projectId, msg.itemId, msg.fieldId, msg.optionId);
	} else {
		await clearItemField(client, msg.projectId, msg.itemId, msg.fieldId);
	}
	await refreshBoard(context);
	return true;
}

export async function removeFromProject(
	{ context, client, number }: SidebarContext,
	msg: { projectId: string; itemId: string; projectTitle: string },
): Promise<boolean> {
	const CONFIRM = 'Remove';
	const confirm = await vscode.window.showWarningMessage(
		`Remove #${number} from "${msg.projectTitle}"? The item itself is not deleted.`,
		{ modal: true },
		CONFIRM,
	);
	if (confirm !== CONFIRM) {
		return false;
	}
	await deleteItem(client, msg.projectId, msg.itemId);
	await refreshBoard(context);
	return true;
}
