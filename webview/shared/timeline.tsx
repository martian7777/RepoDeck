import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { Markdown } from './markdown';
import { Editor } from './editor';
import { CommentMenu } from './commentMenu';
import { ago, exact } from './time';

export interface TimelineEntry {
	kind: 'comment' | 'event';
	actor: string;
	createdAt: string;
	body?: string;
	id?: number;
	commentKind?: 'comment' | 'review';
	url?: string;
	updatedAt?: string;
	reviewState?: string;
	text?: string;
	icon?: string;
	avatarUrl?: string;
}

const REVIEW_LABEL: Record<string, string> = {
	APPROVED: 'approved these changes',
	CHANGES_REQUESTED: 'requested changes',
	COMMENTED: 'reviewed',
	DISMISSED: 'review dismissed',
};

const REVIEW_PILL: Record<string, string> = {
	APPROVED: 'open',
	CHANGES_REQUESTED: 'closed',
};

/**
 * The avatar on the timeline rail.
 *
 * The webview CSP allows https images, so this is the real GitHub avatar; the initial
 * stays underneath as the fallback for a URL that fails or was never sent.
 */
export function Avatar({ login, url }: { login: string; url?: string }) {
	const [broken, setBroken] = useState(false);
	if (url && !broken) {
		return <img class="avatar" src={url} alt={login} title={login} onError={() => setBroken(true)} />;
	}
	return <span class="avatar">{(login[0] ?? '?').toUpperCase()}</span>;
}

export interface CommentActions {
	viewer: string;
	onCopyLink: (url: string) => void;
	onCopyMarkdown: (body: string) => void;
	onQuoteReply: (body: string) => void;
	/** Saves an edited body. Absent for entries that can't be edited through the API. */
	onSaveEdit?: (entry: TimelineEntry, body: string) => void;
}

/** One comment card: header, `…` menu, body — or an inline editor while being edited. */
export function CommentCard(props: {
	author: string;
	avatarUrl?: string;
	createdAt?: string;
	body: string;
	/** "opened this issue", "commented", … */
	verb: string;
	reviewState?: string;
	edited?: boolean;
	url?: string;
	actions: CommentActions;
	canEdit: boolean;
	onSave?: (body: string) => void;
	/** Rendered instead of the body when there's nothing to show. */
	empty?: ComponentChildren;
	/** A row under the body — where the discussion panel hangs upvote, answer and reply. */
	footer?: ComponentChildren;
}) {
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(props.body);

	const start = () => {
		setDraft(props.body);
		setEditing(true);
	};

	return (
		<article class="comment">
			<header>
				<strong>{props.author}</strong>
				{props.reviewState ? (
					<span class={`pill ${REVIEW_PILL[props.reviewState] ?? ''}`}>
						{REVIEW_LABEL[props.reviewState] ?? props.reviewState.toLowerCase()}
					</span>
				) : (
					<span class="muted">{props.verb}</span>
				)}
				{props.createdAt && (
					<span class="muted when" title={exact(props.createdAt)}>
						{ago(props.createdAt)}
					</span>
				)}
				{props.edited && <span class="muted edited">edited</span>}
				<CommentMenu
					url={props.url}
					body={props.body}
					onCopyLink={props.actions.onCopyLink}
					onCopyMarkdown={props.actions.onCopyMarkdown}
					onQuoteReply={props.actions.onQuoteReply}
					onEdit={props.canEdit && props.onSave ? start : undefined}
				/>
			</header>

			{editing ? (
				<Editor
					value={draft}
					onInput={setDraft}
					rows={8}
					autoFocus
					footer={
						<>
							<button onClick={() => setEditing(false)}>Cancel</button>
							<button
								class="primary"
								disabled={!draft.trim()}
								onClick={() => {
									props.onSave?.(draft);
									setEditing(false);
								}}
							>
								Update comment
							</button>
						</>
					}
				/>
			) : props.body ? (
				<Markdown text={props.body} />
			) : (
				(props.empty ?? null)
			)}

			{!editing && props.footer && <footer class="comment-foot">{props.footer}</footer>}
		</article>
	);
}

/**
 * The whole rail: a lead card for the description, then every entry in order.
 *
 * Both panels render this, so a change to how a comment reads lands in both at once.
 */
export function Timeline(props: {
	lead: {
		author: string;
		avatarUrl?: string;
		createdAt?: string;
		body: string;
		verb: string;
		url?: string;
		canEdit: boolean;
		onSave?: (body: string) => void;
		empty?: ComponentChildren;
	};
	entries: TimelineEntry[];
	actions: CommentActions;
}) {
	return (
		<div class="timeline">
			<div class="tl-row">
				<Avatar login={props.lead.author} url={props.lead.avatarUrl} />
				<CommentCard
					author={props.lead.author}
					createdAt={props.lead.createdAt}
					body={props.lead.body}
					verb={props.lead.verb}
					url={props.lead.url}
					actions={props.actions}
					canEdit={props.lead.canEdit}
					onSave={props.lead.onSave}
					empty={props.lead.empty}
				/>
			</div>

			{props.entries.map((entry, i) =>
				entry.kind === 'comment' ? (
					<div class="tl-row" key={entry.id ?? i}>
						<Avatar login={entry.actor} url={entry.avatarUrl} />
						<CommentCard
							author={entry.actor}
							createdAt={entry.createdAt}
							body={entry.body ?? ''}
							verb="commented"
							reviewState={entry.reviewState}
							edited={Boolean(entry.updatedAt)}
							url={entry.url}
							actions={props.actions}
							canEdit={entry.actor === props.actions.viewer && entry.id !== undefined}
							onSave={
								props.actions.onSaveEdit
									? (body) => props.actions.onSaveEdit!(entry, body)
									: undefined
							}
						/>
					</div>
				) : (
					<div class="tl-row event" key={i}>
						<span class="glyph">{entry.icon ?? '•'}</span>
						<p>
							<strong>{entry.actor}</strong> {entry.text}
							<span class="muted when" title={exact(entry.createdAt)}>
								{ago(entry.createdAt)}
							</span>
						</p>
					</div>
				),
			)}
		</div>
	);
}
