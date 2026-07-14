import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };
const vscode = acquireVsCodeApi();

interface Label {
	name: string;
	color: string;
}

function App() {
	const [repo, setRepo] = useState('');
	const [collaborators, setCollaborators] = useState<string[]>([]);
	const [labels, setLabels] = useState<Label[]>([]);

	const [title, setTitle] = useState('');
	const [body, setBody] = useState('');
	const [assignees, setAssignees] = useState<string[]>([]);
	const [chosenLabels, setChosenLabels] = useState<string[]>([]);
	const [error, setError] = useState<string | undefined>();
	const [submitting, setSubmitting] = useState(false);

	useEffect(() => {
		const onMessage = (e: MessageEvent) => {
			const msg = e.data;
			if (msg.type === 'init') {
				setRepo(msg.repo);
				setCollaborators(msg.collaborators);
				setLabels(msg.labels);
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
		if (!title.trim()) {
			return;
		}
		setSubmitting(true);
		setError(undefined);
		vscode.postMessage({ type: 'submit', title, body, assignees, labels: chosenLabels });
	};

	return (
		<form class="form" onSubmit={submit}>
			<h1>New issue</h1>
			<p class="muted">{repo}</p>

			{error && <p class="error">{error}</p>}

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

			{collaborators.length > 0 && (
				<fieldset>
					<legend>Assignees</legend>
					<div class="chips">
						{collaborators.map((c) => (
							<button
								type="button"
								key={c}
								class={`chip${assignees.includes(c) ? ' on' : ''}`}
								onClick={() => toggle(assignees, setAssignees, c)}
							>
								{c}
							</button>
						))}
					</div>
				</fieldset>
			)}

			{labels.length > 0 && (
				<fieldset>
					<legend>Labels</legend>
					<div class="chips">
						{labels.map((l) => (
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

			<div class="actions">
				<button type="submit" class="primary" disabled={!title.trim() || submitting}>
					{submitting ? 'Creating…' : 'Create issue'}
				</button>
				<button type="button" onClick={() => vscode.postMessage({ type: 'cancel' })}>
					Cancel
				</button>
			</div>
		</form>
	);
}

render(<App />, document.getElementById('root')!);
