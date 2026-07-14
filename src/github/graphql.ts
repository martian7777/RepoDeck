import type { Octokit } from '@octokit/rest';

/**
 * Projects v2 has no REST API — everything here is GraphQL, and every call needs the
 * `project` scope.
 *
 * The central thing to understand: a board "column" is not a column. It is one option of
 * a single-select field (conventionally named "Status"). Moving a card is therefore not a
 * move — it is writing a new value into that field on that item.
 */

export interface ProjectSummary {
	id: string;
	number: number;
	title: string;
}

export interface BoardColumn {
	optionId: string;
	name: string;
	cards: BoardCard[];
}

export interface BoardCard {
	/** ProjectV2Item id — NOT the issue id. Mutations key off this. */
	itemId: string;
	title: string;
	number: number | undefined;
	url: string | undefined;
	state: string | undefined;
	assignees: string[];
	optionId: string | undefined;
}

export interface Board {
	projectId: string;
	title: string;
	/** The single-select field the columns come from. */
	fieldId: string;
	fieldName: string;
	columns: BoardColumn[];
	/** Items with no value for that field. GitHub shows these in a "No Status" column. */
	unassigned: BoardCard[];
}

/** Raised when a project has no single-select field, so it cannot be shown as a board. */
export class NoBoardFieldError extends Error {
	constructor(readonly projectTitle: string) {
		super(
			`"${projectTitle}" has no single-select field, so it has no board columns. Add a field like "Status" to this project on GitHub.`,
		);
	}
}

export async function listProjects(
	octokit: Octokit,
	owner: string,
	isOrg: boolean,
): Promise<ProjectSummary[]> {
	const root = isOrg ? 'organization' : 'user';
	const query = `
		query($login: String!) {
			${root}(login: $login) {
				projectsV2(first: 50, orderBy: {field: UPDATED_AT, direction: DESC}) {
					nodes { id number title closed }
				}
			}
		}`;

	const data = await octokit.graphql<Record<string, { projectsV2: { nodes: (ProjectSummary & { closed: boolean })[] } }>>(
		query,
		{ login: owner },
	);
	return (data[root]?.projectsV2.nodes ?? []).filter((p) => !p.closed);
}

interface RawField {
	id: string;
	name: string;
	options?: { id: string; name: string }[];
}

interface RawItem {
	id: string;
	fieldValueByName: { optionId: string } | null;
	content:
		| {
				title?: string;
				number?: number;
				url?: string;
				state?: string;
				assignees?: { nodes: { login: string }[] };
		  }
		| null;
}

export async function fetchBoard(octokit: Octokit, projectId: string): Promise<Board> {
	// One round trip for the schema and the items. `fieldValueByName` needs the field's
	// name, which we don't know yet, so the status value is read off each item's full
	// field-value list instead.
	const query = `
		query($id: ID!) {
			node(id: $id) {
				... on ProjectV2 {
					title
					fields(first: 50) {
						nodes {
							... on ProjectV2SingleSelectField { id name options { id name } }
						}
					}
					items(first: 100) {
						nodes {
							id
							fieldValues(first: 20) {
								nodes {
									... on ProjectV2ItemFieldSingleSelectValue {
										optionId
										field { ... on ProjectV2SingleSelectField { id } }
									}
								}
							}
							content {
								... on Issue {
									title number url state
									assignees(first: 5) { nodes { login } }
								}
								... on PullRequest {
									title number url state
									assignees(first: 5) { nodes { login } }
								}
								... on DraftIssue { title }
							}
						}
					}
				}
			}
		}`;

	const data = await octokit.graphql<{
		node: {
			title: string;
			fields: { nodes: (RawField | Record<string, never>)[] };
			items: {
				nodes: (Omit<RawItem, 'fieldValueByName'> & {
					fieldValues: { nodes: ({ optionId?: string; field?: { id?: string } } | Record<string, never>)[] };
				})[];
			};
		};
	}>(query, { id: projectId });

	const project = data.node;

	// Inline fragments on non-matching types yield `{}`, so anything without options is
	// a field type we can't build columns from.
	const field = (project.fields.nodes as RawField[]).find((f) => f.options && f.options.length > 0);
	if (!field) {
		throw new NoBoardFieldError(project.title);
	}

	const columns: BoardColumn[] = field.options!.map((o) => ({
		optionId: o.id,
		name: o.name,
		cards: [],
	}));
	const byOption = new Map(columns.map((c) => [c.optionId, c]));
	const unassigned: BoardCard[] = [];

	for (const item of project.items.nodes) {
		const value = item.fieldValues.nodes.find(
			(v) => 'optionId' in v && v.field?.id === field.id,
		) as { optionId: string } | undefined;

		const card: BoardCard = {
			itemId: item.id,
			title: item.content?.title ?? '(untitled)',
			number: item.content?.number,
			url: item.content?.url,
			state: item.content?.state,
			assignees: item.content?.assignees?.nodes.map((a) => a.login) ?? [],
			optionId: value?.optionId,
		};

		const column = value ? byOption.get(value.optionId) : undefined;
		if (column) {
			column.cards.push(card);
		} else {
			unassigned.push(card);
		}
	}

	return {
		projectId,
		title: project.title,
		fieldId: field.id,
		fieldName: field.name,
		columns,
		unassigned,
	};
}

/** Moving a card between columns. */
export async function moveCard(
	octokit: Octokit,
	projectId: string,
	itemId: string,
	fieldId: string,
	optionId: string,
): Promise<void> {
	await octokit.graphql(
		`mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
			updateProjectV2ItemFieldValue(input: {
				projectId: $projectId
				itemId: $itemId
				fieldId: $fieldId
				value: { singleSelectOptionId: $optionId }
			}) { projectV2Item { id } }
		}`,
		{ projectId, itemId, fieldId, optionId },
	);
}

/** Adds an existing issue (by its node id) to a project. */
export async function addIssueToProject(
	octokit: Octokit,
	projectId: string,
	contentId: string,
): Promise<string> {
	const data = await octokit.graphql<{ addProjectV2ItemById: { item: { id: string } } }>(
		`mutation($projectId: ID!, $contentId: ID!) {
			addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
				item { id }
			}
		}`,
		{ projectId, contentId },
	);
	return data.addProjectV2ItemById.item.id;
}
