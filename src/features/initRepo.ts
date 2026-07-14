import * as vscode from 'vscode';
import * as path from 'node:path';
import { getOctokit } from '../auth/session';
import { git, refreshRepoContext, workspaceRoot } from '../github/repoContext';

/** git init → create on GitHub → origin → initial commit → push -u. */
export async function initRepo(context: vscode.ExtensionContext): Promise<void> {
	const root = workspaceRoot();
	if (!root) {
		vscode.window.showErrorMessage('RepoDeck: open a folder first.');
		return;
	}

	const octokit = await getOctokit(context);
	if (!octokit) {
		return;
	}

	if ((await git(root, 'remote', 'get-url', 'origin')) !== undefined) {
		vscode.window.showInformationMessage("RepoDeck: this folder already has an 'origin' remote.");
		return;
	}

	const name = await vscode.window.showInputBox({
		title: 'Initialize Repository (1/4)',
		prompt: 'Repository name',
		value: path.basename(root),
		ignoreFocusOut: true,
		validateInput: (v) =>
			/^[A-Za-z0-9._-]+$/.test(v) ? undefined : 'Letters, numbers, dot, dash, underscore only.',
	});
	if (!name) {
		return;
	}

	const description = await vscode.window.showInputBox({
		title: 'Initialize Repository (2/4)',
		prompt: 'Description (optional)',
		ignoreFocusOut: true,
	});
	if (description === undefined) {
		return;
	}

	const visibility = await vscode.window.showQuickPick(
		[
			{ label: '$(lock) Private', value: true },
			{ label: '$(globe) Public', value: false },
		],
		{ title: 'Initialize Repository (3/4)', placeHolder: 'Visibility', ignoreFocusOut: true },
	);
	if (!visibility) {
		return;
	}

	const owner = await pickOwner(context, 'Initialize Repository (4/4)');
	if (!owner) {
		return;
	}

	await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: `Creating ${owner.login}/${name}…` },
		async (progress) => {
			try {
				progress.report({ message: 'Creating repository on GitHub' });
				const created = owner.isOrg
					? await octokit.rest.repos.createInOrg({
							org: owner.login,
							name,
							description: description || undefined,
							private: visibility.value,
						})
					: await octokit.rest.repos.createForAuthenticatedUser({
							name,
							description: description || undefined,
							private: visibility.value,
						});

				progress.report({ message: 'Wiring up the local repository' });
				if ((await git(root, 'rev-parse', '--is-inside-work-tree')) !== 'true') {
					await git(root, 'init');
				}

				// GitHub defaults to `main`; match it so the first push isn't on `master`.
				const branch = created.data.default_branch || 'main';
				await git(root, 'checkout', '-B', branch);

				if ((await git(root, 'rev-parse', '--verify', 'HEAD')) === undefined) {
					// An empty tree cannot be pushed, so a repo with no commits needs one.
					// --allow-empty covers the case where the folder itself is empty.
					await git(root, 'add', '-A');
					await git(root, 'commit', '--allow-empty', '-m', 'Initial commit');
				}

				await git(root, 'remote', 'add', 'origin', created.data.clone_url);

				progress.report({ message: 'Pushing' });
				const pushed = await git(root, 'push', '-u', 'origin', branch);
				if (pushed === undefined) {
					vscode.window.showWarningMessage(
						`RepoDeck: created ${created.data.full_name}, but the push failed. Check your git credentials, then push manually.`,
					);
				} else {
					vscode.window.showInformationMessage(`RepoDeck: created and pushed ${created.data.full_name}.`);
				}

				await refreshRepoContext();
			} catch (err) {
				vscode.window.showErrorMessage(`RepoDeck: ${describe(err)}`);
			}
		},
	);
}

interface Owner {
	login: string;
	isOrg: boolean;
}

/** Lets the user create under themselves or any org they belong to. */
export async function pickOwner(
	context: vscode.ExtensionContext,
	title: string,
): Promise<Owner | undefined> {
	const octokit = await getOctokit(context);
	if (!octokit) {
		return undefined;
	}

	const [me, orgs] = await Promise.all([
		octokit.rest.users.getAuthenticated(),
		octokit.rest.orgs.listForAuthenticatedUser({ per_page: 100 }).catch(() => ({ data: [] })),
	]);

	const items = [
		{ label: `$(person) ${me.data.login}`, description: 'Your account', owner: { login: me.data.login, isOrg: false } },
		...orgs.data.map((o) => ({
			label: `$(organization) ${o.login}`,
			description: 'Organization',
			owner: { login: o.login, isOrg: true },
		})),
	];

	if (items.length === 1) {
		return items[0].owner;
	}

	const picked = await vscode.window.showQuickPick(items, {
		title,
		placeHolder: 'Owner',
		ignoreFocusOut: true,
	});
	return picked?.owner;
}

export function describe(err: unknown): string {
	if (err && typeof err === 'object' && 'message' in err) {
		return String((err as { message: unknown }).message);
	}
	return String(err);
}
