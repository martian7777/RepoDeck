/**
 * The issue/PR history, flattened.
 *
 * GitHub's timeline endpoint serves both issues and pull requests, so both panels build
 * their conversation from this one shape. Comments carry the identity the `…` menu needs —
 * a REST id to edit through, and an `html_url` to copy.
 */

/** One entry in the history: either a comment, or something that happened to it. */
export interface TimelineEntry {
	kind: 'comment' | 'event';
	actor: string;
	createdAt: string;
	/** Comments only. */
	body?: string;
	/** Comments only — the REST id, which is what `updateComment` keys off. */
	id?: number;
	/** Comments only — distinguishes an issue comment from a PR review. */
	commentKind?: 'comment' | 'review';
	/** Comments only — permalink, for "Copy link". */
	url?: string;
	/** Comments only — set when the body was edited after posting. */
	updatedAt?: string;
	/** Reviews only — APPROVED / CHANGES_REQUESTED / COMMENTED / DISMISSED. */
	reviewState?: string;
	/** Events only — already phrased for display, e.g. "assigned LRxDarkDevil". */
	text?: string;
	/** Events only — a glyph for the timeline rail. */
	icon?: string;
	/** Both — the author's avatar. The webview CSP allows https images. */
	avatarUrl?: string;
}

/**
 * Flattens GitHub's timeline into entries we can render.
 *
 * The endpoint returns dozens of event types with wildly different shapes, and it is a
 * moving target — so anything we don't explicitly phrase is dropped rather than shown as
 * a raw event name.
 */
export function toTimeline(events: any[]): TimelineEntry[] {
	const entries: TimelineEntry[] = [];

	// `committed` events have no `actor` — the author is git metadata on the commit — and a
	// busy PR emits dozens in a row. GitHub collapses each run into one "added N commits"
	// line, which is both truer to the source data and far less noise.
	let commitRun: any[] = [];
	const flushCommits = () => {
		if (commitRun.length === 0) {
			return;
		}
		const authors = new Set(commitRun.map((c) => c.author?.name ?? 'someone'));
		const [first] = authors;
		const n = commitRun.length;
		entries.push({
			kind: 'event',
			actor: authors.size > 1 ? `${first} and others` : (first ?? 'someone'),
			createdAt: commitRun[commitRun.length - 1].author?.date ?? '',
			text: n === 1 ? `added ${firstLine(commitRun[0].message)}` : `added ${n} commits`,
			icon: '◇',
		});
		commitRun = [];
	};

	for (const e of events) {
		if (e.event === 'committed') {
			commitRun.push(e);
			continue;
		}
		flushCommits();

		const actor = e.actor?.login ?? e.user?.login ?? 'someone';
		const avatarUrl = e.actor?.avatar_url ?? e.user?.avatar_url;
		const createdAt = e.created_at ?? e.submitted_at ?? '';

		if (e.event === 'commented') {
			entries.push({
				kind: 'comment',
				commentKind: 'comment',
				actor,
				avatarUrl,
				createdAt,
				body: e.body ?? '',
				id: e.id,
				url: e.html_url,
				updatedAt: e.updated_at !== e.created_at ? e.updated_at : undefined,
			});
			continue;
		}

		// A review threads inline the way GitHub shows it — but one with no body and no
		// verdict is just noise, so it's dropped rather than rendered as an empty card.
		if (e.event === 'reviewed') {
			if (e.state === 'PENDING' || (!e.body && e.state === 'COMMENTED')) {
				continue;
			}
			entries.push({
				kind: 'comment',
				commentKind: 'review',
				actor,
				avatarUrl,
				createdAt,
				body: e.body ?? '',
				id: e.id,
				url: e.html_url,
				reviewState: e.state,
			});
			continue;
		}

		const phrased = phrase(e);
		if (phrased) {
			entries.push({ kind: 'event', actor, avatarUrl, createdAt, ...phrased });
		}
	}
	flushCommits();

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

		// ---- Pull requests ---- (`committed` is aggregated in toTimeline, not phrased here)

		case 'head_ref_force_pushed':
			return { text: 'force-pushed the branch', icon: '⤴' };
		case 'head_ref_deleted':
			return { text: 'deleted the branch', icon: '⌫' };
		case 'head_ref_restored':
			return { text: 'restored the branch', icon: '⤶' };
		case 'base_ref_changed':
			return { text: 'changed the base branch', icon: '⇄' };
		case 'merged':
			return { text: `merged this into ${e.commit_id ? short(e.commit_id) : 'the base branch'}`, icon: '⑃' };
		case 'review_requested':
			return {
				text: `requested a review from ${e.requested_reviewer?.login ?? e.requested_team?.name ?? 'someone'}`,
				icon: '◎',
			};
		case 'review_request_removed':
			return {
				text: `removed the review request for ${e.requested_reviewer?.login ?? e.requested_team?.name ?? 'someone'}`,
				icon: '◎',
			};
		case 'review_dismissed':
			return { text: 'dismissed a review', icon: '◎' };
		case 'ready_for_review':
			return { text: 'marked this ready for review', icon: '◉' };
		case 'convert_to_draft':
			return { text: 'converted this to a draft', icon: '◌' };
		case 'auto_merge_enabled':
			return { text: 'enabled auto-merge', icon: '⑃' };
		case 'auto_merge_disabled':
			return { text: 'disabled auto-merge', icon: '⑃' };

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

function firstLine(message: string | undefined): string {
	const line = (message ?? '').split('\n')[0].trim();
	return line.length > 72 ? `${line.slice(0, 72)}…` : line || 'a commit';
}

export function short(sha: string): string {
	return sha.slice(0, 7);
}
