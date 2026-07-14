import * as vscode from 'vscode';
import type { Octokit } from '@octokit/rest';
import {
	OPTION_COLORS,
	createField,
	deleteField,
	listFields,
	renameField,
	replaceFieldOptions,
	type CreatableFieldType,
	type OptionColor,
	type OptionInput,
	type ProjectField,
} from '../github/graphql';

/**
 * Every column edit goes through here.
 *
 * `updateProjectV2Field` replaces a single-select field's whole option set, so a rename
 * that forgets the other options deletes them — and every card in those columns loses its
 * status. To make that impossible, each operation re-reads the live options, transforms
 * the complete list, and writes it all back. Never build an option list anywhere else.
 */
async function editOptions(
	octokit: Octokit,
	projectId: string,
	fieldId: string,
	transform: (options: OptionInput[]) => OptionInput[],
): Promise<void> {
	const fields = await listFields(octokit, projectId);
	const field = fields.find((f) => f.id === fieldId);
	if (!field?.options) {
		throw new Error('That field no longer exists, or is not a single-select field.');
	}

	const current: OptionInput[] = field.options.map((o) => ({
		id: o.id,
		name: o.name,
		// A colour is mandatory on write even though it's optional on read.
		color: (o.color as OptionColor) ?? 'GRAY',
		description: o.description ?? '',
	}));

	await replaceFieldOptions(octokit, fieldId, transform(current));
}

export async function addColumn(
	octokit: Octokit,
	projectId: string,
	fieldId: string,
	name: string,
	color: OptionColor,
): Promise<void> {
	await editOptions(octokit, projectId, fieldId, (options) => {
		if (options.some((o) => o.name.toLowerCase() === name.toLowerCase())) {
			throw new Error(`A column called "${name}" already exists.`);
		}
		// No id on the new option — that's what marks it as a creation.
		return [...options, { name, color, description: '' }];
	});
}

export async function renameColumn(
	octokit: Octokit,
	projectId: string,
	fieldId: string,
	optionId: string,
	name: string,
): Promise<void> {
	await editOptions(octokit, projectId, fieldId, (options) =>
		options.map((o) => (o.id === optionId ? { ...o, name } : o)),
	);
}

export async function recolorColumn(
	octokit: Octokit,
	projectId: string,
	fieldId: string,
	optionId: string,
	color: OptionColor,
): Promise<void> {
	await editOptions(octokit, projectId, fieldId, (options) =>
		options.map((o) => (o.id === optionId ? { ...o, color } : o)),
	);
}

export async function deleteColumn(
	octokit: Octokit,
	projectId: string,
	fieldId: string,
	optionId: string,
): Promise<void> {
	await editOptions(octokit, projectId, fieldId, (options) => {
		const remaining = options.filter((o) => o.id !== optionId);
		if (remaining.length === 0) {
			throw new Error("A board needs at least one column, so the last one can't be deleted.");
		}
		return remaining;
	});
}

/** Asks for a colour. Returned as the enum GitHub wants, not a hex value. */
export async function pickColor(title: string): Promise<OptionColor | undefined> {
	const picked = await vscode.window.showQuickPick(
		OPTION_COLORS.map((c) => ({ label: c.charAt(0) + c.slice(1).toLowerCase(), value: c })),
		{ title, placeHolder: 'Colour', ignoreFocusOut: true },
	);
	return picked?.value;
}

// ---------------------------------------------------------------------------
// Field management
// ---------------------------------------------------------------------------

/** A QuickPick-driven field manager. Fields are rare, deliberate edits — not a UI worth a webview. */
export async function manageFields(
	octokit: Octokit,
	projectId: string,
	onChanged: () => Promise<void>,
): Promise<void> {
	const fields = await listFields(octokit, projectId);

	const items: (vscode.QuickPickItem & { field?: ProjectField; action?: 'create' })[] = [
		{ label: '$(add) New field…', action: 'create' },
		{ label: '', kind: vscode.QuickPickItemKind.Separator },
		...fields.map((f) => ({
			label: f.name,
			description: f.dataType.toLowerCase().replace('_', ' '),
			detail: f.options ? f.options.map((o) => o.name).join(' · ') : undefined,
			field: f,
		})),
	];

	const picked = await vscode.window.showQuickPick(items, {
		title: 'Project fields',
		placeHolder: 'Pick a field to edit, or create one',
		ignoreFocusOut: true,
	});
	if (!picked) {
		return;
	}

	if (picked.action === 'create') {
		await createFieldFlow(octokit, projectId);
		await onChanged();
		return;
	}

	const field = picked.field!;

	// GitHub's own API refuses to touch these: Title, Assignees, Labels and friends are
	// built in, and iteration fields cannot be created or edited through the API at all.
	const builtIn = ['Title', 'Assignees', 'Labels', 'Linked pull requests', 'Repository', 'Milestone', 'Reviewers'];
	if (builtIn.includes(field.name)) {
		vscode.window.showInformationMessage(`RepoDeck: "${field.name}" is a built-in field and can't be changed.`);
		return;
	}
	if (field.dataType === 'ITERATION') {
		vscode.window.showInformationMessage(
			`RepoDeck: iteration fields can't be created or edited through GitHub's API — only on github.com. RepoDeck can still show "${field.name}" on cards.`,
		);
		return;
	}

	const action = await vscode.window.showQuickPick(
		[
			{ label: '$(edit) Rename', value: 'rename' as const },
			{ label: '$(trash) Delete field', value: 'delete' as const },
		],
		{ title: field.name, ignoreFocusOut: true },
	);
	if (!action) {
		return;
	}

	if (action.value === 'rename') {
		const name = await vscode.window.showInputBox({
			title: `Rename "${field.name}"`,
			value: field.name,
			ignoreFocusOut: true,
			validateInput: (v) => (v.trim() ? undefined : 'A name is required.'),
		});
		if (name) {
			await renameField(octokit, field.id, name.trim());
			await onChanged();
		}
		return;
	}

	const CONFIRM = 'Delete field';
	const confirm = await vscode.window.showWarningMessage(
		`Delete the field "${field.name}"? Every value stored in it, on every item, is lost. This cannot be undone.`,
		{ modal: true },
		CONFIRM,
	);
	if (confirm === CONFIRM) {
		await deleteField(octokit, field.id);
		await onChanged();
	}
}

async function createFieldFlow(octokit: Octokit, projectId: string): Promise<void> {
	const type = await vscode.window.showQuickPick(
		[
			{ label: '$(list-selection) Single select', description: 'A set of options — can be used as board columns', value: 'SINGLE_SELECT' as const },
			{ label: '$(symbol-text) Text', value: 'TEXT' as const },
			{ label: '$(symbol-number) Number', value: 'NUMBER' as const },
			{ label: '$(calendar) Date', value: 'DATE' as const },
		],
		{ title: 'New field (1/2)', placeHolder: 'Field type', ignoreFocusOut: true },
	);
	if (!type) {
		return;
	}

	const name = await vscode.window.showInputBox({
		title: 'New field (2/2)',
		prompt: 'Field name',
		ignoreFocusOut: true,
		validateInput: (v) => (v.trim() ? undefined : 'A name is required.'),
	});
	if (!name) {
		return;
	}

	let options: OptionInput[] | undefined;
	if (type.value === 'SINGLE_SELECT') {
		const raw = await vscode.window.showInputBox({
			title: `Options for "${name.trim()}"`,
			prompt: 'Comma-separated. A single-select field must have at least one option.',
			value: 'Todo, In Progress, Done',
			ignoreFocusOut: true,
			validateInput: (v) => (v.split(',').some((s) => s.trim()) ? undefined : 'At least one option is required.'),
		});
		if (!raw) {
			return;
		}
		const palette = ['GRAY', 'BLUE', 'GREEN', 'YELLOW', 'ORANGE', 'RED', 'PINK', 'PURPLE'] as const;
		options = raw
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean)
			.map((n, i) => ({ name: n, color: palette[i % palette.length], description: '' }));
	}

	await createField(octokit, projectId, name.trim(), type.value as CreatableFieldType, options);
	vscode.window.showInformationMessage(`RepoDeck: created the field "${name.trim()}".`);
}
