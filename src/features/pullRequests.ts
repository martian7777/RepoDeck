import * as vscode from 'vscode';
import { getOctokit } from '../auth/session';
import { git, readRepoState } from '../github/repoContext';
import { fetchPull, mergePull, setPullState, type MergeMethod } from '../github/prs';
import { describe } from './initRepo';

/**
 * Checks out a PR branch locally.
 *
 * Same-repo PRs get a real tracking branch, so the user can push follow-up commits. Fork
 * PRs can't — you can't push to someone else's branch — so they get a local mirror of
 * `pull/N/head`, which is read-only by nature and safe to force-update.
 */
export async function checkoutPull(
	context: vscode.ExtensionContext,
	number: number,
): Promise<void> {
	const [state, octokit] = await Promise.all([readRepoState(), getOctokit(context)]);
	if (!state.ref || !state.root || !octokit) {
		return;
	}
	const { root, ref } = state;

	// Checking out over uncommitted work either fails or silently drags the changes onto
	// another branch. Neither is acceptable without the user saying so.
	const dirty = await git(root, 'status', '--porcelain');
	if (dirty) {
		const PROCEED = 'Check out anyway';
		const choice = await vscode.window.showWarningMessage(
			'You have uncommitted changes. Checking out a pull request may carry them onto the new branch.',
			{ modal: true },
			PROCEED,
		);
		if (choice !== PROCEED) {
			return;
		}
	}

	await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: `Checking out #${number}…` },
		async () => {
			try {
				const pr = await fetchPull(octokit, ref, number);

				if (pr.isFork) {
					const local = `repodeck/pr-${number}`;
					const fetched = await git(root, 'fetch', 'origin', `pull/${number}/head`);
					if (fetched === undefined) {
						throw new Error(`Couldn't fetch pull/${number}/head.`);
					}
					// -B is safe here precisely because this branch is ours, not the author's.
					await git(root, 'checkout', '-B', local, 'FETCH_HEAD');
					vscode.window.showInformationMessage(
						`RepoDeck: on ${local} (read-only mirror of a fork — you can't push to it).`,
					);
					return;
				}

				await git(root, 'fetch', 'origin', pr.headRef);

				const exists = await git(root, 'rev-parse', '--verify', `refs/heads/${pr.headRef}`);
				if (exists) {
					// The branch already exists locally and may hold work we didn't create,
					// so switch to it rather than resetting it to the remote.
					await git(root, 'checkout', pr.headRef);
					vscode.window.showInformationMessage(
						`RepoDeck: on ${pr.headRef}. It already existed locally — pull if it's behind.`,
					);
				} else {
					await git(root, 'checkout', '-b', pr.headRef, '--track', `origin/${pr.headRef}`);
					vscode.window.showInformationMessage(`RepoDeck: on ${pr.headRef}.`);
				}
			} catch (err) {
				vscode.window.showErrorMessage(`RepoDeck: couldn't check out #${number}. ${describe(err)}`);
			}
		},
	);
}

/** Merge, with the method chosen at merge time and a real confirmation. */
export async function mergePullRequest(
	context: vscode.ExtensionContext,
	number: number,
	preselected?: MergeMethod,
): Promise<boolean> {
	const [state, octokit] = await Promise.all([readRepoState(), getOctokit(context)]);
	if (!state.ref || !octokit) {
		return false;
	}
	const ref = state.ref;

	let method = preselected;
	if (!method) {
		const picked = await vscode.window.showQuickPick(
			[
				{ label: '$(git-merge) Create a merge commit', value: 'merge' as const },
				{ label: '$(git-commit) Squash and merge', value: 'squash' as const },
				{ label: '$(git-branch) Rebase and merge', value: 'rebase' as const },
			],
			{ title: `Merge #${number}`, placeHolder: 'Merge method', ignoreFocusOut: true },
		);
		if (!picked) {
			return false;
		}
		method = picked.value;
	}

	const pr = await fetchPull(octokit, ref, number);

	if (pr.draft) {
		vscode.window.showWarningMessage(`RepoDeck: #${number} is a draft. Mark it ready for review first.`);
		return false;
	}
	if (pr.mergeable === false) {
		vscode.window.showErrorMessage(
			`RepoDeck: #${number} has conflicts with ${pr.baseRef} and can't be merged as-is.`,
		);
		return false;
	}

	const failing = pr.checks.filter((c) => c.status === 'failure');
	const warning = failing.length > 0 ? `\n\n${failing.length} check(s) are failing.` : '';

	// Merging is irreversible from the user's point of view, so it always confirms.
	const CONFIRM = 'Merge';
	const choice = await vscode.window.showWarningMessage(
		`Merge #${number} "${pr.title}" into ${pr.baseRef}?${warning}`,
		{ modal: true },
		CONFIRM,
	);
	if (choice !== CONFIRM) {
		return false;
	}

	try {
		await mergePull(octokit, ref, number, method);
	} catch (err) {
		vscode.window.showErrorMessage(`RepoDeck: merge failed. ${describe(err)}`);
		return false;
	}

	vscode.window.showInformationMessage(`RepoDeck: merged #${number}.`);

	if (!pr.isFork) {
		const DELETE = 'Delete branch';
		const after = await vscode.window.showInformationMessage(
			`Delete the branch ${pr.headRef}?`,
			DELETE,
		);
		if (after === DELETE) {
			try {
				await octokit.rest.git.deleteRef({ ...ref, ref: `heads/${pr.headRef}` });
				if (state.root) {
					await git(state.root, 'fetch', '--prune', 'origin');
				}
			} catch (err) {
				vscode.window.showWarningMessage(`RepoDeck: couldn't delete ${pr.headRef}. ${describe(err)}`);
			}
		}
	}

	return true;
}

export async function closePullRequest(
	context: vscode.ExtensionContext,
	number: number,
	state: 'open' | 'closed',
): Promise<boolean> {
	const [repo, octokit] = await Promise.all([readRepoState(), getOctokit(context)]);
	if (!repo.ref || !octokit) {
		return false;
	}
	try {
		await setPullState(octokit, repo.ref, number, state);
		vscode.window.showInformationMessage(
			`RepoDeck: ${state === 'closed' ? 'closed' : 'reopened'} #${number}.`,
		);
		return true;
	} catch (err) {
		vscode.window.showErrorMessage(`RepoDeck: ${describe(err)}`);
		return false;
	}
}
