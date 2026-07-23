import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Editor } from '../shared/editor';
import { quote } from '../shared/commentMenu';
import { ActionButton, useOps, type Ops } from '../shared/ops';
import { Avatar, Timeline, type TimelineEntry } from '../shared/timeline';
import {
	LabelList,
	LoginList,
	Participants,
	Projects,
	Section,
	type ProjectLink,
} from '../shared/sidebar';
import { ago, exact } from '../shared/time';

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };
const vscode = acquireVsCodeApi();

interface Check {
	name: string;
	status: 'success' | 'failure' | 'pending';
	state: 'queued' | 'in_progress' | 'completed';
	conclusion?: string;
	url?: string;
	detail: string;
}
interface Commit {
	sha: string;
	shortSha: string;
	message: string;
	author: string;
	avatarUrl: string;
	date: string;
	url: string;
}
interface Pr {
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
	isFork: boolean;
	merged: boolean;
	mergeable: boolean | null;
	mergeStateStatus: string;
	changedFiles: number;
	additions: number;
	deletions: number;
	commits: number;
	assignees: string[];
	reviewers: string[];
	labels: { name: string; color: string }[];
	milestone?: string;
	checks: Check[];
	timeline: TimelineEntry[];
	commitList: Commit[];
	participants: { login: string; avatarUrl: string }[];
	projects: ProjectLink[];
	projectsReadable: boolean;
}

const MERGE_METHODS = [
	{ value: 'merge', label: 'Create a merge commit' },
	{ value: 'squash', label: 'Squash and merge' },
	{ value: 'rebase', label: 'Rebase and merge' },
];

function App() {
	const [pr, setPr] = useState<Pr | undefined>();
	const [viewer, setViewer] = useState('');
	const [error, setError] = useState<string | undefined>();
	const [actionError, setActionError] = useState<string | undefined>();
	const [loading, setLoading] = useState(true);
	const [draft, setDraft] = useState('');
	const [tab, setTab] = useState<'conversation' | 'commits'>('conversation');
	const composer = useRef<HTMLTextAreaElement | null>(null);
	const ops = useOps(vscode, () => setActionError(undefined));

	useEffect(() => {
		const onMessage = (e: MessageEvent) => {
			const msg = e.data;
			if (msg.type === 'pr') {
				setPr(msg.pr);
				setViewer(msg.viewer);
				setError(undefined);
				setLoading(false);
				setDraft('');
			} else if (msg.type === 'error') {
				setError(msg.message);
				setLoading(false);
			} else if (msg.type === 'actionError') {
				setActionError(msg.message);
			} else if (msg.type === 'loading') {
				setLoading(true);
			}
		};
		window.addEventListener('message', onMessage);
		vscode.postMessage({ type: 'ready' });
		return () => window.removeEventListener('message', onMessage);
	}, []);

	if (error) {
		return <div class="state">{error}</div>;
	}
	if (!pr) {
		return <div class="state">{loading ? 'Loading pull request…' : 'Nothing to show.'}</div>;
	}

	const own = pr.author === viewer;
	const closed = pr.state === 'closed';
	const active = !closed && !pr.merged;

	const send = ops.post;

	// Quote reply lands in the composer, which means switching back to Conversation if the
	// user is looking at Commits.
	const quoteReply = (body: string) => {
		setTab('conversation');
		setDraft((d) => `${d ? `${d.replace(/\n*$/, '')}\n\n` : ''}${quote(body)}`);
		requestAnimationFrame(() => {
			composer.current?.focus();
			composer.current?.scrollIntoView({ block: 'center' });
		});
	};

	const actions = {
		viewer,
		onCopyLink: (url: string) => send({ type: 'copyLink', url }),
		onCopyMarkdown: (body: string) => send({ type: 'copyMarkdown', body }),
		onQuoteReply: quoteReply,
		onSaveEdit: (entry: TimelineEntry, body: string) =>
			ops.run(`edit:${entry.id}`, {
				type: entry.commentKind === 'review' ? 'editReview' : 'editComment',
				id: entry.id,
				body,
			}),
	};

	return (
		<div class="pr">
			<header>
				<div>
					<h1>
						{pr.title} <span class="num">#{pr.number}</span>
					</h1>
					<p class="muted">
						<span
							class={`pill ${pr.merged ? 'merged' : closed ? 'closed' : pr.draft ? 'draft' : 'open'}`}
						>
							{pr.merged ? 'Merged' : closed ? 'Closed' : pr.draft ? 'Draft' : 'Open'}
						</span>{' '}
						<strong>{pr.author}</strong> wants to merge {pr.commits} commit
						{pr.commits === 1 ? '' : 's'} from <code>{pr.headRef}</code> into{' '}
						<code>{pr.baseRef}</code>
						{pr.isFork && ' (from a fork)'}
					</p>
				</div>
				<div class="actions">
					<button onClick={() => send({ type: 'refresh' })}>Refresh</button>
					<button onClick={() => send({ type: 'openExternal', url: pr.url })}>Open on GitHub</button>
					{loading && <span class="muted">Refreshing…</span>}
				</div>
			</header>

			{actionError && <p class="error">{actionError}</p>}

			<div class="tabs">
				<button
					class={tab === 'conversation' ? 'on' : undefined}
					onClick={() => setTab('conversation')}
				>
					Conversation <span class="count">{pr.timeline.filter((e) => e.kind === 'comment').length}</span>
				</button>
				<button class={tab === 'commits' ? 'on' : undefined} onClick={() => setTab('commits')}>
					Commits <span class="count">{pr.commits}</span>
				</button>
				<span class="stats">
					<span>
						{pr.changedFiles} file{pr.changedFiles === 1 ? '' : 's'}
					</span>
					<span class="add">+{pr.additions}</span>
					<span class="del">−{pr.deletions}</span>
				</span>
			</div>

			<div class="layout">
				<main>
					{tab === 'commits' ? (
						<Commits commits={pr.commitList} onOpen={(url) => send({ type: 'openExternal', url })} />
					) : (
						<>
							<Timeline
								lead={{
									author: pr.author,
									avatarUrl: pr.authorAvatarUrl,
									createdAt: pr.createdAt,
									body: pr.body,
									verb: 'commented',
									url: pr.url,
									canEdit: own,
									onSave: (body) => ops.run('editBody', { type: 'editBody', body }),
									empty: <p class="muted">No description provided.</p>,
								}}
								entries={pr.timeline}
								actions={actions}
							/>

							{pr.checks.length > 0 && <Checks checks={pr.checks} send={send} />}

							{active && <MergeBox pr={pr} ops={ops} />}

							<section class="compose">
								<h2>Add a comment</h2>
								<Editor
									value={draft}
									onInput={setDraft}
									textareaRef={composer}
									placeholder={
										own || !active
											? 'Add your comment here…'
											: 'Add your comment here, or write your review…'
									}
									footer={
										<>
											{active && (
												<ActionButton
													busy={ops.busy('state')}
													label="Close pull request"
													busyLabel="Closing…"
													onClick={() => ops.run('state', { type: 'setState', state: 'closed' })}
												/>
											)}
											{closed && !pr.merged && (
												<ActionButton
													busy={ops.busy('state')}
													label="Reopen pull request"
													busyLabel="Reopening…"
													onClick={() => ops.run('state', { type: 'setState', state: 'open' })}
												/>
											)}
											<ActionButton
												class="primary"
												busy={ops.busy('comment')}
												disabled={!draft.trim()}
												label="Comment"
												busyLabel="Commenting…"
												onClick={() => ops.run('comment', { type: 'comment', body: draft })}
											/>
										</>
									}
								/>

								{/* GitHub refuses reviews on your own pull request, so don't offer them. */}
								{active && !own && (
									<div class="actions review">
										<ActionButton
											busy={ops.busy('approve')}
											label="Approve"
											busyLabel="Approving…"
											onClick={() =>
												ops.run('approve', { type: 'review', event: 'APPROVE', body: draft })
											}
										/>
										<ActionButton
											busy={ops.busy('requestChanges')}
											disabled={!draft.trim()}
											label="Request changes"
											busyLabel="Requesting…"
											title={
												draft.trim()
													? undefined
													: 'GitHub requires a comment when requesting changes'
											}
											onClick={() =>
												ops.run('requestChanges', {
													type: 'review',
													event: 'REQUEST_CHANGES',
													body: draft,
												})
											}
										/>
									</div>
								)}
							</section>
						</>
					)}
				</main>

				<aside>
					<Section
						title="Reviewers"
						onEdit={active ? () => send({ type: 'editReviewers', current: pr.reviewers }) : undefined}
					>
						<LoginList logins={pr.reviewers} empty="No reviews requested" />
					</Section>

					<Section title="Assignees" onEdit={() => send({ type: 'editAssignees', current: pr.assignees })}>
						<LoginList logins={pr.assignees} empty="No one assigned" />
					</Section>

					<Section
						title="Labels"
						onEdit={() => send({ type: 'editLabels', current: pr.labels.map((l) => l.name) })}
					>
						<LabelList labels={pr.labels} />
					</Section>

					<Section
						title="Projects"
						onEdit={() =>
							send({
								type: 'addToProject',
								nodeId: pr.nodeId,
								current: pr.projects.map((p) => p.projectId),
							})
						}
					>
						<Projects
							projects={pr.projects}
							readable={pr.projectsReadable}
							onOpen={(url) => send({ type: 'openExternal', url })}
							onRemove={(p) =>
								send({
									type: 'removeFromProject',
									projectId: p.projectId,
									itemId: p.itemId,
									projectTitle: p.projectTitle,
								})
							}
							onSetStatus={(p, fieldId, optionId) =>
								send({
									type: 'setProjectStatus',
									projectId: p.projectId,
									itemId: p.itemId,
									fieldId,
									optionId,
								})
							}
						/>
					</Section>

					<Section title="Milestone" onEdit={() => send({ type: 'editMilestone' })}>
						<p class={pr.milestone ? undefined : 'muted'}>{pr.milestone ?? 'No milestone'}</p>
					</Section>

					<Section title="Participants">
						<Participants people={pr.participants} />
					</Section>
				</aside>
			</div>
		</div>
	);
}

/** The grouped check panel, headlined the way GitHub headlines it. */
function Checks({ checks, send }: { checks: Check[]; send: (msg: Record<string, unknown>) => void }) {
	const failing = checks.filter((c) => c.status === 'failure');
	const pending = checks.filter((c) => c.status === 'pending');
	const passing = checks.filter((c) => c.status === 'success');

	const [open, setOpen] = useState(true);

	const headline =
		failing.length > 0
			? 'Some checks were not successful'
			: pending.length > 0
				? "Some checks haven't completed yet"
				: 'All checks have passed';

	// "2 queued, 2 successful checks" — only the non-empty groups get counted.
	const summary = [
		failing.length && `${failing.length} failing`,
		pending.length && `${pending.length} queued`,
		passing.length && `${passing.length} successful`,
	]
		.filter(Boolean)
		.join(', ');

	const marker = failing.length > 0 ? 'failure' : pending.length > 0 ? 'pending' : 'success';

	return (
		<section class="checkbox">
			<header class={marker}>
				<span class="marker" />
				<div>
					<strong>{headline}</strong>
					<p class="muted">
						{summary} check{checks.length === 1 ? '' : 's'}
					</p>
				</div>
				<button class="link" onClick={() => setOpen(!open)}>
					{open ? 'Hide' : 'Show'}
				</button>
			</header>

			{open && (
				<ul>
					{[...failing, ...pending, ...passing].map((c) => (
						<li key={c.name} class={c.status}>
							<span class="marker" />
							<span class="name">{c.name}</span>
							<span class="muted detail">{c.detail}</span>
							{c.url && (
								<button class="link" onClick={() => send({ type: 'openExternal', url: c.url })}>
									Details
								</button>
							)}
						</li>
					))}
				</ul>
			)}
		</section>
	);
}

/** Conflict status plus every action that changes the PR's state. */
function MergeBox({ pr, ops }: { pr: Pr; ops: Ops }) {
	const [method, setMethod] = useState('merge');
	const blocked = pr.draft || pr.mergeable === false;

	return (
		<section class="mergebox">
			<div class={`row ${pr.mergeable === false ? 'failure' : pr.mergeable === null ? 'pending' : 'success'}`}>
				<span class="marker" />
				<div>
					<strong>
						{pr.mergeable === false
							? 'This branch has conflicts that must be resolved'
							: pr.mergeable === null
								? 'Checking whether this can be merged'
								: 'No conflicts with base branch'}
					</strong>
					<p class="muted">
						{pr.mergeable === false
							? `Conflicts with ${pr.baseRef} — resolve them before merging.`
							: pr.mergeable === null
								? 'GitHub is still working this out. Refresh in a moment.'
								: 'Merging can be performed automatically.'}
					</p>
				</div>
			</div>

			<div class="actions">
				<select value={method} onChange={(e) => setMethod((e.target as HTMLSelectElement).value)}>
					{MERGE_METHODS.map((m) => (
						<option key={m.value} value={m.value}>
							{m.label}
						</option>
					))}
				</select>
				<ActionButton
					class="primary"
					busy={ops.busy('merge')}
					disabled={blocked}
					label="Merge pull request"
					busyLabel="Merging…"
					title={
						pr.draft
							? 'Draft pull requests cannot be merged'
							: pr.mergeable === false
								? `Conflicts with ${pr.baseRef}`
								: undefined
					}
					onClick={() => ops.run('merge', { type: 'merge', method })}
				/>
				<ActionButton
					busy={ops.busy('checkout')}
					label="Check out"
					busyLabel="Checking out…"
					onClick={() => ops.run('checkout', { type: 'checkout' })}
				/>
				<ActionButton
					busy={ops.busy('draft')}
					label={pr.draft ? 'Ready for review' : 'Convert to draft'}
					busyLabel="Updating…"
					onClick={() =>
						ops.run('draft', { type: pr.draft ? 'readyForReview' : 'convertToDraft' })
					}
				/>
			</div>
		</section>
	);
}

function Commits({ commits, onOpen }: { commits: Commit[]; onOpen: (url: string) => void }) {
	if (commits.length === 0) {
		return <p class="muted">No commits on this branch.</p>;
	}
	return (
		<ul class="commits">
			{commits.map((c) => (
				<li key={c.sha}>
					<Avatar login={c.author} url={c.avatarUrl} />
					<div class="what">
						<button class="link message" onClick={() => onOpen(c.url)}>
							{c.message}
						</button>
						<p class="muted">
							<strong>{c.author}</strong>{' '}
							<span title={exact(c.date)}>committed {ago(c.date)}</span>
						</p>
					</div>
					<button class="link sha" title="Open this commit on GitHub" onClick={() => onOpen(c.url)}>
						{c.shortSha}
					</button>
				</li>
			))}
		</ul>
	);
}

render(<App />, document.getElementById('root')!);
