import * as vscode from 'vscode';
import { getOctokit } from '../auth/session';
import { describe } from '../features/initRepo';
import { git, readRepoState } from '../github/repoContext';
import { renderHtml } from './webviewHost';

/** The Create Issue form. */
export async function openIssueForm(
	context: vscode.ExtensionContext,
	onCreated: () => void,
): Promise<void> {
	const [state, octokit] = await Promise.all([readRepoState(), getOctokit(context)]);
	if (!octokit) {
		return;
	}
	if (!state.ref) {
		vscode.window.showErrorMessage(
			'RepoDeck: no GitHub remote for this folder. Run "RepoDeck: Initialize Repository" first.',
		);
		return;
	}
	const ref = state.ref;

	const panel = createPanel(context, 'New Issue');

	panel.webview.onDidReceiveMessage(async (msg) => {
		switch (msg?.type) {
			case 'ready': {
				const { collaborators, labels } = await loadRepoOptions(octokit, ref);
				panel.webview.postMessage({
					type: 'init',
					mode: 'issue',
					repo: `${ref.owner}/${ref.repo}`,
					collaborators,
					labels,
				});
				return;
			}

			case 'submit': {
				try {
					const { data } = await octokit.rest.issues.create({
						...ref,
						title: msg.title,
						body: msg.body || undefined,
						assignees: msg.assignees ?? [],
						labels: msg.labels ?? [],
					});
					panel.dispose();
					onCreated();
					await announce(`RepoDeck: created #${data.number}.`, data.html_url);
				} catch (err) {
					panel.webview.postMessage({ type: 'error', message: describe(err) });
				}
				return;
			}

			case 'cancel':
				panel.dispose();
				return;
		}
	});
}

/**
 * The Create Pull Request form.
 *
 * A PR can only be opened from a branch that exists on the remote, so this pushes the
 * current branch first if it has no upstream — otherwise GitHub just rejects the create
 * with an unhelpful "head sha can't be blank".
 */
export async function openPullForm(
	context: vscode.ExtensionContext,
	onCreated: () => void,
): Promise<void> {
	const [state, octokit] = await Promise.all([readRepoState(), getOctokit(context)]);
	if (!octokit) {
		return;
	}
	if (!state.ref || !state.root) {
		vscode.window.showErrorMessage(
			'RepoDeck: no GitHub remote for this folder. Run "RepoDeck: Initialize Repository" first.',
		);
		return;
	}
	const { ref, root } = state;

	const head = await git(root, 'rev-parse', '--abbrev-ref', 'HEAD');
	if (!head || head === 'HEAD') {
		vscode.window.showErrorMessage('RepoDeck: you are not on a branch.');
		return;
	}

	const { data: repo } = await octokit.rest.repos.get({ owner: ref.owner, repo: ref.repo });
	if (head === repo.default_branch) {
		vscode.window.showErrorMessage(
			`RepoDeck: you're on ${repo.default_branch}. Create a branch before opening a pull request.`,
		);
		return;
	}

	const upstream = await git(root, 'rev-parse', '--abbrev-ref', `${head}@{upstream}`);
	if (!upstream) {
		const PUSH = `Push ${head}`;
		const choice = await vscode.window.showInformationMessage(
			`${head} isn't on GitHub yet. It has to be pushed before a pull request can be opened.`,
			{ modal: true },
			PUSH,
		);
		if (choice !== PUSH) {
			return;
		}
		const pushed = await vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Notification, title: `Pushing ${head}…` },
			() => git(root, 'push', '-u', 'origin', head),
		);
		if (pushed === undefined) {
			vscode.window.showErrorMessage(`RepoDeck: couldn't push ${head}.`);
			return;
		}
	}

	const panel = createPanel(context, `New Pull Request — ${head}`);

	panel.webview.onDidReceiveMessage(async (msg) => {
		switch (msg?.type) {
			case 'ready': {
				const [{ collaborators }, branches, lastCommit] = await Promise.all([
					loadRepoOptions(octokit, ref),
					octokit.rest.repos
						.listBranches({ ...ref, per_page: 100 })
						.then((r) => r.data.map((b) => b.name))
						.catch(() => [repo.default_branch]),
					git(root, 'log', '-1', '--pretty=%s'),
				]);

				panel.webview.postMessage({
					type: 'init',
					mode: 'pr',
					repo: `${ref.owner}/${ref.repo}`,
					collaborators,
					labels: [],
					head,
					branches: branches.filter((b) => b !== head),
					defaultBase: repo.default_branch,
					suggestedTitle: lastCommit ?? '',
				});
				return;
			}

			case 'submit': {
				try {
					const { data: pr } = await octokit.rest.pulls.create({
						...ref,
						title: msg.title,
						body: msg.body || undefined,
						head,
						base: msg.base,
						draft: !!msg.draft,
					});

					// Reviewers and assignees are separate endpoints; a failure on either
					// shouldn't lose the PR that was just created.
					if (msg.reviewers?.length) {
						await octokit.rest.pulls
							.requestReviewers({ ...ref, pull_number: pr.number, reviewers: msg.reviewers })
							.catch((err) =>
								vscode.window.showWarningMessage(
									`RepoDeck: opened #${pr.number}, but couldn't request reviewers. ${describe(err)}`,
								),
							);
					}
					if (msg.assignees?.length) {
						await octokit.rest.issues
							.addAssignees({ ...ref, issue_number: pr.number, assignees: msg.assignees })
							.catch(() => undefined);
					}

					panel.dispose();
					onCreated();
					await announce(`RepoDeck: opened #${pr.number}.`, pr.html_url);
				} catch (err) {
					panel.webview.postMessage({ type: 'error', message: describe(err) });
				}
				return;
			}

			case 'cancel':
				panel.dispose();
				return;
		}
	});
}

function createPanel(context: vscode.ExtensionContext, title: string): vscode.WebviewPanel {
	const panel = vscode.window.createWebviewPanel('repodeck.form', title, vscode.ViewColumn.Active, {
		enableScripts: true,
		localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
	});
	panel.webview.html = renderHtml(panel.webview, context.extensionUri, 'form', title);
	return panel;
}

async function loadRepoOptions(
	octokit: import('@octokit/rest').Octokit,
	ref: { owner: string; repo: string },
) {
	const [collaborators, labels] = await Promise.all([
		octokit.rest.repos
			.listCollaborators({ ...ref, per_page: 100 })
			.then((r) => r.data.map((c) => c.login))
			// Collaborators need push access to list; on a repo you only read, this 403s.
			.catch(() => [] as string[]),
		octokit.rest.issues
			.listLabelsForRepo({ ...ref, per_page: 100 })
			.then((r) => r.data.map((l) => ({ name: l.name, color: l.color })))
			.catch(() => [] as { name: string; color: string }[]),
	]);
	return { collaborators, labels };
}

async function announce(message: string, url: string): Promise<void> {
	const OPEN = 'Open on GitHub';
	const choice = await vscode.window.showInformationMessage(message, OPEN);
	if (choice === OPEN) {
		await vscode.env.openExternal(vscode.Uri.parse(url));
	}
}
