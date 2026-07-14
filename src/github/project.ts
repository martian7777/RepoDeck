import type { Octokit } from '@octokit/rest';

/**
 * One read of a Project that serves all three layouts.
 *
 * Board, Table and Roadmap are three renderings of the same items and fields, so they
 * share a single fetch. Anything layout-specific (which field groups the board, which
 * dates drive the roadmap) is decided by the caller, not here.
 */

export type FieldType = 'SINGLE_SELECT' | 'ITERATION' | 'TEXT' | 'NUMBER' | 'DATE' | 'OTHER';

export interface FieldOption {
	id: string;
	name: string;
	color: string;
}

export interface Iteration {
	id: string;
	title: string;
	startDate: string;
	duration: number;
}

export interface Field {
	id: string;
	name: string;
	type: FieldType;
	options: FieldOption[];
	iterations: Iteration[];
}

export type ItemKind = 'ISSUE' | 'PULL_REQUEST' | 'DRAFT';

/** A field's value on one item. Absent from the map entirely when unset. */
export type Value =
	| { kind: 'select'; optionId: string }
	| { kind: 'iteration'; iterationId: string }
	| { kind: 'text'; text: string }
	| { kind: 'number'; number: number }
	| { kind: 'date'; date: string };

export interface Item {
	/** ProjectV2Item id — what every field mutation keys off. NOT the issue id. */
	itemId: string;
	kind: ItemKind;
	/** The Issue/PR node id. Absent on drafts. */
	contentId: string | undefined;
	title: string;
	number: number | undefined;
	url: string | undefined;
	state: string | undefined;
	assignees: string[];
	labels: { name: string; color: string }[];
	values: Record<string, Value>;
}

export interface Project {
	id: string;
	title: string;
	url: string;
	fields: Field[];
	items: Item[];
	/** True when the project has more items than we were willing to load. */
	truncated: boolean;
}

/** A guard against a runaway project hanging the panel. 10 pages of 100. */
const MAX_ITEMS = 1000;
const PAGE = 100;

const ITEMS_QUERY = `
	query($id: ID!, $cursor: String) {
		node(id: $id) {
			... on ProjectV2 {
				title
				url
				fields(first: 50) {
					nodes {
						... on ProjectV2Field { id name dataType }
						... on ProjectV2SingleSelectField {
							id name dataType
							options { id name color }
						}
						... on ProjectV2IterationField {
							id name dataType
							configuration {
								iterations { id title startDate duration }
								completedIterations { id title startDate duration }
							}
						}
					}
				}
				items(first: ${PAGE}, after: $cursor) {
					pageInfo { hasNextPage endCursor }
					nodes {
						id
						fieldValues(first: 30) {
							nodes {
								__typename
								... on ProjectV2ItemFieldSingleSelectValue {
									optionId
									field { ... on ProjectV2SingleSelectField { id } }
								}
								... on ProjectV2ItemFieldIterationValue {
									iterationId
									field { ... on ProjectV2IterationField { id } }
								}
								... on ProjectV2ItemFieldTextValue {
									text
									field { ... on ProjectV2Field { id } }
								}
								... on ProjectV2ItemFieldNumberValue {
									number
									field { ... on ProjectV2Field { id } }
								}
								... on ProjectV2ItemFieldDateValue {
									date
									field { ... on ProjectV2Field { id } }
								}
							}
						}
						content {
							__typename
							... on Issue {
								id title number url state
								assignees(first: 10) { nodes { login } }
								labels(first: 10) { nodes { name color } }
							}
							... on PullRequest {
								id title number url state
								assignees(first: 10) { nodes { login } }
								labels(first: 10) { nodes { name color } }
							}
							... on DraftIssue { title }
						}
					}
				}
			}
		}
	}`;

export async function fetchProject(octokit: Octokit, projectId: string): Promise<Project> {
	let cursor: string | undefined;
	let title = '';
	let url = '';
	let fields: Field[] = [];
	const items: Item[] = [];
	let truncated = false;

	// The items connection pages at 100; a Table makes silent truncation obvious in a way
	// a board never did, so we walk the cursor rather than reading only the first page.
	for (;;) {
		const data: any = await octokit.graphql(ITEMS_QUERY, { id: projectId, cursor });
		const node = data.node;

		if (!fields.length) {
			title = node.title;
			url = node.url;
			fields = (node.fields.nodes as any[]).filter((f) => f?.id).map(toField);
		}

		for (const raw of node.items.nodes as any[]) {
			items.push(toItem(raw));
		}

		if (items.length >= MAX_ITEMS) {
			truncated = node.items.pageInfo.hasNextPage;
			break;
		}
		if (!node.items.pageInfo.hasNextPage) {
			break;
		}
		cursor = node.items.pageInfo.endCursor;
	}

	return { id: projectId, title, url, fields, items, truncated };
}

function toField(raw: any): Field {
	const type: FieldType =
		raw.dataType === 'SINGLE_SELECT'
			? 'SINGLE_SELECT'
			: raw.dataType === 'ITERATION'
				? 'ITERATION'
				: raw.dataType === 'TEXT'
					? 'TEXT'
					: raw.dataType === 'NUMBER'
						? 'NUMBER'
						: raw.dataType === 'DATE'
							? 'DATE'
							: 'OTHER';

	// Completed iterations still hold items, so a roadmap that ignores them loses history.
	const config = raw.configuration;
	const iterations: Iteration[] = [
		...(config?.iterations ?? []),
		...(config?.completedIterations ?? []),
	];

	return {
		id: raw.id,
		name: raw.name,
		type,
		options: raw.options ?? [],
		iterations,
	};
}

function toItem(raw: any): Item {
	const content = raw.content;
	const kind: ItemKind =
		content?.__typename === 'PullRequest'
			? 'PULL_REQUEST'
			: content?.__typename === 'DraftIssue'
				? 'DRAFT'
				: 'ISSUE';

	const values: Record<string, Value> = {};
	for (const v of raw.fieldValues.nodes as any[]) {
		const fieldId = v.field?.id;
		if (!fieldId) {
			continue;
		}
		switch (v.__typename) {
			case 'ProjectV2ItemFieldSingleSelectValue':
				values[fieldId] = { kind: 'select', optionId: v.optionId };
				break;
			case 'ProjectV2ItemFieldIterationValue':
				values[fieldId] = { kind: 'iteration', iterationId: v.iterationId };
				break;
			case 'ProjectV2ItemFieldTextValue':
				values[fieldId] = { kind: 'text', text: v.text };
				break;
			case 'ProjectV2ItemFieldNumberValue':
				values[fieldId] = { kind: 'number', number: v.number };
				break;
			case 'ProjectV2ItemFieldDateValue':
				values[fieldId] = { kind: 'date', date: v.date };
				break;
		}
	}

	return {
		itemId: raw.id,
		kind,
		contentId: content?.id,
		title: content?.title ?? '(untitled)',
		number: content?.number,
		url: content?.url,
		state: content?.state,
		assignees: content?.assignees?.nodes.map((a: any) => a.login) ?? [],
		labels: content?.labels?.nodes.map((l: any) => ({ name: l.name, color: l.color })) ?? [],
		values,
	};
}

/**
 * Writes any field type.
 *
 * `updateProjectV2ItemFieldValue` takes a different key per type — there is no generic
 * "value" — so this is the one place that knows the mapping. Passing `undefined` clears
 * the field, which is a separate mutation entirely.
 */
export async function setItemField(
	octokit: Octokit,
	projectId: string,
	itemId: string,
	fieldId: string,
	value: Value | undefined,
): Promise<void> {
	if (!value) {
		await octokit.graphql(
			`mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!) {
				clearProjectV2ItemFieldValue(input: {
					projectId: $projectId, itemId: $itemId, fieldId: $fieldId
				}) { projectV2Item { id } }
			}`,
			{ projectId, itemId, fieldId },
		);
		return;
	}

	const payload =
		value.kind === 'select'
			? { singleSelectOptionId: value.optionId }
			: value.kind === 'iteration'
				? { iterationId: value.iterationId }
				: value.kind === 'text'
					? { text: value.text }
					: value.kind === 'number'
						? { number: value.number }
						: { date: value.date };

	await octokit.graphql(
		`mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: ProjectV2FieldValue!) {
			updateProjectV2ItemFieldValue(input: {
				projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: $value
			}) { projectV2Item { id } }
		}`,
		{ projectId, itemId, fieldId, value: payload },
	);
}
