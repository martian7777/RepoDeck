import * as vscode from 'vscode';
import { getOctokit } from '../auth/session';
import { readRepoState } from '../github/repoContext';
import { describe } from './initRepo';
import {
	createVariable,
	deleteSecret,
	deleteVariable,
	updateVariable,
	upsertSecret,
	type Scope,
	type SecretSummary,
	type VariableSummary,
} from '../github/actions';

/** Secrets and variables share GitHub's name rules: letters, digits, underscores. */
function validateName(value: string): string | undefined {
	const v = value.trim();
	if (!v) {
		return 'Name cannot be empty.';
	}
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(v)) {
		return 'Use letters, digits and underscores; must not start with a digit.';
	}
	if (/^GITHUB_/i.test(v)) {
		return 'Names starting with GITHUB_ are reserved.';
	}
	return undefined;
}

function scopeLabel(scope: Scope): string {
	return scope.kind === 'repo' ? 'repository' : `environment "${scope.name}"`;
}

/** Resolves an authenticated client and repo ref, reporting why if it can't. */
async function ready(context: vscode.ExtensionContext) {
	const [state, octokit] = await Promise.all([readRepoState(), getOctokit(context)]);
	if (!state.ref) {
		vscode.window.showErrorMessage('RepoDeck: no GitHub repository is connected.');
		return undefined;
	}
	if (!octokit) {
		return undefined;
	}
	return { ref: state.ref, octokit };
}

/**
 * Managing secrets and variables needs admin rights the token may not carry. GitHub answers
 * that with a 403, which as a raw message says nothing useful — so we translate it.
 */
async function run(
	title: string,
	action: () => Promise<void>,
	onDone: () => void,
): Promise<void> {
	try {
		await vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Notification, title },
			action,
		);
		onDone();
	} catch (err) {
		const status = (err as { status?: number })?.status;
		if (status === 403) {
			vscode.window.showErrorMessage(
				'RepoDeck: your GitHub token lacks admin access to this repository. Sign in again with a token that has the "repo" scope (or admin rights).',
			);
			return;
		}
		vscode.window.showErrorMessage(`RepoDeck: ${title.toLowerCase()} failed. ${describe(err)}`);
	}
}

// ---- Secrets ----

export async function addSecret(
	context: vscode.ExtensionContext,
	scope: Scope,
	onDone: () => void,
): Promise<void> {
	const ctx = await ready(context);
	if (!ctx) {
		return;
	}

	const name = await vscode.window.showInputBox({
		title: `New secret (${scopeLabel(scope)})`,
		prompt: 'Secret name',
		ignoreFocusOut: true,
		validateInput: validateName,
	});
	if (!name) {
		return;
	}

	const value = await promptForValue(`Value for ${name.trim()}`, true);
	if (value === undefined) {
		return;
	}

	await run(
		`Saving secret ${name.trim()}`,
		() => upsertSecret(ctx.octokit, ctx.ref, scope, name.trim(), value),
		onDone,
	);
}

export async function editSecret(
	context: vscode.ExtensionContext,
	secret: SecretSummary,
	scope: Scope,
	onDone: () => void,
): Promise<void> {
	const ctx = await ready(context);
	if (!ctx) {
		return;
	}

	// GitHub never returns a secret's value, so an update is always a fresh entry.
	const value = await promptForValue(`New value for ${secret.name}`, true);
	if (value === undefined) {
		return;
	}

	await run(
		`Updating secret ${secret.name}`,
		() => upsertSecret(ctx.octokit, ctx.ref, scope, secret.name, value),
		onDone,
	);
}

export async function removeSecret(
	context: vscode.ExtensionContext,
	secret: SecretSummary,
	scope: Scope,
	onDone: () => void,
): Promise<void> {
	const ctx = await ready(context);
	if (!ctx) {
		return;
	}
	if (!(await confirmDelete('secret', secret.name, scope))) {
		return;
	}
	await run(
		`Deleting secret ${secret.name}`,
		() => deleteSecret(ctx.octokit, ctx.ref, scope, secret.name),
		onDone,
	);
}

// ---- Variables ----

export async function addVariable(
	context: vscode.ExtensionContext,
	scope: Scope,
	onDone: () => void,
): Promise<void> {
	const ctx = await ready(context);
	if (!ctx) {
		return;
	}

	const name = await vscode.window.showInputBox({
		title: `New variable (${scopeLabel(scope)})`,
		prompt: 'Variable name',
		ignoreFocusOut: true,
		validateInput: validateName,
	});
	if (!name) {
		return;
	}

	const value = await promptForValue(`Value for ${name.trim()}`, false);
	if (value === undefined) {
		return;
	}

	await run(
		`Saving variable ${name.trim()}`,
		() => createVariable(ctx.octokit, ctx.ref, scope, name.trim(), value),
		onDone,
	);
}

export async function editVariable(
	context: vscode.ExtensionContext,
	variable: VariableSummary,
	scope: Scope,
	onDone: () => void,
): Promise<void> {
	const ctx = await ready(context);
	if (!ctx) {
		return;
	}

	const value = await vscode.window.showInputBox({
		title: `Edit variable ${variable.name}`,
		prompt: 'Variable value',
		value: variable.value,
		ignoreFocusOut: true,
	});
	if (value === undefined) {
		return;
	}

	await run(
		`Updating variable ${variable.name}`,
		() => updateVariable(ctx.octokit, ctx.ref, scope, variable.name, value),
		onDone,
	);
}

export async function removeVariable(
	context: vscode.ExtensionContext,
	variable: VariableSummary,
	scope: Scope,
	onDone: () => void,
): Promise<void> {
	const ctx = await ready(context);
	if (!ctx) {
		return;
	}
	if (!(await confirmDelete('variable', variable.name, scope))) {
		return;
	}
	await run(
		`Deleting variable ${variable.name}`,
		() => deleteVariable(ctx.octokit, ctx.ref, scope, variable.name),
		onDone,
	);
}

// ---- Shared prompts ----

function promptForValue(title: string, secret: boolean): Thenable<string | undefined> {
	return vscode.window.showInputBox({
		title,
		prompt: secret ? 'The value is encrypted before it leaves your machine.' : 'Value',
		password: secret,
		ignoreFocusOut: true,
		validateInput: (v) => (v.length === 0 ? 'Value cannot be empty.' : undefined),
	});
}

async function confirmDelete(
	kind: 'secret' | 'variable',
	name: string,
	scope: Scope,
): Promise<boolean> {
	const choice = await vscode.window.showWarningMessage(
		`Delete the ${kind} "${name}" from the ${scopeLabel(scope)}? This can't be undone.`,
		{ modal: true },
		'Delete',
	);
	return choice === 'Delete';
}
