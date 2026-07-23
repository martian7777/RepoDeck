import type { Octokit } from '@octokit/rest';
import type { RepoRef } from './repoContext';
import { fetchIssueProjects, type IssueProjectLink } from './graphql';
import { toTimeline, type TimelineEntry } from './timeline';

export type { TimelineEntry };

export interface IssueDetail {
	number: number;
	title: string;
	body: string;
	state: string;
	url: string;
	author: string;
	authorAvatarUrl: string;
	nodeId: string;
	createdAt: string;
	assignees: string[];
	labels: { name: string; color: string }[];
	milestone: string | undefined;
	/** Comments and events, oldest first. */
	timeline: TimelineEntry[];
	/** Empty when the token has no `project` scope — see `projectsReadable`. */
	projects: IssueProjectLink[];
	/** False when Projects couldn't be read, so the UI can explain rather than lie. */
	projectsReadable: boolean;
}

export async function fetchIssue(
	octokit: Octokit,
	ref: RepoRef,
	number: number,
): Promise<IssueDetail> {
	const [{ data: issue }, timeline, projects] = await Promise.all([
		octokit.rest.issues.get({ ...ref, issue_number: number }),
		// The timeline endpoint returns comments AND events in one ordered stream, which
		// is what the issue history actually is.
		octokit.rest.issues
			.listEventsForTimeline({ ...ref, issue_number: number, per_page: 100 })
			.then((r) => r.data)
			.catch(() => []),
		// Projects need the `project` scope, which the rest of the panel doesn't. A token
		// without it must not take the whole issue view down.
		fetchIssueProjects(octokit, ref.owner, ref.repo, number).then(
			(p) => ({ ok: true as const, p }),
			() => ({ ok: false as const, p: [] as IssueProjectLink[] }),
		),
	]);

	return {
		number: issue.number,
		title: issue.title,
		body: issue.body ?? '',
		state: issue.state,
		url: issue.html_url,
		author: issue.user?.login ?? 'unknown',
		authorAvatarUrl: issue.user?.avatar_url ?? '',
		nodeId: issue.node_id,
		createdAt: issue.created_at,
		assignees: (issue.assignees ?? []).map((a) => a.login),
		labels: (issue.labels ?? []).map((l) =>
			typeof l === 'string' ? { name: l, color: '888888' } : { name: l.name ?? '', color: l.color ?? '888888' },
		),
		milestone: issue.milestone?.title,
		timeline: toTimeline(timeline),
		projects: projects.p,
		projectsReadable: projects.ok,
	};
}

export async function commentOnIssue(
	octokit: Octokit,
	ref: RepoRef,
	number: number,
	body: string,
): Promise<void> {
	await octokit.rest.issues.createComment({ ...ref, issue_number: number, body });
}

/**
 * Editing a comment.
 *
 * The issue endpoints cover pull requests too — a PR's conversation comments are issue
 * comments — so the PR panel edits through these rather than a parallel set. Review bodies
 * are the exception; those live on `pulls.updateReview`.
 */
export async function updateComment(
	octokit: Octokit,
	ref: RepoRef,
	commentId: number,
	body: string,
): Promise<void> {
	await octokit.rest.issues.updateComment({ ...ref, comment_id: commentId, body });
}

/** Editing the description of an issue or a pull request. */
export async function updateBody(
	octokit: Octokit,
	ref: RepoRef,
	number: number,
	body: string,
): Promise<void> {
	await octokit.rest.issues.update({ ...ref, issue_number: number, body });
}

export async function setIssueState(
	octokit: Octokit,
	ref: RepoRef,
	number: number,
	state: 'open' | 'closed',
): Promise<void> {
	await octokit.rest.issues.update({ ...ref, issue_number: number, state });
}

/** Assignees, labels and milestone are all a whole-list replace, not a patch. */
export async function setAssignees(
	octokit: Octokit,
	ref: RepoRef,
	number: number,
	assignees: string[],
): Promise<void> {
	await octokit.rest.issues.update({ ...ref, issue_number: number, assignees });
}

export async function setLabels(
	octokit: Octokit,
	ref: RepoRef,
	number: number,
	labels: string[],
): Promise<void> {
	await octokit.rest.issues.setLabels({ ...ref, issue_number: number, labels });
}

export async function setMilestone(
	octokit: Octokit,
	ref: RepoRef,
	number: number,
	milestone: number | null,
): Promise<void> {
	await octokit.rest.issues.update({ ...ref, issue_number: number, milestone });
}

export async function listMilestones(octokit: Octokit, ref: RepoRef) {
	const { data } = await octokit.rest.issues.listMilestones({ ...ref, per_page: 100 });
	return data.map((m) => ({ number: m.number, title: m.title }));
}
