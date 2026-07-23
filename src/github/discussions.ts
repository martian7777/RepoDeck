import type { Octokit } from '@octokit/rest';
import type { RepoRef } from './repoContext';

/**
 * GitHub Discussions.
 *
 * There is no REST API for discussions — every read and every mutation below is GraphQL,
 * and every id is an opaque node id (`D_kwDO…`, `DC_kwDO…`) rather than the numbers the
 * issue and pull request panels key off. Only the discussion *number* is human-facing.
 *
 * The other thing to know: replies are one level deep. `replyToId` must name a top-level
 * comment — GitHub rejects a reply to a reply — which is why `DiscussionComment.replies`
 * is never populated on a nested comment.
 */

export interface DiscussionCategory {
	id: string;
	name: string;
	/** The rendered character, e.g. "📣" — see `emojiChar`. */
	emoji: string;
	/** Q&A categories only: comments can be marked as the answer. */
	isAnswerable: boolean;
}

/** A row in the tree. */
export interface DiscussionSummary {
	number: number;
	title: string;
	url: string;
	author: string;
	categoryId: string;
	categoryName: string;
	upvotes: number;
	comments: number;
	answered: boolean;
	closed: boolean;
}

export interface DiscussionComment {
	/** Node id — what `updateDiscussionComment` and the upvote mutations key off. */
	id: string;
	body: string;
	author: string;
	avatarUrl: string;
	createdAt: string;
	/** Null until the body is edited, which is what the "edited" marker reads. */
	lastEditedAt?: string;
	url: string;
	upvotes: number;
	viewerHasUpvoted: boolean;
	viewerCanUpvote: boolean;
	viewerCanUpdate: boolean;
	viewerCanMarkAsAnswer: boolean;
	isAnswer: boolean;
	/** Always empty on a nested reply — GitHub allows only one level. */
	replies: DiscussionComment[];
}

export interface DiscussionDetail {
	id: string;
	number: number;
	title: string;
	body: string;
	url: string;
	author: string;
	authorAvatarUrl: string;
	createdAt: string;
	lastEditedAt?: string;
	closed: boolean;
	locked: boolean;
	upvotes: number;
	viewerHasUpvoted: boolean;
	viewerCanUpvote: boolean;
	viewerCanUpdate: boolean;
	category: DiscussionCategory;
	labels: { name: string; color: string }[];
	/** Derived from the authors — `Discussion` has no participants field. */
	participants: { login: string; avatarUrl: string }[];
	comments: DiscussionComment[];
}

/**
 * `emoji` comes back as a shortcode (`:mega:`); `emojiHTML` wraps the real character in a
 * div. Neither is directly renderable, so unwrap the HTML and fall back to the shortcode.
 */
function emojiChar(emojiHTML: string | undefined, emoji: string | undefined): string {
	const inner = /<div[^>]*>([\s\S]*?)<\/div>/.exec(emojiHTML ?? '')?.[1];
	return (inner ?? emojiHTML ?? emoji ?? '').trim();
}

const CATEGORY_FIELDS = 'id name emoji emojiHTML isAnswerable';

interface RawCategory {
	id: string;
	name: string;
	emoji?: string;
	emojiHTML?: string;
	isAnswerable: boolean;
}

function toCategory(c: RawCategory): DiscussionCategory {
	return {
		id: c.id,
		name: c.name,
		emoji: emojiChar(c.emojiHTML, c.emoji),
		isAnswerable: c.isAnswerable,
	};
}

/**
 * Whether the repository has Discussions turned on.
 *
 * A repo with the feature disabled answers `discussions` with an error rather than an
 * empty list, so the tree asks this first and shows a placeholder instead of failing.
 */
export async function discussionsEnabled(octokit: Octokit, ref: RepoRef): Promise<boolean> {
	const data = await octokit.graphql<{ repository: { hasDiscussionsEnabled: boolean } | null }>(
		`query($owner: String!, $repo: String!) {
			repository(owner: $owner, name: $repo) { hasDiscussionsEnabled }
		}`,
		{ owner: ref.owner, repo: ref.repo },
	);
	return data.repository?.hasDiscussionsEnabled ?? false;
}

export async function listCategories(
	octokit: Octokit,
	ref: RepoRef,
): Promise<DiscussionCategory[]> {
	const data = await octokit.graphql<{
		repository: { discussionCategories: { nodes: RawCategory[] } } | null;
	}>(
		`query($owner: String!, $repo: String!) {
			repository(owner: $owner, name: $repo) {
				discussionCategories(first: 25) { nodes { ${CATEGORY_FIELDS} } }
			}
		}`,
		{ owner: ref.owner, repo: ref.repo },
	);
	return (data.repository?.discussionCategories.nodes ?? []).map(toCategory);
}

export async function listDiscussions(
	octokit: Octokit,
	ref: RepoRef,
): Promise<DiscussionSummary[]> {
	const data = await octokit.graphql<{
		repository: {
			discussions: {
				nodes: {
					number: number;
					title: string;
					url: string;
					closed: boolean;
					isAnswered: boolean | null;
					author: { login: string } | null;
					category: { id: string; name: string };
					upvoteCount: number;
					comments: { totalCount: number };
				}[];
			};
		} | null;
	}>(
		`query($owner: String!, $repo: String!) {
			repository(owner: $owner, name: $repo) {
				discussions(first: 50, orderBy: {field: UPDATED_AT, direction: DESC}) {
					nodes {
						number title url closed isAnswered upvoteCount
						author { login }
						category { id name }
						comments { totalCount }
					}
				}
			}
		}`,
		{ owner: ref.owner, repo: ref.repo },
	);

	return (data.repository?.discussions.nodes ?? []).map((d) => ({
		number: d.number,
		title: d.title,
		url: d.url,
		author: d.author?.login ?? 'ghost',
		categoryId: d.category.id,
		categoryName: d.category.name,
		upvotes: d.upvoteCount,
		comments: d.comments.totalCount,
		// `isAnswered` is null outside an answerable category, which is not "unanswered".
		answered: d.isAnswered === true,
		closed: d.closed,
	}));
}

/** Every field a comment card needs, shared by top-level comments and their replies. */
const COMMENT_FIELDS = `
	id body createdAt lastEditedAt url
	upvoteCount viewerHasUpvoted viewerCanUpvote viewerCanUpdate
	viewerCanMarkAsAnswer isAnswer
	author { login avatarUrl }`;

interface RawComment {
	id: string;
	body: string;
	createdAt: string;
	lastEditedAt: string | null;
	url: string;
	upvoteCount: number;
	viewerHasUpvoted: boolean;
	viewerCanUpvote: boolean;
	viewerCanUpdate: boolean;
	viewerCanMarkAsAnswer: boolean;
	isAnswer: boolean;
	author: { login: string; avatarUrl: string } | null;
	replies?: { nodes: RawComment[] };
}

function toComment(c: RawComment): DiscussionComment {
	return {
		id: c.id,
		body: c.body ?? '',
		author: c.author?.login ?? 'ghost',
		avatarUrl: c.author?.avatarUrl ?? '',
		createdAt: c.createdAt,
		lastEditedAt: c.lastEditedAt ?? undefined,
		url: c.url,
		upvotes: c.upvoteCount,
		viewerHasUpvoted: c.viewerHasUpvoted,
		viewerCanUpvote: c.viewerCanUpvote,
		viewerCanUpdate: c.viewerCanUpdate,
		viewerCanMarkAsAnswer: c.viewerCanMarkAsAnswer,
		isAnswer: c.isAnswer,
		replies: (c.replies?.nodes ?? []).map(toComment),
	};
}

export async function fetchDiscussion(
	octokit: Octokit,
	ref: RepoRef,
	number: number,
): Promise<DiscussionDetail> {
	const data = await octokit.graphql<{
		repository: {
			discussion: {
				id: string;
				number: number;
				title: string;
				body: string;
				url: string;
				createdAt: string;
				lastEditedAt: string | null;
				closed: boolean;
				locked: boolean;
				upvoteCount: number;
				viewerHasUpvoted: boolean;
				viewerCanUpvote: boolean;
				viewerCanUpdate: boolean;
				author: { login: string; avatarUrl: string } | null;
				category: RawCategory;
				labels: { nodes: { name: string; color: string }[] } | null;
				comments: { nodes: RawComment[] };
			} | null;
		} | null;
	}>(
		`query($owner: String!, $repo: String!, $number: Int!) {
			repository(owner: $owner, name: $repo) {
				discussion(number: $number) {
					id number title body url createdAt lastEditedAt closed locked
					upvoteCount viewerHasUpvoted viewerCanUpvote viewerCanUpdate
					author { login avatarUrl }
					category { ${CATEGORY_FIELDS} }
					labels(first: 20) { nodes { name color } }
					comments(first: 50) {
						nodes {
							${COMMENT_FIELDS}
							replies(first: 50) { nodes { ${COMMENT_FIELDS} } }
						}
					}
				}
			}
		}`,
		{ owner: ref.owner, repo: ref.repo, number },
	);

	const d = data.repository?.discussion;
	if (!d) {
		throw new Error(`Discussion #${number} was not found.`);
	}

	const comments = d.comments.nodes.map(toComment);

	// Everyone who wrote something, opener first, in the order they appear.
	const participants = new Map<string, { login: string; avatarUrl: string }>();
	const remember = (login: string, avatarUrl: string) => {
		if (login && login !== 'ghost' && !participants.has(login)) {
			participants.set(login, { login, avatarUrl });
		}
	};
	remember(d.author?.login ?? '', d.author?.avatarUrl ?? '');
	for (const c of comments) {
		remember(c.author, c.avatarUrl);
		for (const r of c.replies) {
			remember(r.author, r.avatarUrl);
		}
	}

	return {
		id: d.id,
		number: d.number,
		title: d.title,
		body: d.body ?? '',
		url: d.url,
		author: d.author?.login ?? 'ghost',
		authorAvatarUrl: d.author?.avatarUrl ?? '',
		createdAt: d.createdAt,
		lastEditedAt: d.lastEditedAt ?? undefined,
		closed: d.closed,
		locked: d.locked,
		upvotes: d.upvoteCount,
		viewerHasUpvoted: d.viewerHasUpvoted,
		viewerCanUpvote: d.viewerCanUpvote,
		viewerCanUpdate: d.viewerCanUpdate,
		category: toCategory(d.category),
		labels: (d.labels?.nodes ?? []).map((l) => ({ name: l.name, color: l.color.replace(/^#/, '') })),
		participants: [...participants.values()],
		comments,
	};
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/** Posts a comment, or — with `replyToId` — a reply under a top-level comment. */
export async function addComment(
	octokit: Octokit,
	discussionId: string,
	body: string,
	replyToId?: string,
): Promise<void> {
	await octokit.graphql(
		`mutation($discussionId: ID!, $body: String!, $replyToId: ID) {
			addDiscussionComment(input: {
				discussionId: $discussionId, body: $body, replyToId: $replyToId
			}) { comment { id } }
		}`,
		{ discussionId, body, replyToId: replyToId ?? null },
	);
}

export async function updateCommentBody(
	octokit: Octokit,
	commentId: string,
	body: string,
): Promise<void> {
	await octokit.graphql(
		`mutation($commentId: ID!, $body: String!) {
			updateDiscussionComment(input: { commentId: $commentId, body: $body }) { comment { id } }
		}`,
		{ commentId, body },
	);
}

/**
 * Body, title and category all move through one mutation. Anything left undefined is
 * omitted from the input, so a rename doesn't quietly rewrite the body.
 */
export async function updateDiscussion(
	octokit: Octokit,
	discussionId: string,
	fields: { title?: string; body?: string; categoryId?: string },
): Promise<void> {
	await octokit.graphql(
		`mutation($input: UpdateDiscussionInput!) {
			updateDiscussion(input: $input) { discussion { id } }
		}`,
		{ input: { discussionId, ...fields } },
	);
}

export async function setDiscussionClosed(
	octokit: Octokit,
	discussionId: string,
	closed: boolean,
): Promise<void> {
	await octokit.graphql(
		closed
			? `mutation($discussionId: ID!) {
					closeDiscussion(input: { discussionId: $discussionId, reason: RESOLVED }) {
						discussion { id }
					}
				}`
			: `mutation($discussionId: ID!) {
					reopenDiscussion(input: { discussionId: $discussionId }) { discussion { id } }
				}`,
		{ discussionId },
	);
}

export async function setAnswer(
	octokit: Octokit,
	commentId: string,
	isAnswer: boolean,
): Promise<void> {
	await octokit.graphql(
		isAnswer
			? `mutation($id: ID!) { markDiscussionCommentAsAnswer(input: { id: $id }) { clientMutationId } }`
			: `mutation($id: ID!) { unmarkDiscussionCommentAsAnswer(input: { id: $id }) { clientMutationId } }`,
		{ id: commentId },
	);
}

/** The same mutation pair serves a discussion and a comment — both are upvotable subjects. */
export async function setUpvote(
	octokit: Octokit,
	subjectId: string,
	on: boolean,
): Promise<void> {
	await octokit.graphql(
		on
			? `mutation($subjectId: ID!) { addUpvote(input: { subjectId: $subjectId }) { clientMutationId } }`
			: `mutation($subjectId: ID!) { removeUpvote(input: { subjectId: $subjectId }) { clientMutationId } }`,
		{ subjectId },
	);
}

export async function createDiscussion(
	octokit: Octokit,
	repositoryId: string,
	categoryId: string,
	title: string,
	body: string,
): Promise<{ number: number; url: string }> {
	const data = await octokit.graphql<{
		createDiscussion: { discussion: { number: number; url: string } };
	}>(
		`mutation($repositoryId: ID!, $categoryId: ID!, $title: String!, $body: String!) {
			createDiscussion(input: {
				repositoryId: $repositoryId, categoryId: $categoryId, title: $title, body: $body
			}) { discussion { number url } }
		}`,
		{ repositoryId, categoryId, title, body },
	);
	return data.createDiscussion.discussion;
}
