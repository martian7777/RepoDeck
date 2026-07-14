import type { Octokit } from '@octokit/rest';
import type { RepoRef } from './repoContext';
import { fetchIssueProjects, type IssueProjectLink } from './graphql';

export interface IssueComment {
	author: string;
	body: string;
	createdAt: string;
}

/** One entry in the issue history: either a comment, or something that happened to it. */
export interface TimelineEntry {
	kind: 'comment' | 'event';
	actor: string;
	createdAt: string;
	/** Comments only. */
	body?: string;
	/** Events only — already phrased for display, e.g. "assigned LRxDarkDevil". */
	text?: string;
	/** Events only — a glyph for the timeline rail. */
	icon?: string;
}

export interface IssueDetail {
	number: number;
	title: string;
	body: string;
	state: string;
	url: string;
	author: string;
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

/**
 * Flattens GitHub's timeline into entries we can render.
 *
 * The endpoint returns dozens of event types with wildly different shapes, and it is a
 * moving target — so anything we don't explicitly phrase is dropped rather than shown as
 * a raw event name.
 */
function toTimeline(events: any[]): TimelineEntry[] {
	const entries: TimelineEntry[] = [];

	for (const e of events) {
		const actor = e.actor?.login ?? e.user?.login ?? 'someone';
		const createdAt = e.created_at ?? e.submitted_at ?? '';

		if (e.event === 'commented') {
			entries.push({ kind: 'comment', actor, createdAt, body: e.body ?? '' });
			continue;
		}

		const phrased = phrase(e);
		if (phrased) {
			entries.push({ kind: 'event', actor, createdAt, ...phrased });
		}
	}

	return entries.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function phrase(e: any): { text: string; icon: string } | undefined {
	switch (e.event) {
		case 'assigned':
			return { text: `assigned ${e.assignee?.login ?? 'someone'}`, icon: '◍' };
		case 'unassigned':
			return { text: `unassigned ${e.assignee?.login ?? 'someone'}`, icon: '◍' };
		case 'labeled':
			return { text: `added the ${e.label?.name} label`, icon: '⬤' };
		case 'unlabeled':
			return { text: `removed the ${e.label?.name} label`, icon: '⬤' };
		case 'milestoned':
			return { text: `added this to the ${e.milestone?.title} milestone`, icon: '⚑' };
		case 'demilestoned':
			return { text: `removed this from the ${e.milestone?.title} milestone`, icon: '⚑' };
		case 'closed':
			return { text: 'closed this', icon: '✓' };
		case 'reopened':
			return { text: 'reopened this', icon: '○' };
		case 'renamed':
			return { text: `renamed this from "${e.rename?.from}"`, icon: '✎' };
		case 'referenced':
		case 'cross-referenced':
			return { text: 'referenced this', icon: '↗' };
		case 'added_to_project':
		case 'added_to_project_v2':
			return { text: 'added this to a project', icon: '▦' };
		case 'removed_from_project':
		case 'removed_from_project_v2':
			return { text: 'removed this from a project', icon: '▦' };
		case 'converted_note_to_issue':
			return { text: 'converted this from a draft issue', icon: '◌' };
		case 'project_v2_item_status_changed':
			return { text: 'moved this on a project', icon: '▦' };
		case 'connected':
		case 'disconnected':
		case 'subscribed':
		case 'unsubscribed':
		case 'mentioned':
			return undefined;
		default:
			return undefined;
	}
}

export async function commentOnIssue(
	octokit: Octokit,
	ref: RepoRef,
	number: number,
	body: string,
): Promise<void> {
	await octokit.rest.issues.createComment({ ...ref, issue_number: number, body });
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
