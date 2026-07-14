import * as vscode from 'vscode';
import { getOctokit } from '../auth/session';
import { readRepoState } from '../github/repoContext';
import {
	createProject,
	getOwnerId,
	getRepositoryId,
	linkProjectToRepository,
} from '../github/graphql';
import { describe, pickOwner } from './initRepo';

/**
 * Creates a Project v2 and links it to this repository.
 *
 * Projects belong to a user or an org, never to a repo — linking is what makes one show
 * up on the repo's Projects tab and lets its issues be added to the board.
 *
 * A new project comes with a default single-select "Status" field (Todo / In Progress /
 * Done), so it is a usable board the moment it exists.
 */
export async function createProjectCommand(
	context: vscode.ExtensionContext,
): Promise<string | undefined> {
	const [state, octokit] = await Promise.all([readRepoState(), getOctokit(context)]);
	if (!octokit) {
		return undefined;
	}

	const owner = await pickOwner(context, 'New project (1/2) — owner');
	if (!owner) {
		return undefined;
	}

	const title = await vscode.window.showInputBox({
		title: 'New project (2/2)',
		prompt: 'Project name',
		value: state.ref?.repo ?? '',
		ignoreFocusOut: true,
		validateInput: (v) => (v.trim() ? undefined : 'A name is required.'),
	});
	if (!title) {
		return undefined;
	}

	return vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: `Creating "${title.trim()}"…` },
		async () => {
			try {
				const ownerId = await getOwnerId(octokit, owner.login, owner.isOrg);
				const project = await createProject(octokit, ownerId, title.trim());

				if (state.ref) {
					// Linking can fail on its own (org project, repo you only read) without
					// the project itself being a failure — so it doesn't take the flow down.
					try {
						const repositoryId = await getRepositoryId(octokit, state.ref.owner, state.ref.repo);
						await linkProjectToRepository(octokit, project.id, repositoryId);
					} catch (err) {
						vscode.window.showWarningMessage(
							`RepoDeck: created the project, but couldn't link it to ${state.ref.owner}/${state.ref.repo}. ${describe(err)}`,
						);
					}
				}

				await vscode.workspace
					.getConfiguration('repodeck')
					.update('defaultProject', project.id, vscode.ConfigurationTarget.Workspace);
				// The board is grouped by whatever field we pick first; a fresh project's
				// only single-select field is Status, so clear any stale choice.
				await vscode.workspace
					.getConfiguration('repodeck')
					.update('boardField', '', vscode.ConfigurationTarget.Workspace);

				vscode.window.showInformationMessage(`RepoDeck: created the project "${title.trim()}".`);
				return project.id;
			} catch (err) {
				vscode.window.showErrorMessage(`RepoDeck: couldn't create the project. ${describe(err)}`);
				return undefined;
			}
		},
	);
}
