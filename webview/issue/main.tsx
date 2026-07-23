import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Editor } from '../shared/editor';
import { quote } from '../shared/commentMenu';
import { ActionButton, useOps } from '../shared/ops';
import { Timeline, type TimelineEntry } from '../shared/timeline';
import { LabelList, LoginList, Projects, Section, type ProjectLink } from '../shared/sidebar';

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };
const vscode = acquireVsCodeApi();

interface Issue {
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
	milestone?: string;
	timeline: TimelineEntry[];
	projects: ProjectLink[];
	projectsReadable: boolean;
}

function App() {
	const [issue, setIssue] = useState<Issue | undefined>();
	const [repo, setRepo] = useState('');
	const [viewer, setViewer] = useState('');
	const [error, setError] = useState<string | undefined>();
	const [actionError, setActionError] = useState<string | undefined>();
	const [loading, setLoading] = useState(true);
	const [draft, setDraft] = useState('');
	const composer = useRef<HTMLTextAreaElement | null>(null);
	const ops = useOps(vscode, () => setActionError(undefined));

	useEffect(() => {
		const onMessage = (e: MessageEvent) => {
			const msg = e.data;
			if (msg.type === 'issue') {
				setIssue(msg.issue);
				setRepo(msg.repo ?? '');
				setViewer(msg.viewer ?? '');
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
	if (!issue) {
		return <div class="state">{loading ? 'Loading issue…' : 'Nothing to show.'}</div>;
	}

	const send = ops.post;
	const closed = issue.state === 'closed';

	const quoteReply = (body: string) => {
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
			ops.run(`edit:${entry.id}`, { type: 'editComment', id: entry.id, body }),
	};

	return (
		<div class="issue">
			<header>
				<h1>
					{issue.title} <span class="num">#{issue.number}</span>
				</h1>
				<p class="meta">
					<span class={`pill ${closed ? 'closed' : 'open'}`}>{closed ? '✓ Closed' : '⊙ Open'}</span>
					<span class="repo">{repo}</span>
					<span class="muted">
						<strong>{issue.author}</strong> opened this issue
					</span>
				</p>
				<div class="actions">
					<button onClick={() => send({ type: 'refresh' })}>Refresh</button>
					<button onClick={() => send({ type: 'openExternal', url: issue.url })}>
						Open on GitHub
					</button>
					{loading && <span class="muted">Refreshing…</span>}
				</div>
			</header>

			{actionError && <p class="error">{actionError}</p>}

			<div class="layout">
				<main>
					<Timeline
						lead={{
							author: issue.author,
							avatarUrl: issue.authorAvatarUrl,
							createdAt: issue.createdAt,
							body: issue.body,
							verb: 'opened this issue',
							url: issue.url,
							canEdit: issue.author === viewer,
							onSave: (body) => ops.run('editBody', { type: 'editBody', body }),
							empty: <p class="muted">No description provided.</p>,
						}}
						entries={issue.timeline}
						actions={actions}
					/>

					<section class="compose">
						<h2>Add a comment</h2>
						<Editor
							value={draft}
							onInput={setDraft}
							textareaRef={composer}
							footer={
								<>
									<ActionButton
										busy={ops.busy('state')}
										label={closed ? 'Reopen issue' : 'Close issue'}
										busyLabel={closed ? 'Reopening…' : 'Closing…'}
										onClick={() =>
											ops.run('state', { type: 'setState', state: closed ? 'open' : 'closed' })
										}
									/>
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
					</section>
				</main>

				<aside>
					<Section
						title="Assignees"
						onEdit={() => send({ type: 'editAssignees', current: issue.assignees })}
					>
						<LoginList logins={issue.assignees} empty="No one assigned" />
					</Section>

					<Section
						title="Labels"
						onEdit={() => send({ type: 'editLabels', current: issue.labels.map((l) => l.name) })}
					>
						<LabelList labels={issue.labels} />
					</Section>

					<Section
						title="Projects"
						onEdit={() =>
							send({
								type: 'addToProject',
								nodeId: issue.nodeId,
								current: issue.projects.map((p) => p.projectId),
							})
						}
					>
						<Projects
							projects={issue.projects}
							readable={issue.projectsReadable}
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
						<p class={issue.milestone ? undefined : 'muted'}>{issue.milestone ?? 'No milestone'}</p>
					</Section>
				</aside>
			</div>
		</div>
	);
}

render(<App />, document.getElementById('root')!);
