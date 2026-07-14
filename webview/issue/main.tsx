import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { Markdown } from '../shared/markdown';

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };
const vscode = acquireVsCodeApi();

interface TimelineEntry {
	kind: 'comment' | 'event';
	actor: string;
	createdAt: string;
	body?: string;
	text?: string;
	icon?: string;
}
interface SelectField {
	fieldId: string;
	name: string;
	optionId?: string;
	options: { id: string; name: string; color: string }[];
}
interface ProjectLink {
	itemId: string;
	projectId: string;
	projectTitle: string;
	projectUrl: string;
	selectFields: SelectField[];
	readonlyFields: { name: string; value: string }[];
}
interface Issue {
	number: number;
	title: string;
	body: string;
	state: string;
	url: string;
	author: string;
	nodeId: string;
	assignees: string[];
	labels: { name: string; color: string }[];
	milestone?: string;
	timeline: TimelineEntry[];
	projects: ProjectLink[];
	projectsReadable: boolean;
}

const COLOR: Record<string, string> = {
	GRAY: 'var(--vscode-descriptionForeground)',
	BLUE: 'var(--vscode-charts-blue)',
	GREEN: 'var(--vscode-charts-green)',
	YELLOW: 'var(--vscode-charts-yellow)',
	ORANGE: 'var(--vscode-charts-orange)',
	RED: 'var(--vscode-charts-red)',
	PINK: 'var(--vscode-charts-purple)',
	PURPLE: 'var(--vscode-charts-purple)',
};

const when = (iso: string) => (iso ? new Date(iso).toLocaleString() : '');

/** A stand-in for the avatar GitHub shows; the CSP forbids loading remote images. */
function Avatar({ login }: { login: string }) {
	return <span class="avatar">{(login[0] ?? '?').toUpperCase()}</span>;
}

function App() {
	const [issue, setIssue] = useState<Issue | undefined>();
	const [repo, setRepo] = useState('');
	const [error, setError] = useState<string | undefined>();
	const [actionError, setActionError] = useState<string | undefined>();
	const [loading, setLoading] = useState(true);
	const [draft, setDraft] = useState('');

	useEffect(() => {
		const onMessage = (e: MessageEvent) => {
			const msg = e.data;
			if (msg.type === 'issue') {
				setIssue(msg.issue);
				setRepo(msg.repo ?? '');
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

	const send = (msg: Record<string, unknown>) => {
		setActionError(undefined);
		vscode.postMessage(msg);
	};
	const closed = issue.state === 'closed';

	return (
		<div class="issue">
			<header>
				<h1>
					{issue.title} <span class="num">#{issue.number}</span>
				</h1>
				<p class="meta">
					<span class={`pill ${closed ? 'closed' : 'open'}`}>
						{closed ? '✓ Closed' : '⊙ Open'}
					</span>
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
					{/* The rail is a single vertical line behind every row, the way GitHub
					    threads its timeline. */}
					<div class="timeline">
						<div class="tl-row">
							<Avatar login={issue.author} />
							<article class="comment">
								<header>
									<strong>{issue.author}</strong> <span class="muted">opened this issue</span>
								</header>
								{issue.body ? (
									<Markdown text={issue.body} />
								) : (
									<p class="muted">No description provided.</p>
								)}
							</article>
						</div>

						{issue.timeline.map((entry, i) =>
							entry.kind === 'comment' ? (
								<div class="tl-row" key={i}>
									<Avatar login={entry.actor} />
									<article class="comment">
										<header>
											<strong>{entry.actor}</strong> <span class="muted">commented</span>
											<span class="muted when">{when(entry.createdAt)}</span>
										</header>
										<Markdown text={entry.body ?? ""} />
									</article>
								</div>
							) : (
								<div class="tl-row event" key={i}>
									<span class="glyph">{entry.icon ?? '•'}</span>
									<p>
										<strong>{entry.actor}</strong> {entry.text}
										<span class="muted when">{when(entry.createdAt)}</span>
									</p>
								</div>
							),
						)}
					</div>

					<section class="compose">
						<h2>Add a comment</h2>
						<textarea
							rows={6}
							value={draft}
							placeholder="Use Markdown to format your comment"
							onInput={(e) => setDraft((e.target as HTMLTextAreaElement).value)}
						/>
						<div class="actions right">
							<button
								onClick={() => send({ type: 'setState', state: closed ? 'open' : 'closed' })}
							>
								{closed ? 'Reopen issue' : 'Close issue'}
							</button>
							<button
								class="primary"
								disabled={!draft.trim()}
								onClick={() => send({ type: 'comment', body: draft })}
							>
								Comment
							</button>
						</div>
					</section>
				</main>

				<aside>
					<Section
						title="Assignees"
						onEdit={() => send({ type: 'editAssignees', current: issue.assignees })}
					>
						{issue.assignees.length === 0 ? (
							<p class="muted">No one assigned</p>
						) : (
							<div class="chips">
								{issue.assignees.map((a) => (
									<span class="chip on" key={a}>
										{a}
									</span>
								))}
							</div>
						)}
					</Section>

					<Section
						title="Labels"
						onEdit={() => send({ type: 'editLabels', current: issue.labels.map((l) => l.name) })}
					>
						{issue.labels.length === 0 ? (
							<p class="muted">None yet</p>
						) : (
							<div class="chips">
								{issue.labels.map((l) => (
									<span class="chip on" key={l.name}>
										<span class="dot" style={{ background: `#${l.color}` }} />
										{l.name}
									</span>
								))}
							</div>
						)}
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
						{!issue.projectsReadable ? (
							<p class="muted">
								Your token can't read Projects. Sign out and back in to grant the{' '}
								<code>project</code> scope.
							</p>
						) : issue.projects.length === 0 ? (
							<p class="muted">Not on a project yet</p>
						) : (
							issue.projects.map((p) => (
								<div class="project" key={p.itemId}>
									<div class="project-head">
										<button
											class="link"
											onClick={() => send({ type: 'openExternal', url: p.projectUrl })}
										>
											{p.projectTitle}
										</button>
										<button
											class="remove"
											title="Remove from this project"
											onClick={() =>
												send({
													type: 'removeFromProject',
													projectId: p.projectId,
													itemId: p.itemId,
													projectTitle: p.projectTitle,
												})
											}
										>
											✕
										</button>
									</div>

									{p.selectFields.length === 0 && p.readonlyFields.length === 0 && (
										<p class="muted">This project has no fields.</p>
									)}

									{p.selectFields.map((f) => {
										const current = f.options.find((o) => o.id === f.optionId);
										return (
											<label class="status" key={f.fieldId}>
												<span class="muted">{f.name}</span>
												<span class="value">
													{current && (
														<span
															class="dot"
															style={{ background: COLOR[current.color] ?? COLOR.GRAY }}
														/>
													)}
													<select
														value={f.optionId ?? ''}
														onChange={(e) =>
															send({
																type: 'setProjectStatus',
																projectId: p.projectId,
																itemId: p.itemId,
																fieldId: f.fieldId,
																optionId: (e.target as HTMLSelectElement).value,
															})
														}
													>
														<option value="">—</option>
														{f.options.map((o) => (
															<option key={o.id} value={o.id}>
																{o.name}
															</option>
														))}
													</select>
												</span>
											</label>
										);
									})}

									{p.readonlyFields.map((f) => (
										<p class="status" key={f.name}>
											<span class="muted">{f.name}</span>
											<span>{f.value}</span>
										</p>
									))}
								</div>
							))
						)}
					</Section>

					<Section title="Milestone" onEdit={() => send({ type: 'editMilestone' })}>
						<p class={issue.milestone ? undefined : 'muted'}>
							{issue.milestone ?? 'No milestone'}
						</p>
					</Section>
				</aside>
			</div>
		</div>
	);
}

function Section(props: { title: string; onEdit: () => void; children: preact.ComponentChildren }) {
	return (
		<section class="side">
			<h2>
				{props.title}
				<button class="gear" title={`Edit ${props.title.toLowerCase()}`} onClick={props.onEdit}>
					⚙
				</button>
			</h2>
			{props.children}
		</section>
	);
}

render(<App />, document.getElementById('root')!);
