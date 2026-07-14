import { render } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

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

/** Filters over data already in the webview — matching costs nothing and hits no network. */
function matches(item: Item, query: string): boolean {
	const q = query.trim().toLowerCase();
	if (!q) {
		return true;
	}
	return (
		item.title.toLowerCase().includes(q) ||
		`#${item.number}`.includes(q) ||
		item.assignees.some((a) => a.toLowerCase().includes(q)) ||
		item.labels.some((l) => l.name.toLowerCase().includes(q))
	);
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

function App() {
	const [project, setProject] = useState<Project | undefined>();
	const [layout, setLayout] = useState<Layout>('board');
	const [groupById, setGroupById] = useState<string | undefined>();
	const [roadmap, setRoadmap] = useState<{ startFieldId?: string; targetFieldId?: string }>({});
	const [error, setError] = useState<string | undefined>();
	const [stale, setStale] = useState<string | undefined>();
	const [loading, setLoading] = useState(true);
	const [filter, setFilter] = useState('');
	/** Once the user has chosen a layout here, a later refresh must not yank it back. */
	const [touched, setTouched] = useState(false);

	useEffect(() => {
		const onMessage = (e: MessageEvent) => {
			const msg = e.data;
			if (msg.type === 'project') {
				setProject(msg.project);
				if (!touched) {
					setLayout(msg.layout ?? 'board');
					setGroupById(msg.groupById);
				}
				setRoadmap(msg.roadmap ?? {});
				setError(undefined);
				setStale(undefined);
				setLoading(false);
			} else if (msg.type === 'error') {
				setError(msg.message);
				setProject(undefined);
				setLoading(false);
			} else if (msg.type === 'stale') {
				setStale(msg.message);
				setLoading(false);
			} else if (msg.type === 'loading') {
				setLoading(true);
			}
		};
		window.addEventListener('message', onMessage);
		vscode.postMessage({ type: 'ready' });
		return () => window.removeEventListener('message', onMessage);
	}, [touched]);

	/** Instant: the data is already here, so this is a redraw. The host only persists it. */
	const chooseLayout = (l: Layout) => {
		setTouched(true);
		setLayout(l);
		vscode.postMessage({ type: 'setLayout', layout: l });
	};

	const chooseGroup = (fieldId: string) => {
		setTouched(true);
		setGroupById(fieldId);
		vscode.postMessage({ type: 'groupBy', fieldId });
	};

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

	// Every layout renders the filtered project, so one box filters all three.
	const shown: Project = filter.trim()
		? { ...project, items: project.items.filter((i) => matches(i, filter)) }
		: project;

	return (
		<div class="project">
			<header>
				<div class="row">
					<h1 title={project.title}>{project.title}</h1>
					<div class="actions">
						{loading && <span class="spinner" title="Refreshing" />}
						<button onClick={() => vscode.postMessage({ type: 'manageFields' })}>Fields</button>
						<button onClick={() => vscode.postMessage({ type: 'refresh' })}>Refresh</button>
						<button onClick={() => vscode.postMessage({ type: 'changeProject' })}>
							Change project
						</button>
					</div>
				</div>

				<div class="row">
					<div class="layouts">
						{(['table', 'board', 'roadmap'] as Layout[]).map((l) => (
							<button key={l} class={layout === l ? 'on' : undefined} onClick={() => chooseLayout(l)}>
								{l[0].toUpperCase() + l.slice(1)}
							</button>
						))}
					</div>

					<input
						class="filter"
						type="search"
						value={filter}
						placeholder="Filter by title, #number, assignee or label"
						onInput={(e) => setFilter((e.target as HTMLInputElement).value)}
					/>

					{layout === 'board' && selectFields.length > 1 && groupField && (
						<label class="groupby">
							Group by
							<select
								value={groupField.id}
								onChange={(e) => chooseGroup((e.target as HTMLSelectElement).value)}
							>
								{selectFields.map((f) => (
									<option key={f.id} value={f.id}>
										{f.name}
									</option>
								))}
							</select>
						</label>
					)}
				</div>

				{project.truncated && (
					<p class="warn">Showing the first 1000 items — this project has more.</p>
				)}
				{stale && <p class="warn">{stale}</p>}
				{filter.trim() && (
					<p class="muted small">
						{shown.items.length} of {project.items.length} items
					</p>
				)}
			</header>

			{layout === 'board' && <BoardView project={shown} field={groupField} write={write} />}
			{layout === 'table' && <TableView project={shown} write={write} />}
			{layout === 'roadmap' && <RoadmapView project={shown} roadmap={roadmap} write={write} />}
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

/** Row height must match the CSS, or the virtual window drifts from what's painted. */
const ROW_H = 33;
const OVERSCAN = 6;

type Sort = { key: string; dir: 1 | -1 } | undefined;

function TableView({ project, write }: { project: Project; write: Write }) {
	const fields = project.fields.filter(isCustom);
	const [sort, setSort] = useState<Sort>(undefined);
	const [scrollTop, setScrollTop] = useState(0);
	const [viewport, setViewport] = useState(800);
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const el = ref.current;
		if (!el) {
			return;
		}
		const measure = () => setViewport(el.clientHeight);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		return () => observer.disconnect();
	}, []);

	const items = useMemo(() => {
		if (!sort) {
			return project.items;
		}
		const field = fields.find((f) => f.id === sort.key);

		const rank = (item: Item): string | number => {
			if (sort.key === 'title') {
				return item.title.toLowerCase();
			}
			if (sort.key === 'assignees') {
				return item.assignees.join(',').toLowerCase();
			}
			if (!field) {
				return '';
			}
			const v = item.values[field.id] as any;
			if (!v) {
				// Unset always sorts last, whichever direction — an empty cell isn't "smallest".
				return sort.dir === 1 ? '￿' : '';
			}
			if (field.type === 'SINGLE_SELECT') {
				// Sort by the column's own order (Todo → Done), not alphabetically.
				const i = field.options.findIndex((o) => o.id === v.optionId);
				return i < 0 ? Number.MAX_SAFE_INTEGER : i;
			}
			if (field.type === 'ITERATION') {
				return field.iterations.find((it) => it.id === v.iterationId)?.startDate ?? '';
			}
			return v.number ?? v.date ?? v.text ?? '';
		};

		return [...project.items].sort((a, b) => {
			const x = rank(a);
			const y = rank(b);
			return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
		});
	}, [project.items, sort, fields]);

	const toggle = (key: string) =>
		setSort((s) => (s?.key === key ? (s.dir === 1 ? { key, dir: -1 } : undefined) : { key, dir: 1 }));

	const arrow = (key: string) => (sort?.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : '');

	// Only the rows in view are rendered; the rest is empty space held open by two spacer
	// rows. A 1000-row project would otherwise put thousands of live editors in the DOM.
	const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
	const count = Math.ceil(viewport / ROW_H) + OVERSCAN * 2;
	const visible = items.slice(first, first + count);
	const padTop = first * ROW_H;
	const padBottom = Math.max(0, (items.length - first - visible.length) * ROW_H);

	return (
		<div class="scroller" ref={ref} onScroll={(e) => setScrollTop((e.target as HTMLElement).scrollTop)}>
			<table class="table">
				<thead>
					<tr>
						<th class="rownum" />
						<th class="col-title sortable" onClick={() => toggle('title')}>
							Title{arrow('title')}
						</th>
						<th class="sortable" onClick={() => toggle('assignees')}>
							Assignees{arrow('assignees')}
						</th>
						{fields.map((f) => (
							<th key={f.id} class="sortable" onClick={() => toggle(f.id)}>
								{f.name}
								{arrow(f.id)}
							</th>
						))}
						<th />
					</tr>
				</thead>
				<tbody>
					{padTop > 0 && (
						<tr class="spacer" style={{ height: `${padTop}px` }}>
							<td colSpan={fields.length + 4} />
						</tr>
					)}
					{visible.map((item, i) => (
						<tr key={item.itemId}>
							<td class="rownum">{first + i + 1}</td>
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
					{padBottom > 0 && (
						<tr class="spacer" style={{ height: `${padBottom}px` }}>
							<td colSpan={fields.length + 4} />
						</tr>
					)}
				</tbody>
			</table>

			{items.length === 0 && <p class="muted pad">Nothing matches.</p>}

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
	write,
}: {
	project: Project;
	field: Field | undefined;
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
		<div class="columns">
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
