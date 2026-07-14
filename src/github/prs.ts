import type { Octokit } from '@octokit/rest';
import type { RepoRef } from './repoContext';

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

export interface PullComment {
	author: string;
	body: string;
	createdAt: string;
	/** Set for review events (APPROVED / CHANGES_REQUESTED / COMMENTED). */
	reviewState?: string;
}

export interface PullCheck {
	name: string;
	/** 'success' | 'failure' | 'pending' — collapsed from two different GitHub APIs. */
	status: 'success' | 'failure' | 'pending';
}

export interface PullDetail {
	number: number;
	title: string;
	body: string;
	state: string;
	url: string;
	author: string;
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
	checks: PullCheck[];
	comments: PullComment[];
}

export async function fetchPull(
	octokit: Octokit,
	ref: RepoRef,
	number: number,
): Promise<PullDetail> {
	const { data: pr } = await octokit.rest.pulls.get({ ...ref, pull_number: number });

	const [comments, reviews, checks] = await Promise.all([
		// A PR's conversation lives on the *issue* endpoint; the pulls comment endpoint
		// returns line-level review comments, which is a different thing entirely.
		octokit.rest.issues
			.listComments({ ...ref, issue_number: number, per_page: 100 })
			.then((r) => r.data)
			.catch(() => []),
		octokit.rest.pulls
			.listReviews({ ...ref, pull_number: number, per_page: 100 })
			.then((r) => r.data)
			.catch(() => []),
		fetchChecks(octokit, ref, pr.head.sha),
	]);

	const merged: PullComment[] = [
		...comments.map((c) => ({
			author: c.user?.login ?? 'unknown',
			body: c.body ?? '',
			createdAt: c.created_at,
		})),
		...reviews
			// A review with no body and no state change is just noise in the timeline.
			.filter((r) => r.state !== 'PENDING' && (r.body || r.state !== 'COMMENTED'))
			.map((r) => ({
				author: r.user?.login ?? 'unknown',
				body: r.body ?? '',
				createdAt: r.submitted_at ?? '',
				reviewState: r.state,
			})),
	].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

	return {
		number: pr.number,
		title: pr.title,
		body: pr.body ?? '',
		state: pr.state,
		url: pr.html_url,
		author: pr.user?.login ?? 'unknown',
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
		checks,
		comments: merged,
	};
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

	const fromStatuses: PullCheck[] = statuses.map((s) => ({
		name: s.context,
		status: s.state === 'success' ? 'success' : s.state === 'failure' || s.state === 'error' ? 'failure' : 'pending',
	}));

	const fromRuns: PullCheck[] = runs.map((r) => ({
		name: r.name,
		status:
			r.status !== 'completed'
				? 'pending'
				: r.conclusion === 'success' || r.conclusion === 'neutral' || r.conclusion === 'skipped'
					? 'success'
					: 'failure',
	}));

	return [...fromRuns, ...fromStatuses];
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
