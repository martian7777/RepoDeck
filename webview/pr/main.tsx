import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { Markdown } from '../shared/markdown';

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };
const vscode = acquireVsCodeApi();

interface Check {
	name: string;
	status: 'success' | 'failure' | 'pending';
}
interface Comment {
	author: string;
	body: string;
	createdAt: string;
	reviewState?: string;
}
interface Pr {
	number: number;
	title: string;
	body: string;
	state: string;
	url: string;
	author: string;
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
	checks: Check[];
	comments: Comment[];
}

const REVIEW_LABEL: Record<string, string> = {
	APPROVED: 'approved',
	CHANGES_REQUESTED: 'requested changes',
	COMMENTED: 'reviewed',
	DISMISSED: 'review dismissed',
};

function App() {
	const [pr, setPr] = useState<Pr | undefined>();
	const [viewer, setViewer] = useState('');
	const [error, setError] = useState<string | undefined>();
	const [actionError, setActionError] = useState<string | undefined>();
	const [loading, setLoading] = useState(true);
	const [draft, setDraft] = useState('');

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
	const failing = pr.checks.filter((c) => c.status === 'failure').length;
	const pending = pr.checks.filter((c) => c.status === 'pending').length;

	const send = (msg: Record<string, unknown>) => {
		setActionError(undefined);
		vscode.postMessage(msg);
	};

	return (
		<div class="pr">
			<header>
				<div>
					<h1>
						{pr.title} <span class="num">#{pr.number}</span>
					</h1>
					<p class="muted">
						<span class={`pill ${pr.merged ? 'merged' : closed ? 'closed' : pr.draft ? 'draft' : 'open'}`}>
							{pr.merged ? 'Merged' : closed ? 'Closed' : pr.draft ? 'Draft' : 'Open'}
						</span>{' '}
						{pr.author} wants to merge <code>{pr.headRef}</code> into <code>{pr.baseRef}</code>
						{pr.isFork && ' (from a fork)'}
					</p>
				</div>
				<div class="actions">
					<button onClick={() => send({ type: 'refresh' })}>Refresh</button>
					<button onClick={() => send({ type: 'openExternal', url: pr.url })}>Open on GitHub</button>
				</div>
			</header>

			{actionError && <p class="error">{actionError}</p>}

			<div class="stats">
				<span>
					{pr.changedFiles} file{pr.changedFiles === 1 ? '' : 's'}
				</span>
				<span class="add">+{pr.additions}</span>
				<span class="del">−{pr.deletions}</span>
			</div>

			{pr.checks.length > 0 && (
				<section class="checks">
					<h2>
						Checks{' '}
						<span class="muted">
							{failing > 0
								? `${failing} failing`
								: pending > 0
									? `${pending} running`
									: 'all passing'}
						</span>
					</h2>
					<ul>
						{pr.checks.map((c) => (
							<li key={c.name} class={c.status}>
								<span class="marker" />
								{c.name}
							</li>
						))}
					</ul>
				</section>
			)}

			{pr.body && (
				<section class="body">
					<h2>Description</h2>
					<Markdown text={pr.body} />
				</section>
			)}

			<section class="conversation">
				<h2>Conversation</h2>
				{pr.comments.length === 0 && <p class="muted">No comments yet.</p>}
				{pr.comments.map((c, i) => (
					<article key={i}>
						<header>
							<strong>{c.author}</strong>{' '}
							{c.reviewState && (
								<span class={`pill ${c.reviewState === 'APPROVED' ? 'open' : c.reviewState === 'CHANGES_REQUESTED' ? 'closed' : ''}`}>
									{REVIEW_LABEL[c.reviewState] ?? c.reviewState.toLowerCase()}
								</span>
							)}
						</header>
						{c.body && <Markdown text={c.body} />}
					</article>
				))}
			</section>

			{!closed && !pr.merged && (
				<section class="compose">
					<textarea
						rows={5}
						value={draft}
						placeholder={own ? 'Leave a comment…' : 'Leave a comment, or write your review here…'}
						onInput={(e) => setDraft((e.target as HTMLTextAreaElement).value)}
					/>

					<div class="actions">
						<button disabled={!draft.trim()} onClick={() => send({ type: 'comment', body: draft })}>
							Comment
						</button>

						{/* GitHub refuses reviews on your own pull request, so don't offer them. */}
						{!own && (
							<>
								<button class="primary" onClick={() => send({ type: 'review', event: 'APPROVE', body: draft })}>
									Approve
								</button>
								<button
									disabled={!draft.trim()}
									title={draft.trim() ? undefined : 'GitHub requires a comment when requesting changes'}
									onClick={() => send({ type: 'review', event: 'REQUEST_CHANGES', body: draft })}
								>
									Request changes
								</button>
							</>
						)}
					</div>

					<div class="actions merge">
						<button onClick={() => send({ type: 'checkout' })}>Check out</button>
						{pr.draft && (
							<button class="primary" onClick={() => send({ type: 'readyForReview' })}>
								Ready for review
							</button>
						)}
						<button
							class="primary"
							disabled={pr.draft || pr.mergeable === false}
							title={
								pr.draft
									? 'Draft pull requests cannot be merged'
									: pr.mergeable === false
										? `Conflicts with ${pr.baseRef}`
										: undefined
							}
							onClick={() => send({ type: 'merge' })}
						>
							Merge…
						</button>
						<button onClick={() => send({ type: 'setState', state: 'closed' })}>Close</button>
					</div>

					{pr.mergeable === false && (
						<p class="error">This branch has conflicts with {pr.baseRef} and can't be merged as-is.</p>
					)}
					{pr.mergeable === null && (
						<p class="muted">GitHub is still working out whether this can merge. Refresh in a moment.</p>
					)}
				</section>
			)}

			{closed && !pr.merged && (
				<section class="compose">
					<div class="actions">
						<button onClick={() => send({ type: 'setState', state: 'open' })}>Reopen</button>
					</div>
				</section>
			)}
		</div>
	);
}

render(<App />, document.getElementById('root')!);
