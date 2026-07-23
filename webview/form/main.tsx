import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };
const vscode = acquireVsCodeApi();

interface Label {
	name: string;
	color: string;
}

interface Category {
	id: string;
	name: string;
	emoji: string;
}

interface Init {
	mode: 'issue' | 'pr' | 'discussion';
	repo: string;
	collaborators: string[];
	labels: Label[];
	/** PR mode only. */
	head?: string;
	branches?: string[];
	defaultBase?: string;
	suggestedTitle?: string;
	/** Discussion mode only. */
	categories?: Category[];
}

function App() {
	const [init, setInit] = useState<Init | undefined>();

	const [title, setTitle] = useState('');
	const [body, setBody] = useState('');
	const [assignees, setAssignees] = useState<string[]>([]);
	const [reviewers, setReviewers] = useState<string[]>([]);
	const [chosenLabels, setChosenLabels] = useState<string[]>([]);
	const [base, setBase] = useState('');
	const [draft, setDraft] = useState(false);
	const [categoryId, setCategoryId] = useState('');
	const [error, setError] = useState<string | undefined>();
	const [submitting, setSubmitting] = useState(false);

	useEffect(() => {
		const onMessage = (e: MessageEvent) => {
			const msg = e.data;
			if (msg.type === 'init') {
				setInit(msg);
				setBase(msg.defaultBase ?? '');
				setCategoryId(msg.categories?.[0]?.id ?? '');
				if (msg.suggestedTitle) {
					setTitle(msg.suggestedTitle);
				}
			} else if (msg.type === 'error') {
				setError(msg.message);
				setSubmitting(false);
			}
		};
		window.addEventListener('message', onMessage);
		vscode.postMessage({ type: 'ready' });
		return () => window.removeEventListener('message', onMessage);
	}, []);

	const toggle = (list: string[], set: (v: string[]) => void, value: string) =>
		set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

	const submit = (e: Event) => {
		e.preventDefault();
		if (!init || !title.trim() || (init.mode === 'discussion' && !categoryId)) {
			return;
		}
		setSubmitting(true);
		setError(undefined);
		vscode.postMessage(
			init.mode === 'pr'
				? { type: 'submit', title, body, base, draft, reviewers, assignees }
				: init.mode === 'discussion'
					? { type: 'submit', title, body, categoryId }
					: { type: 'submit', title, body, assignees, labels: chosenLabels },
		);
	};

	if (!init) {
		return <div class="state">Loading…</div>;
	}

	const isPr = init.mode === 'pr';
	const isDiscussion = init.mode === 'discussion';
	const incomplete = !title.trim() || (isDiscussion && !categoryId);

	return (
		<form class="form" onSubmit={submit}>
			<h1>{isPr ? 'New pull request' : isDiscussion ? 'New discussion' : 'New issue'}</h1>
			<p class="muted">
				{init.repo}
				{isPr && base && (
					<>
						{' · '}
						<code>{init.head}</code> → <code>{base}</code>
					</>
				)}
			</p>

			{error && <p class="error">{error}</p>}

			{isPr && (
				<label>
					Merge into
					<select value={base} onChange={(e) => setBase((e.target as HTMLSelectElement).value)}>
						{(init.branches ?? []).map((b) => (
							<option key={b} value={b}>
								{b}
							</option>
						))}
					</select>
				</label>
			)}

			{isDiscussion && (
				<label>
					Category
					<select
						value={categoryId}
						onChange={(e) => setCategoryId((e.target as HTMLSelectElement).value)}
					>
						{(init.categories ?? []).map((c) => (
							<option key={c.id} value={c.id}>
								{c.emoji ? `${c.emoji} ${c.name}` : c.name}
							</option>
						))}
					</select>
				</label>
			)}

			<label>
				Title
				<input
					value={title}
					autofocus
					placeholder="Something short and specific"
					onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
				/>
			</label>

			<label>
				Description
				<textarea
					value={body}
					rows={12}
					placeholder="Markdown is supported."
					onInput={(e) => setBody((e.target as HTMLTextAreaElement).value)}
				/>
			</label>

			{isPr && init.collaborators.length > 0 && (
				<Chips
					legend="Reviewers"
					options={init.collaborators}
					chosen={reviewers}
					onToggle={(v) => toggle(reviewers, setReviewers, v)}
				/>
			)}

			{init.collaborators.length > 0 && (
				<Chips
					legend="Assignees"
					options={init.collaborators}
					chosen={assignees}
					onToggle={(v) => toggle(assignees, setAssignees, v)}
				/>
			)}

			{!isPr && init.labels.length > 0 && (
				<fieldset>
					<legend>Labels</legend>
					<div class="chips">
						{init.labels.map((l) => (
							<button
								type="button"
								key={l.name}
								class={`chip${chosenLabels.includes(l.name) ? ' on' : ''}`}
								onClick={() => toggle(chosenLabels, setChosenLabels, l.name)}
							>
								<span class="dot" style={{ background: `#${l.color}` }} />
								{l.name}
							</button>
						))}
					</div>
				</fieldset>
			)}

			{isPr && (
				<label class="check">
					<input
						type="checkbox"
						checked={draft}
						onChange={(e) => setDraft((e.target as HTMLInputElement).checked)}
					/>
					Open as a draft
				</label>
			)}

			<div class="actions">
				<button type="submit" class="primary" disabled={incomplete || submitting}>
					{submitting
						? 'Creating…'
						: isPr
							? 'Create pull request'
							: isDiscussion
								? 'Start discussion'
								: 'Create issue'}
				</button>
				<button type="button" onClick={() => vscode.postMessage({ type: 'cancel' })}>
					Cancel
				</button>
			</div>
		</form>
	);
}

function Chips(props: {
	legend: string;
	options: string[];
	chosen: string[];
	onToggle: (value: string) => void;
}) {
	return (
		<fieldset>
			<legend>{props.legend}</legend>
			<div class="chips">
				{props.options.map((o) => (
					<button
						type="button"
						key={o}
						class={`chip${props.chosen.includes(o) ? ' on' : ''}`}
						onClick={() => props.onToggle(o)}
					>
						{o}
					</button>
				))}
			</div>
		</fieldset>
	);
}

render(<App />, document.getElementById('root')!);
