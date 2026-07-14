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
	labels: { name: string; color: string }[];
	optionId?: string;
	isDraft: boolean;
}
interface Column {
	optionId: string;
	name: string;
	color: string;
	description: string;
	cards: Card[];
}
interface Board {
	projectId: string;
	title: string;
	fieldId: string;
	fieldName: string;
	columns: Column[];
	unassigned: Card[];
	groupableFields: { id: string; name: string }[];
}

/** The "no status" tray is a real place cards live, but it isn't a real option id. */
const NO_STATUS = '__none__';

/** GitHub's option colours, mapped onto theme variables so they survive light mode. */
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
const colorOf = (c: string) => COLOR[c] ?? COLOR.GRAY;

function App() {
	const [board, setBoard] = useState<Board | undefined>();
	const [error, setError] = useState<string | undefined>();
	const [noField, setNoField] = useState<string | undefined>();
	const [loading, setLoading] = useState(true);
	const [dragging, setDragging] = useState<string | undefined>();
	const [over, setOver] = useState<string | undefined>();

	useEffect(() => {
		const onMessage = (e: MessageEvent) => {
			const msg = e.data;
			if (msg.type === 'board') {
				setBoard(msg.board);
				setError(undefined);
				setNoField(undefined);
				setLoading(false);
			} else if (msg.type === 'error') {
				setError(msg.message);
				setBoard(undefined);
				setLoading(false);
			} else if (msg.type === 'noField') {
				setNoField(msg.message);
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

		vscode.postMessage({ type: 'moveCard', itemId, fieldId: board.fieldId, optionId: targetOptionId });
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

	if (noField) {
		return (
			<div class="state">
				<p>{noField}</p>
				<div class="actions">
					<button class="primary" onClick={() => vscode.postMessage({ type: 'addStatusField' })}>
						Add a field
					</button>
					<button onClick={() => vscode.postMessage({ type: 'changeProject' })}>
						Choose a different project
					</button>
				</div>
			</div>
		);
	}

	if (!board) {
		return <div class="state">{loading ? 'Loading board…' : 'No board.'}</div>;
	}

	const columns: Column[] = [
		...board.columns,
		...(board.unassigned.length > 0
			? [
					{
						optionId: NO_STATUS,
						name: `No ${board.fieldName}`,
						color: 'GRAY',
						description: '',
						cards: board.unassigned,
					},
				]
			: []),
	];

	return (
		<div class="board">
			<header>
				<div>
					<h1>{board.title}</h1>
					<p class="muted">
						Grouped by{' '}
						{board.groupableFields.length > 1 ? (
							<select
								value={board.fieldId}
								onChange={(e) =>
									vscode.postMessage({
										type: 'groupBy',
										fieldId: (e.target as HTMLSelectElement).value,
									})
								}
							>
								{board.groupableFields.map((f) => (
									<option key={f.id} value={f.id}>
										{f.name}
									</option>
								))}
							</select>
						) : (
							<strong>{board.fieldName}</strong>
						)}
					</p>
				</div>
				<div class="actions">
					{loading && <span class="muted">Refreshing…</span>}
					<button onClick={() => vscode.postMessage({ type: 'manageFields' })}>Fields…</button>
					<button onClick={() => vscode.postMessage({ type: 'refresh' })}>Refresh</button>
					<button onClick={() => vscode.postMessage({ type: 'changeProject' })}>Change project</button>
				</div>
			</header>

			<div class="columns">
				{columns.map((col) => {
					const tray = col.optionId === NO_STATUS;
					return (
						<section
							key={col.optionId}
							class={`column${over === col.optionId ? ' over' : ''}${tray ? ' locked' : ''}`}
							onDragOver={(e) => {
								if (tray) return;
								e.preventDefault();
								setOver(col.optionId);
							}}
							onDragLeave={() => setOver((o) => (o === col.optionId ? undefined : o))}
							onDrop={() => drop(col.optionId)}
						>
							<h2>
								<span class="dot" style={{ background: colorOf(col.color) }} />
								<span class="name">{col.name}</span>
								<span class="count">{col.cards.length}</span>
								{!tray && (
									<span class="tools">
										<button
											title="Add an item"
											onClick={() =>
												vscode.postMessage({
													type: 'addItem',
													fieldId: board.fieldId,
													optionId: col.optionId,
													columnName: col.name,
												})
											}
										>
											+
										</button>
										<button
											title="Rename column"
											onClick={() =>
												vscode.postMessage({
													type: 'renameColumn',
													fieldId: board.fieldId,
													optionId: col.optionId,
													name: col.name,
												})
											}
										>
											✎
										</button>
										<button
											title="Change colour"
											onClick={() =>
												vscode.postMessage({
													type: 'recolorColumn',
													fieldId: board.fieldId,
													optionId: col.optionId,
													name: col.name,
												})
											}
										>
											◑
										</button>
										<button
											title="Delete column"
											onClick={() =>
												vscode.postMessage({
													type: 'deleteColumn',
													fieldId: board.fieldId,
													optionId: col.optionId,
													name: col.name,
													fieldName: board.fieldName,
													count: col.cards.length,
												})
											}
										>
											✕
										</button>
									</span>
								)}
							</h2>

							{col.description && <p class="col-desc">{col.description}</p>}

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
										onClick={() =>
											!card.isDraft &&
											vscode.postMessage({
												type: 'openCard',
												number: card.number,
												url: card.url,
											})
										}
										title={card.isDraft ? 'Draft item — convert it to open it' : 'Click to open'}
									>
										<p class="title">{card.title}</p>

										{card.labels.length > 0 && (
											<div class="labels">
												{card.labels.map((l) => (
													<span key={l.name} class="label" style={{ borderColor: `#${l.color}` }}>
														{l.name}
													</span>
												))}
											</div>
										)}

										<footer>
											{card.isDraft ? (
												<span class="pill">Draft</span>
											) : (
												<span class="num">#{card.number}</span>
											)}
											{card.assignees.map((a) => (
												<span key={a} class="who">
													{a}
												</span>
											))}
											{/* Clicking a tool must not also open the card. */}
											<span class="tools" onClick={(e) => e.stopPropagation()}>
												{card.isDraft && (
													<button
														title="Convert to a real issue"
														onClick={() =>
															vscode.postMessage({
																type: 'convertDraft',
																itemId: card.itemId,
																isDraft: true,
															})
														}
													>
														↥
													</button>
												)}
												{card.url && (
													<button
														title="Open on GitHub"
														onClick={() =>
															vscode.postMessage({ type: 'openCardExternal', url: card.url })
														}
													>
														↗
													</button>
												)}
												<button
													title={card.isDraft ? 'Delete draft' : 'Remove from board'}
													onClick={() =>
														vscode.postMessage({
															type: 'deleteItem',
															itemId: card.itemId,
															title: card.title,
															isDraft: card.isDraft,
														})
													}
												>
													✕
												</button>
											</span>
										</footer>
									</article>
								))}
								{col.cards.length === 0 && <p class="empty">Drop cards here</p>}
							</div>
						</section>
					);
				})}

				<button
					class="add-column"
					title="Add a column"
					onClick={() =>
						vscode.postMessage({
							type: 'addColumn',
							fieldId: board.fieldId,
							fieldName: board.fieldName,
						})
					}
				>
					+ Add column
				</button>
			</div>
		</div>
	);
}

render(<App />, document.getElementById('root')!);
