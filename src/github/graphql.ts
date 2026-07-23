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

/** The eight colours GitHub allows on a single-select option. */
export const OPTION_COLORS = [
	'GRAY',
	'BLUE',
	'GREEN',
	'YELLOW',
	'ORANGE',
	'RED',
	'PINK',
	'PURPLE',
] as const;
export type OptionColor = (typeof OPTION_COLORS)[number];

export interface OptionInput {
	/** Omit to create a new option; pass the existing id to keep an option alive. */
	id?: string;
	name: string;
	color: OptionColor;
	description: string;
}

/** Iteration fields are the one field type GitHub's API cannot create. */
export type CreatableFieldType = 'TEXT' | 'NUMBER' | 'DATE' | 'SINGLE_SELECT';

export interface ProjectField {
	id: string;
	name: string;
	dataType: string;
	options?: { id: string; name: string; color?: string; description?: string }[];
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

/** Unsetting a field is a different mutation from setting one — there is no null value. */
export async function clearItemField(
	octokit: Octokit,
	projectId: string,
	itemId: string,
	fieldId: string,
): Promise<void> {
	await octokit.graphql(
		`mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!) {
			clearProjectV2ItemFieldValue(input: {
				projectId: $projectId, itemId: $itemId, fieldId: $fieldId
			}) { projectV2Item { id } }
		}`,
		{ projectId, itemId, fieldId },
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

/** An editable single-select field on a project item — Status, Priority, and so on. */
export interface ItemSelectField {
	fieldId: string;
	name: string;
	optionId: string | undefined;
	options: { id: string; name: string; color: string }[];
}

/** A field we can show but not yet edit (text, number, date, iteration). */
export interface ItemReadonlyField {
	name: string;
	value: string;
}

/** Where a single issue sits on the boards it's been added to. */
export interface IssueProjectLink {
	/** The ProjectV2Item id — what you need to move or remove it. */
	itemId: string;
	projectId: string;
	projectTitle: string;
	projectUrl: string;
	selectFields: ItemSelectField[];
	readonlyFields: ItemReadonlyField[];
}

/**
 * The projects an issue has been added to, with its status on each.
 *
 * An issue doesn't "belong to" a project — a ProjectV2Item does, and the item is the
 * thing every mutation keys off. So this returns item ids, not issue ids.
 */
export async function fetchIssueProjects(
	octokit: Octokit,
	owner: string,
	repo: string,
	number: number,
	// A pull request is its own GraphQL type, so the same selection has to hang off a
	// different top-level field. Only the field name differs — everything below is shared.
	kind: 'issue' | 'pullRequest' = 'issue',
): Promise<IssueProjectLink[]> {
	const data = await octokit.graphql<{
		repository: Record<
			string,
			{
				projectItems: {
					nodes: {
						id: string;
						project: {
							id: string;
							title: string;
							url: string;
							fields: { nodes: (ProjectField | Record<string, never>)[] };
						};
						fieldValues: { nodes: RawFieldValue[] };
					}[];
				};
			} | null
		>;
	}>(
		`query($owner: String!, $repo: String!, $number: Int!) {
			repository(owner: $owner, name: $repo) {
				${kind}(number: $number) {
					projectItems(first: 20) {
						nodes {
							id
							project {
								id title url
								fields(first: 50) {
									nodes {
										... on ProjectV2SingleSelectField {
											id name options { id name color }
										}
									}
								}
							}
							fieldValues(first: 30) {
								nodes {
									__typename
									... on ProjectV2ItemFieldSingleSelectValue {
										optionId
										field { ... on ProjectV2SingleSelectField { id name } }
									}
									... on ProjectV2ItemFieldTextValue {
										text
										field { ... on ProjectV2Field { name } }
									}
									... on ProjectV2ItemFieldNumberValue {
										number
										field { ... on ProjectV2Field { name } }
									}
									... on ProjectV2ItemFieldDateValue {
										date
										field { ... on ProjectV2Field { name } }
									}
									... on ProjectV2ItemFieldIterationValue {
										iterationTitle: title
										field { ... on ProjectV2IterationField { name } }
									}
								}
							}
						}
					}
				}
			}
		}`,
		{ owner, repo, number },
	);

	const nodes = data.repository[kind]?.projectItems.nodes ?? [];

	// A field with no value set doesn't appear in `fieldValues` at all, so the values alone
	// can't tell us which fields the item *could* have — the project's schema can. It comes
	// back in the query above; fetching it per item was an extra round trip per project.
	return nodes.map((item) => {
		const fields = (item.project.fields?.nodes ?? []).filter((f) => f?.id);
		const chosen = new Map<string, string>();
		const readonlyFields: ItemReadonlyField[] = [];

		for (const v of item.fieldValues.nodes) {
			if (v.__typename === 'ProjectV2ItemFieldSingleSelectValue' && v.field?.id && v.optionId) {
				chosen.set(v.field.id, v.optionId);
			} else if (v.field?.name) {
				const value =
					v.text ??
					(v.number !== undefined && v.number !== null ? String(v.number) : undefined) ??
					v.date ??
					v.iterationTitle;
				if (value) {
					readonlyFields.push({ name: v.field.name, value });
				}
			}
		}

		const selectFields: ItemSelectField[] = fields
			.filter((f) => f.options && f.options.length > 0)
			.map((f) => ({
				fieldId: f.id,
				name: f.name,
				optionId: chosen.get(f.id),
				options: f.options!.map((o) => ({ id: o.id, name: o.name, color: o.color ?? 'GRAY' })),
			}));

		return {
			itemId: item.id,
			projectId: item.project.id,
			projectTitle: item.project.title,
			projectUrl: item.project.url,
			selectFields,
			readonlyFields,
		};
	});
}

interface RawFieldValue {
	__typename: string;
	optionId?: string;
	text?: string;
	number?: number;
	date?: string;
	iterationTitle?: string;
	field?: { id?: string; name?: string };
}

// ---------------------------------------------------------------------------
// Authoring
// ---------------------------------------------------------------------------

/** Node ids, which every ProjectV2 mutation keys off rather than login/name. */
export async function getOwnerId(
	octokit: Octokit,
	login: string,
	isOrg: boolean,
): Promise<string> {
	const root = isOrg ? 'organization' : 'user';
	const data = await octokit.graphql<Record<string, { id: string }>>(
		`query($login: String!) { ${root}(login: $login) { id } }`,
		{ login },
	);
	return data[root].id;
}

export async function getRepositoryId(
	octokit: Octokit,
	owner: string,
	repo: string,
): Promise<string> {
	const data = await octokit.graphql<{ repository: { id: string } }>(
		`query($owner: String!, $repo: String!) { repository(owner: $owner, name: $repo) { id } }`,
		{ owner, repo },
	);
	return data.repository.id;
}

export async function createProject(
	octokit: Octokit,
	ownerId: string,
	title: string,
): Promise<{ id: string; number: number; url: string }> {
	const data = await octokit.graphql<{
		createProjectV2: { projectV2: { id: string; number: number; url: string } };
	}>(
		`mutation($ownerId: ID!, $title: String!) {
			createProjectV2(input: { ownerId: $ownerId, title: $title }) {
				projectV2 { id number url }
			}
		}`,
		{ ownerId, title },
	);
	return data.createProjectV2.projectV2;
}

/** Linking makes the project show up on the repo, and lets repo issues be added to it. */
export async function linkProjectToRepository(
	octokit: Octokit,
	projectId: string,
	repositoryId: string,
): Promise<void> {
	await octokit.graphql(
		`mutation($projectId: ID!, $repositoryId: ID!) {
			linkProjectV2ToRepository(input: { projectId: $projectId, repositoryId: $repositoryId }) {
				repository { id }
			}
		}`,
		{ projectId, repositoryId },
	);
}

export async function listFields(octokit: Octokit, projectId: string): Promise<ProjectField[]> {
	const data = await octokit.graphql<{
		node: { fields: { nodes: (ProjectField | Record<string, never>)[] } };
	}>(
		`query($id: ID!) {
			node(id: $id) {
				... on ProjectV2 {
					fields(first: 50) {
						nodes {
							... on ProjectV2Field { id name dataType }
							... on ProjectV2SingleSelectField {
								id name dataType
								options { id name color description }
							}
							... on ProjectV2IterationField { id name dataType }
						}
					}
				}
			}
		}`,
		{ id: projectId },
	);
	return (data.node.fields.nodes as ProjectField[]).filter((f) => f.id !== undefined);
}

export async function createField(
	octokit: Octokit,
	projectId: string,
	name: string,
	dataType: CreatableFieldType,
	options?: OptionInput[],
): Promise<void> {
	// The API rejects singleSelectOptions on non-select fields, so it has to be absent
	// rather than empty.
	const input =
		dataType === 'SINGLE_SELECT'
			? { projectId, name, dataType, singleSelectOptions: (options ?? []).map(stripId) }
			: { projectId, name, dataType };

	await octokit.graphql(
		`mutation($input: CreateProjectV2FieldInput!) {
			createProjectV2Field(input: $input) {
				projectV2Field { ... on ProjectV2Field { id } ... on ProjectV2SingleSelectField { id } }
			}
		}`,
		{ input },
	);
}

/**
 * Rewrites a single-select field's options.
 *
 * `updateProjectV2Field` REPLACES the option set rather than patching it: any existing
 * option whose `id` is not in this list is deleted, and every card holding that value
 * silently loses it. So callers must always pass the complete set — see `columnOps`,
 * which is the only thing that should build this list.
 */
export async function replaceFieldOptions(
	octokit: Octokit,
	fieldId: string,
	options: OptionInput[],
): Promise<void> {
	await octokit.graphql(
		`mutation($fieldId: ID!, $options: [ProjectV2SingleSelectFieldOptionInput!]!) {
			updateProjectV2Field(input: { fieldId: $fieldId, singleSelectOptions: $options }) {
				projectV2Field { ... on ProjectV2SingleSelectField { id } }
			}
		}`,
		{ fieldId, options },
	);
}

export async function renameField(octokit: Octokit, fieldId: string, name: string): Promise<void> {
	await octokit.graphql(
		`mutation($fieldId: ID!, $name: String!) {
			updateProjectV2Field(input: { fieldId: $fieldId, name: $name }) {
				projectV2Field { ... on ProjectV2Field { id } ... on ProjectV2SingleSelectField { id } }
			}
		}`,
		{ fieldId, name },
	);
}

export async function deleteField(octokit: Octokit, fieldId: string): Promise<void> {
	await octokit.graphql(
		`mutation($fieldId: ID!) {
			deleteProjectV2Field(input: { fieldId: $fieldId }) {
				projectV2Field { ... on ProjectV2Field { id } ... on ProjectV2SingleSelectField { id } }
			}
		}`,
		{ fieldId },
	);
}

/** A draft item lives only on the board — it is not an issue until it's converted. */
export async function addDraftItem(
	octokit: Octokit,
	projectId: string,
	title: string,
	body: string,
): Promise<string> {
	const data = await octokit.graphql<{ addProjectV2DraftIssue: { projectItem: { id: string } } }>(
		`mutation($projectId: ID!, $title: String!, $body: String!) {
			addProjectV2DraftIssue(input: { projectId: $projectId, title: $title, body: $body }) {
				projectItem { id }
			}
		}`,
		{ projectId, title, body },
	);
	return data.addProjectV2DraftIssue.projectItem.id;
}

/** Promotes a draft into a real issue in a repository, keeping its place on the board. */
export async function convertDraftToIssue(
	octokit: Octokit,
	itemId: string,
	repositoryId: string,
): Promise<void> {
	await octokit.graphql(
		`mutation($itemId: ID!, $repositoryId: ID!) {
			convertProjectV2DraftIssueItemToIssue(input: { itemId: $itemId, repositoryId: $repositoryId }) {
				item { id }
			}
		}`,
		{ itemId, repositoryId },
	);
}

/** Removes an item from the board. For a real issue this does NOT delete the issue. */
export async function deleteItem(
	octokit: Octokit,
	projectId: string,
	itemId: string,
): Promise<void> {
	await octokit.graphql(
		`mutation($projectId: ID!, $itemId: ID!) {
			deleteProjectV2Item(input: { projectId: $projectId, itemId: $itemId }) { deletedItemId }
		}`,
		{ projectId, itemId },
	);
}

function stripId(o: OptionInput) {
	return { name: o.name, color: o.color, description: o.description };
}
