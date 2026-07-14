import { render } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };
const vscode = acquireVsCodeApi();

// ---------------------------------------------------------------------------
// Model (mirrors src/github/project.ts)
// ---------------------------------------------------------------------------

type FieldType = 'SINGLE_SELECT' | 'ITERATION' | 'TEXT' | 'NUMBER' | 'DATE' | 'OTHER';

interface Field {
	id: string;
	name: string;
	type: FieldType;
	options: { id: string; name: string; color: string }[];
	iterations: { id: string; title: string; startDate: string; duration: number }[];
}

type Value =
	| { kind: 'select'; optionId: string }
	| { kind: 'iteration'; iterationId: string }
	| { kind: 'text'; text: string }
	| { kind: 'number'; number: number }
	| { kind: 'date'; date: string };

interface Item {
	itemId: string;
	kind: 'ISSUE' | 'PULL_REQUEST' | 'DRAFT';
	title: string;
	number?: number;
	url?: string;
	state?: string;
	assignees: string[];
	labels: { name: string; color: string }[];
	values: Record<string, Value>;
}

interface Project {
	id: string;
	title: string;
	url: string;
	fields: Field[];
	items: Item[];
	truncated: boolean;
}

type Layout = 'board' | 'table' | 'roadmap';

const NO_STATUS = '__none__';

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

/** Fields the user authored. Title/Assignees/Labels are built in and handled separately. */
const BUILT_IN = ['Title', 'Assignees', 'Labels', 'Linked pull requests', 'Repository', 'Milestone', 'Reviewers'];
const isCustom = (f: Field) => !BUILT_IN.includes(f.name) && f.type !== 'OTHER';

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

function App() {
	const [project, setProject] = useState<Project | undefined>();
	const [layout, setLayout] = useState<Layout>('board');
	const [groupById, setGroupById] = useState<string | undefined>();
	const [roadmap, setRoadmap] = useState<{ startFieldId?: string; targetFieldId?: string }>({});
	const [error, setError] = useState<string | undefined>();
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		const onMessage = (e: MessageEvent) => {
			const msg = e.data;
			if (msg.type === 'project') {
				setProject(msg.project);
				setLayout(msg.layout ?? 'board');
				setGroupById(msg.groupById);
				setRoadmap(msg.roadmap ?? {});
				setError(undefined);
				setLoading(false);
			} else if (msg.type === 'error') {
				setError(msg.message);
				setProject(undefined);
				setLoading(false);
			} else if (msg.type === 'loading') {
				setLoading(true);
			}
		};
		window.addEventListener('message', onMessage);
		vscode.postMessage({ type: 'ready' });
		return () => window.removeEventListener('message', onMessage);
	}, []);

	/** Writes a field value and reflects it locally, so editing doesn't wait on a round trip. */
	const write = (itemId: string, fieldId: string, value: Value | undefined) => {
		setProject((p) =>
			p
				? {
						...p,
						items: p.items.map((it) => {
							if (it.itemId !== itemId) {
								return it;
							}
							const values = { ...it.values };
							if (value) {
								values[fieldId] = value;
							} else {
								delete values[fieldId];
							}
							return { ...it, values };
						}),
					}
				: p,
		);
		vscode.postMessage({ type: 'setField', itemId, fieldId, value: value ?? null });
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
	if (!project) {
		return <div class="state">{loading ? 'Loading project…' : 'No project.'}</div>;
	}

	const selectFields = project.fields.filter((f) => f.type === 'SINGLE_SELECT' && isCustom(f));
	const groupField = selectFields.find((f) => f.id === groupById) ?? selectFields[0];

	return (
		<div class="project">
			<header>
				<div class="titles">
					<h1>{project.title}</h1>
					{project.truncated && (
						<p class="warn">Showing the first 1000 items — this project has more.</p>
					)}
				</div>

				<div class="bar">
					<div class="layouts" role="tablist">
						{(['table', 'board', 'roadmap'] as Layout[]).map((l) => (
							<button
								key={l}
								class={layout === l ? 'on' : undefined}
								onClick={() => vscode.postMessage({ type: 'setLayout', layout: l })}
							>
								{l === 'table' ? '▤' : l === 'board' ? '▥' : '▤▬'} {l[0].toUpperCase() + l.slice(1)}
							</button>
						))}
					</div>

					<div class="actions">
						{loading && <span class="muted">Refreshing…</span>}
						<button onClick={() => vscode.postMessage({ type: 'manageFields' })}>Fields…</button>
						<button onClick={() => vscode.postMessage({ type: 'refresh' })}>Refresh</button>
						<button onClick={() => vscode.postMessage({ type: 'changeProject' })}>
							Change project
						</button>
					</div>
				</div>
			</header>

			{layout === 'board' && (
				<BoardView project={project} field={groupField} fields={selectFields} onGroup={setGroupById} write={write} />
			)}
			{layout === 'table' && <TableView project={project} write={write} />}
			{layout === 'roadmap' && <RoadmapView project={project} roadmap={roadmap} write={write} />}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Cells — one editor per field type
// ---------------------------------------------------------------------------

type Write = (itemId: string, fieldId: string, value: Value | undefined) => void;

function Cell({ item, field, write }: { item: Item; field: Field; write: Write }) {
	const value = item.values[field.id];

	if (field.type === 'SINGLE_SELECT') {
		const current = field.options.find((o) => o.id === (value as any)?.optionId);
		return (
			<span class="cell select">
				{current && <span class="dot" style={{ background: colorOf(current.color) }} />}
				<select
					value={(value as any)?.optionId ?? ''}
					onChange={(e) => {
						const id = (e.target as HTMLSelectElement).value;
						write(item.itemId, field.id, id ? { kind: 'select', optionId: id } : undefined);
					}}
				>
					<option value="">—</option>
					{field.options.map((o) => (
						<option key={o.id} value={o.id}>
							{o.name}
						</option>
					))}
				</select>
			</span>
		);
	}

	if (field.type === 'ITERATION') {
		return (
			<select
				class="cell"
				value={(value as any)?.iterationId ?? ''}
				onChange={(e) => {
					const id = (e.target as HTMLSelectElement).value;
					write(item.itemId, field.id, id ? { kind: 'iteration', iterationId: id } : undefined);
				}}
			>
				<option value="">—</option>
				{field.iterations.map((it) => (
					<option key={it.id} value={it.id}>
						{it.title}
					</option>
				))}
			</select>
		);
	}

	if (field.type === 'DATE') {
		return (
			<input
				class="cell"
				type="date"
				value={(value as any)?.date ?? ''}
				onChange={(e) => {
					const d = (e.target as HTMLInputElement).value;
					write(item.itemId, field.id, d ? { kind: 'date', date: d } : undefined);
				}}
			/>
		);
	}

	if (field.type === 'NUMBER') {
		return (
			<input
				class="cell"
				type="number"
				value={(value as any)?.number ?? ''}
				// Commit on blur, not on every keystroke — otherwise "12" writes 1 then 12.
				onBlur={(e) => {
					const raw = (e.target as HTMLInputElement).value;
					const n = raw === '' ? undefined : Number(raw);
					write(item.itemId, field.id, n === undefined || Number.isNaN(n) ? undefined : { kind: 'number', number: n });
				}}
			/>
		);
	}

	return (
		<input
			class="cell"
			type="text"
			value={(value as any)?.text ?? ''}
			onBlur={(e) => {
				const t = (e.target as HTMLInputElement).value;
				write(item.itemId, field.id, t ? { kind: 'text', text: t } : undefined);
			}}
		/>
	);
}

function TitleLink({ item }: { item: Item }) {
	return (
		<button
			class="title-link"
			title={item.kind === 'DRAFT' ? 'Draft item' : 'Open'}
			onClick={() =>
				item.kind !== 'DRAFT' &&
				vscode.postMessage({ type: 'openCard', number: item.number, url: item.url })
			}
		>
			{item.kind === 'DRAFT' ? (
				<span class="pill">Draft</span>
			) : (
				<span class={`state-dot ${item.state?.toLowerCase() ?? ''}`} />
			)}
			<span class="text">{item.title}</span>
			{item.number !== undefined && <span class="num">#{item.number}</span>}
		</button>
	);
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

function TableView({ project, write }: { project: Project; write: Write }) {
	const fields = project.fields.filter(isCustom);

	return (
		<div class="scroller">
			<table class="table">
				<thead>
					<tr>
						<th class="rownum" />
						<th class="col-title">Title</th>
						<th>Assignees</th>
						{fields.map((f) => (
							<th key={f.id}>{f.name}</th>
						))}
						<th />
					</tr>
				</thead>
				<tbody>
					{project.items.map((item, i) => (
						<tr key={item.itemId}>
							<td class="rownum">{i + 1}</td>
							<td class="col-title">
								<TitleLink item={item} />
							</td>
							<td>
								<button
									class="assignees"
									onClick={() =>
										vscode.postMessage({
											type: 'setAssignees',
											itemId: item.itemId,
											url: item.url,
											current: item.assignees,
										})
									}
								>
									{item.assignees.length ? (
										item.assignees.map((a) => (
											<span key={a} class="who">
												{a}
											</span>
										))
									) : (
										<span class="muted">—</span>
									)}
								</button>
							</td>
							{fields.map((f) => (
								<td key={f.id}>
									<Cell item={item} field={f} write={write} />
								</td>
							))}
							<td class="row-tools">
								<button
									title="Rename"
									onClick={() =>
										vscode.postMessage({
											type: 'editTitle',
											itemId: item.itemId,
											title: item.title,
											url: item.url,
										})
									}
								>
									✎
								</button>
								<button
									title="Remove from project"
									onClick={() =>
										vscode.postMessage({
											type: 'deleteItem',
											itemId: item.itemId,
											title: item.title,
											isDraft: item.kind === 'DRAFT',
										})
									}
								>
									✕
								</button>
							</td>
						</tr>
					))}
				</tbody>
			</table>

			<button class="add-row" onClick={() => vscode.postMessage({ type: 'addItem' })}>
				+ Add item
			</button>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

function BoardView({
	project,
	field,
	fields,
	onGroup,
	write,
}: {
	project: Project;
	field: Field | undefined;
	fields: Field[];
	onGroup: (id: string) => void;
	write: Write;
}) {
	const [dragging, setDragging] = useState<string | undefined>();
	const [over, setOver] = useState<string | undefined>();

	if (!field) {
		return (
			<div class="state">
				<p>
					This project has no single-select field, so it has no board columns. Add one — call it
					"Status" — and the board will appear.
				</p>
				<button class="primary" onClick={() => vscode.postMessage({ type: 'manageFields' })}>
					Add a field
				</button>
			</div>
		);
	}

	const columns = field.options.map((o) => ({
		...o,
		items: project.items.filter((it) => (it.values[field.id] as any)?.optionId === o.id),
	}));
	const unassigned = project.items.filter((it) => !it.values[field.id]);

	const drop = (optionId: string) => {
		const itemId = dragging;
		setDragging(undefined);
		setOver(undefined);
		if (!itemId || optionId === NO_STATUS) {
			return;
		}
		write(itemId, field.id, { kind: 'select', optionId });
	};

	const all = [
		...columns,
		...(unassigned.length
			? [{ id: NO_STATUS, name: `No ${field.name}`, color: 'GRAY', description: '', items: unassigned }]
			: []),
	];

	return (
		<>
			{fields.length > 1 && (
				<p class="groupby">
					Grouped by{' '}
					<select value={field.id} onChange={(e) => onGroup((e.target as HTMLSelectElement).value)}>
						{fields.map((f) => (
							<option key={f.id} value={f.id}>
								{f.name}
							</option>
						))}
					</select>
				</p>
			)}

			<div class="columns scroller">
				{all.map((col) => {
					const tray = col.id === NO_STATUS;
					return (
						<section
							key={col.id}
							class={`column${over === col.id ? ' over' : ''}${tray ? ' locked' : ''}`}
							onDragOver={(e) => {
								if (tray) return;
								e.preventDefault();
								setOver(col.id);
							}}
							onDragLeave={() => setOver((o) => (o === col.id ? undefined : o))}
							onDrop={() => drop(col.id)}
						>
							<h2>
								<span class="dot" style={{ background: colorOf(col.color) }} />
								<span class="name">{col.name}</span>
								<span class="count">{col.items.length}</span>
								{!tray && (
									<span class="tools">
										<button
											title="Add an item"
											onClick={() =>
												vscode.postMessage({
													type: 'addItem',
													fieldId: field.id,
													optionId: col.id,
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
													fieldId: field.id,
													optionId: col.id,
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
													fieldId: field.id,
													optionId: col.id,
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
													fieldId: field.id,
													optionId: col.id,
													name: col.name,
													fieldName: field.name,
													count: col.items.length,
												})
											}
										>
											✕
										</button>
									</span>
								)}
							</h2>

							{'description' in col && (col as any).description && (
								<p class="col-desc">{(col as any).description}</p>
							)}

							<div class="cards">
								{col.items.map((item) => (
									<article
										key={item.itemId}
										class={`card${dragging === item.itemId ? ' dragging' : ''}`}
										draggable
										onDragStart={() => setDragging(item.itemId)}
										onDragEnd={() => {
											setDragging(undefined);
											setOver(undefined);
										}}
										onClick={() =>
											item.kind !== 'DRAFT' &&
											vscode.postMessage({ type: 'openCard', number: item.number, url: item.url })
										}
										title={item.kind === 'DRAFT' ? 'Draft item' : 'Click to open'}
									>
										<p class="title">{item.title}</p>

										{item.labels.length > 0 && (
											<div class="labels">
												{item.labels.map((l) => (
													<span key={l.name} class="label" style={{ borderColor: `#${l.color}` }}>
														{l.name}
													</span>
												))}
											</div>
										)}

										<footer>
											{item.kind === 'DRAFT' ? (
												<span class="pill">Draft</span>
											) : (
												<span class="num">#{item.number}</span>
											)}
											{item.assignees.map((a) => (
												<span key={a} class="who">
													{a}
												</span>
											))}
											<span class="tools" onClick={(e) => e.stopPropagation()}>
												{item.kind === 'DRAFT' && (
													<button
														title="Convert to a real issue"
														onClick={() =>
															vscode.postMessage({
																type: 'convertDraft',
																itemId: item.itemId,
																isDraft: true,
															})
														}
													>
														↥
													</button>
												)}
												{item.url && (
													<button
														title="Open on GitHub"
														onClick={() =>
															vscode.postMessage({ type: 'openCardExternal', url: item.url })
														}
													>
														↗
													</button>
												)}
												<button
													title={item.kind === 'DRAFT' ? 'Delete draft' : 'Remove from project'}
													onClick={() =>
														vscode.postMessage({
															type: 'deleteItem',
															itemId: item.itemId,
															title: item.title,
															isDraft: item.kind === 'DRAFT',
														})
													}
												>
													✕
												</button>
											</span>
										</footer>
									</article>
								))}
								{col.items.length === 0 && <p class="empty">Drop cards here</p>}
							</div>
						</section>
					);
				})}

				<button
					class="add-column"
					onClick={() =>
						vscode.postMessage({ type: 'addColumn', fieldId: field.id, fieldName: field.name })
					}
				>
					+ Add column
				</button>
			</div>
		</>
	);
}

// ---------------------------------------------------------------------------
// Roadmap
// ---------------------------------------------------------------------------

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / DAY);

function RoadmapView({
	project,
	roadmap,
	write,
}: {
	project: Project;
	roadmap: { startFieldId?: string; targetFieldId?: string };
	write: Write;
}) {
	const [zoom, setZoom] = useState<'month' | 'quarter'>('month');

	const dateFields = project.fields.filter((f) => f.type === 'DATE');
	const start = dateFields.find((f) => f.id === roadmap.startFieldId);
	const target = dateFields.find((f) => f.id === roadmap.targetFieldId);

	const plan = useMemo(() => {
		if (!start || !target) {
			return undefined;
		}
		const dated: { item: Item; from: Date; to: Date }[] = [];
		const undated: Item[] = [];

		for (const item of project.items) {
			const s = (item.values[start.id] as any)?.date;
			const t = (item.values[target.id] as any)?.date;
			if (!s && !t) {
				undated.push(item);
				continue;
			}
			// One date is enough to place an item; a missing end just means a single day.
			const from = new Date(s ?? t);
			const to = new Date(t ?? s);
			dated.push({ item, from, to: to < from ? from : to });
		}

		if (dated.length === 0) {
			return { dated, undated, from: undefined, to: undefined };
		}
		const min = new Date(Math.min(...dated.map((d) => d.from.getTime())));
		const max = new Date(Math.max(...dated.map((d) => d.to.getTime())));
		return { dated, undated, from: addDays(min, -3), to: addDays(max, 3) };
	}, [project, start, target]);

	if (dateFields.length < 1) {
		return (
			<div class="state">
				<p>
					A roadmap needs date fields, and this project has none. RepoDeck can create a "Start date"
					and a "Target date" field for you.
				</p>
				<div class="actions">
					<button class="primary" onClick={() => vscode.postMessage({ type: 'createDateFields' })}>
						Create date fields
					</button>
				</div>
			</div>
		);
	}

	if (!start || !target) {
		return (
			<div class="state">
				<p>Choose which date fields mean start and target for this project.</p>
				<div class="actions">
					<button
						class="primary"
						onClick={() =>
							vscode.postMessage({
								type: 'pickRoadmapFields',
								dateFields: dateFields.map((f) => ({ id: f.id, name: f.name })),
							})
						}
					>
						Choose date fields
					</button>
					{dateFields.length < 2 && (
						<button onClick={() => vscode.postMessage({ type: 'createDateFields' })}>
							Create date fields
						</button>
					)}
				</div>
			</div>
		);
	}

	const dayW = zoom === 'month' ? 26 : 9;
	const span = plan?.from && plan.to ? daysBetween(plan.from, plan.to) + 1 : 0;
	const today = new Date();

	return (
		<div class="roadmap">
			<div class="roadmap-bar">
				<span class="muted">
					{start.name} → {target.name}
				</span>
				<div class="actions">
					<button
						onClick={() =>
							vscode.postMessage({
								type: 'pickRoadmapFields',
								dateFields: dateFields.map((f) => ({ id: f.id, name: f.name })),
							})
						}
					>
						Date fields…
					</button>
					<button class={zoom === 'month' ? 'on' : undefined} onClick={() => setZoom('month')}>
						Month
					</button>
					<button class={zoom === 'quarter' ? 'on' : undefined} onClick={() => setZoom('quarter')}>
						Quarter
					</button>
				</div>
			</div>

			{span > 0 && plan?.from ? (
				<div class="scroller">
					<div class="gantt" style={{ width: `${240 + span * dayW}px` }}>
						<div class="axis" style={{ marginLeft: '240px', width: `${span * dayW}px` }}>
							{Array.from({ length: span }).map((_, i) => {
								const d = addDays(plan.from!, i);
								const first = d.getDate() === 1;
								const isToday = iso(d) === iso(today);
								return (
									<span
										key={i}
										class={`tick${first ? ' month' : ''}${isToday ? ' today' : ''}`}
										style={{ width: `${dayW}px` }}
									>
										{zoom === 'month' ? d.getDate() : first ? d.getMonth() + 1 : ''}
									</span>
								);
							})}
						</div>

						{plan.dated.map(({ item, from, to }) => {
							const left = daysBetween(plan.from!, from) * dayW;
							const width = Math.max((daysBetween(from, to) + 1) * dayW, 6);
							return (
								<div class="gantt-row" key={item.itemId}>
									<div class="gantt-label">
										<TitleLink item={item} />
									</div>
									<div class="gantt-track" style={{ width: `${span * dayW}px` }}>
										<div
											class="bar"
											style={{ left: `${left}px`, width: `${width}px` }}
											title={`${iso(from)} → ${iso(to)}`}
											onClick={() =>
												item.kind !== 'DRAFT' &&
												vscode.postMessage({
													type: 'openCard',
													number: item.number,
													url: item.url,
												})
											}
										>
											<span>{item.title}</span>
										</div>
									</div>
								</div>
							);
						})}
					</div>
				</div>
			) : (
				<p class="muted pad">Nothing has dates yet. Set some below and they'll appear here.</p>
			)}

			{plan && plan.undated.length > 0 && (
				<section class="undated">
					<h2>No dates ({plan.undated.length})</h2>
					<div class="scroller">
						<table class="table">
							<thead>
								<tr>
									<th class="col-title">Title</th>
									<th>{start.name}</th>
									<th>{target.name}</th>
								</tr>
							</thead>
							<tbody>
								{plan.undated.map((item) => (
									<tr key={item.itemId}>
										<td class="col-title">
											<TitleLink item={item} />
										</td>
										<td>
											<Cell item={item} field={start} write={write} />
										</td>
										<td>
											<Cell item={item} field={target} write={write} />
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</section>
			)}
		</div>
	);
}

render(<App />, document.getElementById('root')!);
