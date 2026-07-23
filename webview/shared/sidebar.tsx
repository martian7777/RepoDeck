import type { ComponentChildren } from 'preact';
import { Avatar } from './timeline';

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

export interface SelectField {
	fieldId: string;
	name: string;
	optionId?: string;
	options: { id: string; name: string; color: string }[];
}

export interface ProjectLink {
	itemId: string;
	projectId: string;
	projectTitle: string;
	projectUrl: string;
	selectFields: SelectField[];
	readonlyFields: { name: string; value: string }[];
}

/** A sidebar block with the gear that opens its picker. `onEdit` omitted = read-only. */
export function Section(props: {
	title: string;
	onEdit?: () => void;
	children: ComponentChildren;
}) {
	return (
		<section class="side">
			<h2>
				{props.title}
				{props.onEdit && (
					<button class="gear" title={`Edit ${props.title.toLowerCase()}`} onClick={props.onEdit}>
						⚙
					</button>
				)}
			</h2>
			{props.children}
		</section>
	);
}

export function LoginList({ logins, empty }: { logins: string[]; empty: string }) {
	if (logins.length === 0) {
		return <p class="muted">{empty}</p>;
	}
	return (
		<div class="chips">
			{logins.map((l) => (
				<span class="chip on" key={l}>
					{l}
				</span>
			))}
		</div>
	);
}

export function LabelList({ labels }: { labels: { name: string; color: string }[] }) {
	if (labels.length === 0) {
		return <p class="muted">None yet</p>;
	}
	return (
		<div class="chips">
			{labels.map((l) => (
				<span class="chip on" key={l.name}>
					<span class="dot" style={{ background: `#${l.color}` }} />
					{l.name}
				</span>
			))}
		</div>
	);
}

export function Participants({ people }: { people: { login: string; avatarUrl: string }[] }) {
	if (people.length === 0) {
		return <p class="muted">No one yet</p>;
	}
	return (
		<div class="faces">
			{people.map((p) => (
				<Avatar key={p.login} login={p.login} url={p.avatarUrl} />
			))}
		</div>
	);
}

/**
 * The Projects block.
 *
 * An item's status is a ProjectV2 field, so every project it's on gets its own set of
 * dropdowns rather than one shared "status" — which is what the board actually models.
 */
export function Projects(props: {
	projects: ProjectLink[];
	readable: boolean;
	onOpen: (url: string) => void;
	onRemove: (p: ProjectLink) => void;
	onSetStatus: (p: ProjectLink, fieldId: string, optionId: string) => void;
}) {
	if (!props.readable) {
		return (
			<p class="muted">
				Your token can't read Projects. Sign out and back in to grant the <code>project</code>{' '}
				scope.
			</p>
		);
	}
	if (props.projects.length === 0) {
		return <p class="muted">Not on a project yet</p>;
	}

	return (
		<>
			{props.projects.map((p) => (
				<div class="project" key={p.itemId}>
					<div class="project-head">
						<button class="link" onClick={() => props.onOpen(p.projectUrl)}>
							{p.projectTitle}
						</button>
						<button class="remove" title="Remove from this project" onClick={() => props.onRemove(p)}>
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
										<span class="dot" style={{ background: COLOR[current.color] ?? COLOR.GRAY }} />
									)}
									<select
										value={f.optionId ?? ''}
										onChange={(e) =>
											props.onSetStatus(p, f.fieldId, (e.target as HTMLSelectElement).value)
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
			))}
		</>
	);
}
