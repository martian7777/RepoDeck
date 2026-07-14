import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };
const vscode = acquireVsCodeApi();

interface Card {
	itemId: string;
	title: string;
	number?: number;
	url?: string;
	state?: string;
	assignees: string[];
	optionId?: string;
}
interface Column {
	optionId: string;
	name: string;
	cards: Card[];
}
interface Board {
	projectId: string;
	title: string;
	fieldId: string;
	fieldName: string;
	columns: Column[];
	unassigned: Card[];
}

/** The "no status" tray is a real place cards live, but it isn't a real option id. */
const NO_STATUS = '__none__';

function App() {
	const [board, setBoard] = useState<Board | undefined>();
	const [error, setError] = useState<string | undefined>();
	const [loading, setLoading] = useState(true);
	const [dragging, setDragging] = useState<string | undefined>();
	const [over, setOver] = useState<string | undefined>();

	useEffect(() => {
		const onMessage = (e: MessageEvent) => {
			const msg = e.data;
			if (msg.type === 'board') {
				setBoard(msg.board);
				setError(undefined);
				setLoading(false);
			} else if (msg.type === 'error') {
				setError(msg.message);
				setBoard(undefined);
				setLoading(false);
			} else if (msg.type === 'loading') {
				setLoading(true);
			}
		};
		window.addEventListener('message', onMessage);
		vscode.postMessage({ type: 'ready' });
		return () => window.removeEventListener('message', onMessage);
	}, []);

	const drop = (targetOptionId: string) => {
		setOver(undefined);
		const itemId = dragging;
		setDragging(undefined);
		if (!itemId || !board || targetOptionId === NO_STATUS) {
			return;
		}

		const card = [...board.columns.flatMap((c) => c.cards), ...board.unassigned].find(
			(c) => c.itemId === itemId,
		);
		if (!card || card.optionId === targetOptionId) {
			return;
		}

		// Move locally first so the board feels instant; the host reloads the board if
		// the mutation fails, which snaps this back to the truth.
		setBoard({
			...board,
			unassigned: board.unassigned.filter((c) => c.itemId !== itemId),
			columns: board.columns.map((col) => ({
				...col,
				cards:
					col.optionId === targetOptionId
						? [...col.cards.filter((c) => c.itemId !== itemId), { ...card, optionId: targetOptionId }]
						: col.cards.filter((c) => c.itemId !== itemId),
			})),
		});

		vscode.postMessage({
			type: 'moveCard',
			itemId,
			fieldId: board.fieldId,
			optionId: targetOptionId,
		});
	};

	if (error) {
		return (
			<div class="state">
				<p>{error}</p>
				<button onClick={() => vscode.postMessage({ type: 'changeProject' })}>
					Choose a different project
				</button>
			</div>
		);
	}

	if (!board) {
		return <div class="state">{loading ? 'Loading board…' : 'No board.'}</div>;
	}

	const columns: Column[] = [
		...board.columns,
		...(board.unassigned.length > 0
			? [{ optionId: NO_STATUS, name: `No ${board.fieldName}`, cards: board.unassigned }]
			: []),
	];

	return (
		<div class="board">
			<header>
				<h1>{board.title}</h1>
				<div class="actions">
					{loading && <span class="muted">Refreshing…</span>}
					<button onClick={() => vscode.postMessage({ type: 'refresh' })}>Refresh</button>
					<button onClick={() => vscode.postMessage({ type: 'changeProject' })}>Change project</button>
				</div>
			</header>

			<div class="columns">
				{columns.map((col) => (
					<section
						key={col.optionId}
						class={`column${over === col.optionId ? ' over' : ''}${col.optionId === NO_STATUS ? ' locked' : ''}`}
						onDragOver={(e) => {
							if (col.optionId === NO_STATUS) return;
							e.preventDefault();
							setOver(col.optionId);
						}}
						onDragLeave={() => setOver((o) => (o === col.optionId ? undefined : o))}
						onDrop={() => drop(col.optionId)}
					>
						<h2>
							{col.name} <span class="count">{col.cards.length}</span>
						</h2>
						<div class="cards">
							{col.cards.map((card) => (
								<article
									key={card.itemId}
									class={`card${dragging === card.itemId ? ' dragging' : ''}`}
									draggable
									onDragStart={() => setDragging(card.itemId)}
									onDragEnd={() => {
										setDragging(undefined);
										setOver(undefined);
									}}
									onDblClick={() => vscode.postMessage({ type: 'openCard', url: card.url })}
									title={card.url ? 'Double-click to open on GitHub' : 'Draft item'}
								>
									<p class="title">{card.title}</p>
									<footer>
										{card.number !== undefined && <span class="num">#{card.number}</span>}
										{card.assignees.map((a) => (
											<span key={a} class="who">
												{a}
											</span>
										))}
									</footer>
								</article>
							))}
							{col.cards.length === 0 && <p class="empty">Drop cards here</p>}
						</div>
					</section>
				))}
			</div>
		</div>
	);
}

render(<App />, document.getElementById('root')!);
