import type { Octokit } from '@octokit/rest';
import type { RepoRef } from './repoContext';
import { fetchIssueProjects, type IssueProjectLink } from './graphql';
import { short, toTimeline, type TimelineEntry } from './timeline';

export interface PullSummary {
	number: number;
	title: string;
	state: string;
	url: string;
	author: string;
	draft: boolean;
	assignees: string[];
	/** Logins with a review requested — how "Waiting for My Review" is decided. */
	reviewers: string[];
}

export interface PullCheck {
	name: string;
	/** 'success' | 'failure' | 'pending' — collapsed from two different GitHub APIs. */
	status: 'success' | 'failure' | 'pending';
	/** The raw lifecycle stage, so a queued check reads differently from a running one. */
	state: 'queued' | 'in_progress' | 'completed';
	/** GitHub's own word for the outcome: success, failure, cancelled, skipped, … */
	conclusion?: string;
	/** Where the run's logs live; the check row links to it. */
	url?: string;
	/** "Successful in 53s" / "Queued — Waiting to run this check…" */
	detail: string;
}

export interface PullCommit {
	sha: string;
	shortSha: string;
	/** First line only — the rest is body text the list doesn't show. */
	message: string;
	author: string;
	avatarUrl: string;
	date: string;
	url: string;
}

export interface Participant {
	login: string;
	avatarUrl: string;
}

export interface PullDetail {
	number: number;
	title: string;
	body: string;
	state: string;
	url: string;
	author: string;
	authorAvatarUrl: string;
	nodeId: string;
	createdAt: string;
	draft: boolean;
	baseRef: string;
	headRef: string;
	/** True when the PR comes from a fork, which changes how we check it out. */
	isFork: boolean;
	merged: boolean;
	/** GitHub computes this asynchronously; null means "ask again in a moment". */
	mergeable: boolean | null;
	mergeStateStatus: string;
	changedFiles: number;
	additions: number;
	deletions: number;
	commits: number;
	assignees: string[];
	/** Logins with a review still outstanding. */
	reviewers: string[];
	labels: { name: string; color: string }[];
	milestone: string | undefined;
	checks: PullCheck[];
	/** Comments, reviews and events, oldest first. */
	timeline: TimelineEntry[];
	commitList: PullCommit[];
	participants: Participant[];
	/** Empty when the token has no `project` scope — see `projectsReadable`. */
	projects: IssueProjectLink[];
	/** False when Projects couldn't be read, so the UI can explain rather than lie. */
	projectsReadable: boolean;
}

export async function fetchPull(
	octokit: Octokit,
	ref: RepoRef,
	number: number,
): Promise<PullDetail> {
	const { data: pr } = await octokit.rest.pulls.get({ ...ref, pull_number: number });

	const [timeline, commits, checks, projects] = await Promise.all([
		// One ordered stream of comments, reviews and events — the same endpoint the issue
		// panel uses, because a pull request *is* an issue as far as this API is concerned.
		octokit.rest.issues
			.listEventsForTimeline({ ...ref, issue_number: number, per_page: 100 })
			.then((r) => r.data)
			.catch(() => []),
		octokit.rest.pulls
			.listCommits({ ...ref, pull_number: number, per_page: 100 })
			.then((r) => r.data)
			.catch(() => []),
		fetchChecks(octokit, ref, pr.head.sha),
		// Projects need the `project` scope, which the rest of the panel doesn't. A token
		// without it must not take the whole view down.
		fetchIssueProjects(octokit, ref.owner, ref.repo, number, 'pullRequest').then(
			(p) => ({ ok: true as const, p }),
			() => ({ ok: false as const, p: [] as IssueProjectLink[] }),
		),
	]);

	const entries = toTimeline(timeline);

	const commitList: PullCommit[] = commits.map((c) => ({
		sha: c.sha,
		shortSha: short(c.sha),
		message: (c.commit.message ?? '').split('\n')[0],
		author: c.author?.login ?? c.commit.author?.name ?? 'unknown',
		avatarUrl: c.author?.avatar_url ?? '',
		date: c.commit.author?.date ?? '',
		url: c.html_url,
	}));

	return {
		number: pr.number,
		title: pr.title,
		body: pr.body ?? '',
		state: pr.state,
		url: pr.html_url,
		author: pr.user?.login ?? 'unknown',
		authorAvatarUrl: pr.user?.avatar_url ?? '',
		nodeId: pr.node_id,
		createdAt: pr.created_at,
		draft: pr.draft ?? false,
		baseRef: pr.base.ref,
		headRef: pr.head.ref,
		isFork: pr.head.repo?.full_name !== pr.base.repo.full_name,
		merged: pr.merged ?? false,
		mergeable: pr.mergeable,
		mergeStateStatus: pr.mergeable_state ?? 'unknown',
		changedFiles: pr.changed_files ?? 0,
		additions: pr.additions ?? 0,
		deletions: pr.deletions ?? 0,
		commits: pr.commits ?? commitList.length,
		assignees: (pr.assignees ?? []).map((a) => a.login),
		reviewers: (pr.requested_reviewers ?? []).map((r) => r.login),
		labels: (pr.labels ?? []).map((l) => ({ name: l.name ?? '', color: l.color ?? '888888' })),
		milestone: pr.milestone?.title,
		checks,
		timeline: entries,
		commitList,
		participants: participantsOf(pr.user?.login, pr.user?.avatar_url, entries),
		projects: projects.p,
		projectsReadable: projects.ok,
	};
}

/** Everyone who has said something on the thread, author first, deduplicated by login. */
function participantsOf(
	author: string | undefined,
	authorAvatar: string | undefined,
	entries: TimelineEntry[],
): Participant[] {
	const seen = new Map<string, Participant>();
	if (author) {
		seen.set(author, { login: author, avatarUrl: authorAvatar ?? '' });
	}
	for (const e of entries) {
		if (e.kind === 'comment' && !seen.has(e.actor)) {
			seen.set(e.actor, { login: e.actor, avatarUrl: e.avatarUrl ?? '' });
		}
	}
	return [...seen.values()];
}

/**
 * CI results arrive through two unrelated APIs — the legacy commit-status API and the
 * newer check-runs API — and most repos use one or the other. Query both and merge.
 */
async function fetchChecks(octokit: Octokit, ref: RepoRef, sha: string): Promise<PullCheck[]> {
	const [statuses, runs] = await Promise.all([
		octokit.rest.repos
			.getCombinedStatusForRef({ ...ref, ref: sha })
			.then((r) => r.data.statuses)
			.catch(() => []),
		octokit.rest.checks
			.listForRef({ ...ref, ref: sha, per_page: 100 })
			.then((r) => r.data.check_runs)
			.catch(() => []),
	]);

	const fromRuns: PullCheck[] = runs.map((r) => {
		const state: PullCheck['state'] =
			r.status === 'completed' ? 'completed' : r.status === 'in_progress' ? 'in_progress' : 'queued';
		const status: PullCheck['status'] =
			state !== 'completed'
				? 'pending'
				: r.conclusion === 'success' || r.conclusion === 'neutral' || r.conclusion === 'skipped'
					? 'success'
					: 'failure';
		return {
			name: r.name,
			status,
			state,
			conclusion: r.conclusion ?? undefined,
			url: r.html_url ?? undefined,
			detail: detailFor(status, state, r.conclusion, r.started_at, r.completed_at),
		};
	});

	const fromStatuses: PullCheck[] = statuses.map((s) => {
		const status: PullCheck['status'] =
			s.state === 'success' ? 'success' : s.state === 'failure' || s.state === 'error' ? 'failure' : 'pending';
		return {
			name: s.context,
			status,
			state: status === 'pending' ? 'in_progress' : 'completed',
			conclusion: s.state,
			url: s.target_url ?? undefined,
			// Commit statuses carry a human description rather than timings.
			detail: s.description || detailFor(status, status === 'pending' ? 'in_progress' : 'completed'),
		};
	});

	return [...fromRuns, ...fromStatuses];
}

/** The right-hand text on a check row, phrased the way GitHub phrases it. */
function detailFor(
	status: PullCheck['status'],
	state: PullCheck['state'],
	conclusion?: string | null,
	startedAt?: string | null,
	completedAt?: string | null,
): string {
	if (state === 'queued') {
		return 'Queued — Waiting to run this check…';
	}
	if (state === 'in_progress') {
		return 'In progress — This check has started…';
	}

	const took = duration(startedAt, completedAt);
	const suffix = took ? ` in ${took}` : '';
	switch (conclusion) {
		case 'cancelled':
			return `Cancelled${suffix}`;
		case 'skipped':
			return 'Skipped';
		case 'neutral':
			return `Neutral${suffix}`;
		case 'timed_out':
			return `Timed out${suffix}`;
		case 'action_required':
			return 'Action required';
		default:
			return status === 'success' ? `Successful${suffix}` : `Failing${suffix}`;
	}
}

function duration(startedAt?: string | null, completedAt?: string | null): string | undefined {
	if (!startedAt || !completedAt) {
		return undefined;
	}
	const seconds = Math.round((Date.parse(completedAt) - Date.parse(startedAt)) / 1000);
	if (!Number.isFinite(seconds) || seconds < 0) {
		return undefined;
	}
	if (seconds < 60) {
		return `${seconds}s`;
	}
	const minutes = Math.floor(seconds / 60);
	const rest = seconds % 60;
	return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

export type MergeMethod = 'merge' | 'squash' | 'rebase';

export async function mergePull(
	octokit: Octokit,
	ref: RepoRef,
	number: number,
	method: MergeMethod,
): Promise<void> {
	await octokit.rest.pulls.merge({ ...ref, pull_number: number, merge_method: method });
}

export async function commentOnPull(
	octokit: Octokit,
	ref: RepoRef,
	number: number,
	body: string,
): Promise<void> {
	await octokit.rest.issues.createComment({ ...ref, issue_number: number, body });
}

export type ReviewEvent = 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';

export async function reviewPull(
	octokit: Octokit,
	ref: RepoRef,
	number: number,
	event: ReviewEvent,
	body: string,
): Promise<void> {
	await octokit.rest.pulls.createReview({ ...ref, pull_number: number, event, body });
}

/** A review body isn't an issue comment, so editing one needs its own endpoint. */
export async function updateReview(
	octokit: Octokit,
	ref: RepoRef,
	number: number,
	reviewId: number,
	body: string,
): Promise<void> {
	await octokit.rest.pulls.updateReview({ ...ref, pull_number: number, review_id: reviewId, body });
}

export async function requestReviewers(
	octokit: Octokit,
	ref: RepoRef,
	number: number,
	reviewers: string[],
): Promise<void> {
	await octokit.rest.pulls.requestReviewers({ ...ref, pull_number: number, reviewers });
}

export async function removeReviewers(
	octokit: Octokit,
	ref: RepoRef,
	number: number,
	reviewers: string[],
): Promise<void> {
	await octokit.rest.pulls.removeRequestedReviewers({
		...ref,
		pull_number: number,
		reviewers,
	});
}

export async function setPullState(
	octokit: Octokit,
	ref: RepoRef,
	number: number,
	state: 'open' | 'closed',
): Promise<void> {
	await octokit.rest.pulls.update({ ...ref, pull_number: number, state });
}

/** Turns a draft PR into a real one. This is GraphQL-only — there is no REST equivalent. */
export async function markReadyForReview(octokit: Octokit, nodeId: string): Promise<void> {
	await octokit.graphql(
		`mutation($id: ID!) {
			markPullRequestReadyForReview(input: { pullRequestId: $id }) {
				pullRequest { id }
			}
		}`,
		{ id: nodeId },
	);
}

/** The other direction — also GraphQL-only. */
export async function convertToDraft(octokit: Octokit, nodeId: string): Promise<void> {
	await octokit.graphql(
		`mutation($id: ID!) {
			convertPullRequestToDraft(input: { pullRequestId: $id }) {
				pullRequest { id }
			}
		}`,
		{ id: nodeId },
	);
}
