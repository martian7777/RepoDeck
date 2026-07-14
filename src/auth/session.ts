import * as vscode from 'vscode';
import { Octokit } from '@octokit/rest';

/**
 * `project` is not implied by `repo`. Projects v2 is unreachable without it, and the
 * scope cannot be widened after the fact without a full re-auth, so it is requested
 * up front even though only the board needs it.
 */
export const SCOPES = ['repo', 'read:org', 'project'];

const PAT_KEY = 'repodeck.pat';

let octokit: Octokit | undefined;
let currentLogin: string | undefined;

const onDidChangeAuth = new vscode.EventEmitter<void>();
export const onDidChangeAuthentication = onDidChangeAuth.event;

export function getLogin(): string | undefined {
	return currentLogin;
}

/**
 * Resolves a token from the host's GitHub provider, falling back to a stored PAT.
 *
 * Antigravity and other VS Code forks do not necessarily ship Microsoft's GitHub
 * authentication provider, and when they do it may refuse the `project` scope. Neither
 * case is an error worth surfacing — it just means we ask the user for a token instead.
 */
async function resolveToken(
	context: vscode.ExtensionContext,
	interactive: boolean,
): Promise<string | undefined> {
	try {
		const session = await vscode.authentication.getSession('github', SCOPES, {
			createIfNone: interactive,
			silent: interactive ? undefined : true,
		});
		if (session?.accessToken) {
			return session.accessToken;
		}
	} catch {
		// No provider, or the provider rejected our scopes. Fall through to the PAT.
	}

	const stored = await context.secrets.get(PAT_KEY);
	if (stored) {
		return stored;
	}
	if (!interactive) {
		return undefined;
	}

	return promptForPat(context);
}

async function promptForPat(context: vscode.ExtensionContext): Promise<string | undefined> {
	const CREATE = 'Create a token on GitHub';
	const PASTE = 'Paste a token';
	const choice = await vscode.window.showInformationMessage(
		"RepoDeck needs a GitHub token with 'repo' and 'project' scopes. Your editor didn't provide one, so you can paste a personal access token instead.",
		{ modal: true },
		CREATE,
		PASTE,
	);
	if (!choice) {
		return undefined;
	}

	if (choice === CREATE) {
		await vscode.env.openExternal(
			vscode.Uri.parse(
				'https://github.com/settings/tokens/new?scopes=repo,read:org,project&description=RepoDeck',
			),
		);
	}

	const token = await vscode.window.showInputBox({
		title: 'RepoDeck: GitHub personal access token',
		prompt: "Needs the 'repo' and 'project' scopes.",
		password: true,
		ignoreFocusOut: true,
		placeHolder: 'ghp_… or github_pat_…',
		validateInput: (v) => (v.trim().length === 0 ? 'Token cannot be empty.' : undefined),
	});
	if (!token) {
		return undefined;
	}

	await context.secrets.store(PAT_KEY, token.trim());
	return token.trim();
}

/** Returns an authenticated client, prompting for auth if `interactive`. */
export async function getOctokit(
	context: vscode.ExtensionContext,
	interactive = true,
): Promise<Octokit | undefined> {
	if (octokit) {
		return octokit;
	}

	const token = await resolveToken(context, interactive);
	if (!token) {
		return undefined;
	}

	const client = new Octokit({ auth: token, userAgent: 'RepoDeck' });

	try {
		const { data } = await client.rest.users.getAuthenticated();
		currentLogin = data.login;
	} catch {
		// A stored PAT that no longer works is worse than no PAT: it fails every call
		// silently. Drop it so the next attempt re-prompts.
		await context.secrets.delete(PAT_KEY);
		if (interactive) {
			vscode.window.showErrorMessage('RepoDeck: that GitHub token was rejected. Sign in again.');
		}
		return undefined;
	}

	octokit = client;
	await vscode.commands.executeCommand('setContext', 'repodeck:signedIn', true);
	onDidChangeAuth.fire();
	return octokit;
}

/**
 * Whether the active token can reach Projects v2. A token without `project` scope can
 * still do everything else, so the board degrades rather than the extension failing.
 */
export async function hasProjectScope(context: vscode.ExtensionContext): Promise<boolean> {
	const client = await getOctokit(context, false);
	if (!client) {
		return false;
	}
	try {
		await client.graphql('query { viewer { projectsV2(first: 1) { totalCount } } }');
		return true;
	} catch {
		return false;
	}
}

export async function signOut(context: vscode.ExtensionContext): Promise<void> {
	await context.secrets.delete(PAT_KEY);
	octokit = undefined;
	currentLogin = undefined;
	await vscode.commands.executeCommand('setContext', 'repodeck:signedIn', false);
	onDidChangeAuth.fire();
	vscode.window.showInformationMessage(
		'RepoDeck: signed out. Tokens held by your editor must be removed from its own Accounts menu.',
	);
}
