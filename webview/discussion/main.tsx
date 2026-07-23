import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Editor } from '../shared/editor';
import { quote } from '../shared/commentMenu';
import { ActionButton, useOps } from '../shared/ops';
import { Avatar, CommentCard, type CommentActions } from '../shared/timeline';
import { LabelList, Participants, Section } from '../shared/sidebar';

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };
const vscode = acquireVsCodeApi();

interface Category {
	id: string;
	name: string;
	emoji: string;
	isAnswerable: boolean;
}

interface Comment {
	id: string;
	body: string;
	author: string;
	avatarUrl: string;
	createdAt: string;
	lastEditedAt?: string;
	url: string;
	upvotes: number;
	viewerHasUpvoted: boolean;
	viewerCanUpvote: boolean;
	viewerCanUpdate: boolean;
	viewerCanMarkAsAnswer: boolean;
	isAnswer: boolean;
	replies: Comment[];
}

interface Discussion {
	id: string;
	number: number;
	title: string;
	body: string;
	url: string;
	author: string;
	authorAvatarUrl: string;
	createdAt: string;
	lastEditedAt?: string;
	closed: boolean;
	locked: boolean;
	upvotes: number;
	viewerHasUpvoted: boolean;
	viewerCanUpvote: boolean;
	viewerCanUpdate: boolean;
	category: Category;
	labels: { name: string; color: string }[];
	participants: { login: string; avatarUrl: string }[];
	comments: Comment[];
}

/** The "↑ n" pill GitHub hangs off a discussion body and every comment. */
function Upvote(props: {
	count: number;
	on: boolean;
	disabled: boolean;
	onToggle: () => void;
}) {
	return (
		<button
			class={`upvote${props.on ? ' on' : ''}`}
			disabled={props.disabled}
			title={props.disabled ? 'You can’t upvote this' : props.on ? 'Remove upvote' : 'Upvote'}
			onClick={props.onToggle}
		>
			↑ {props.count}
		</button>
	);
}

function App() {
	const [discussion, setDiscussion] = useState<Discussion | undefined>();
	const [repo, setRepo] = useState('');
	const [viewer, setViewer] = useState('');
	const [error, setError] = useState<string | undefined>();
	const [actionError, setActionError] = useState<string | undefined>();
	const [loading, setLoading] = useState(true);
	const [draft, setDraft] = useState('');

	// One reply box open at a time, keyed by the top-level comment it hangs under —
	// which is the only thing GitHub lets you reply to.
	const [replyTo, setReplyTo] = useState<string | undefined>();
	const [replyDraft, setReplyDraft] = useState('');

	const composer = useRef<HTMLTextAreaElement | null>(null);
	const replyBox = useRef<HTMLTextAreaElement | null>(null);
	const ops = useOps(vscode, () => setActionError(undefined));

	useEffect(() => {
		const onMessage = (e: MessageEvent) => {
			const msg = e.data;
			if (msg.type === 'discussion') {
				setDiscussion(msg.discussion);
				setRepo(msg.repo ?? '');
				setViewer(msg.viewer ?? '');
				setError(undefined);
				setLoading(false);
				setDraft('');
				setReplyTo(undefined);
				setReplyDraft('');
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
	if (!discussion) {
		return <div class="state">{loading ? 'Loading discussion…' : 'Nothing to show.'}</div>;
	}

	const send = ops.post;

	const focus = (area: { current: HTMLTextAreaElement | null }) =>
		requestAnimationFrame(() => {
			area.current?.focus();
			area.current?.scrollIntoView({ block: 'center' });
		});

	const append = (existing: string, body: string) =>
		`${existing ? `${existing.replace(/\n*$/, '')}\n\n` : ''}${quote(body)}`;

	/** Quoting the opening post lands in the composer. */
	const quoteToComposer = (body: string) => {
		setDraft((d) => append(d, body));
		focus(composer);
	};

	/** Quoting anything inside a thread lands in that thread's reply box, opening it. */
	const quoteToThread = (threadId: string) => (body: string) => {
		setReplyDraft((d) => append(replyTo === threadId ? d : '', body));
		setReplyTo(threadId);
		focus(replyBox);
	};

	const baseActions = {
		viewer,
		onCopyLink: (url: string) => send({ type: 'copyLink', url }),
		onCopyMarkdown: (body: string) => send({ type: 'copyMarkdown', body }),
	};

	const leadActions: CommentActions = { ...baseActions, onQuoteReply: quoteToComposer };

	const upvote = (subjectId: string, on: boolean) => send({ type: 'upvote', subjectId, on: !on });

	/** A top-level comment, its replies, and the reply box that posts into the thread. */
	const Thread = ({ comment }: { comment: Comment }) => {
		const actions: CommentActions = { ...baseActions, onQuoteReply: quoteToThread(comment.id) };
		const answerable = discussion.category.isAnswerable;

		const footer = (comment: Comment, canReply: boolean) => (
			<>
				<Upvote
					count={comment.upvotes}
					on={comment.viewerHasUpvoted}
					disabled={!comment.viewerCanUpvote && !comment.viewerHasUpvoted}
					onToggle={() => upvote(comment.id, comment.viewerHasUpvoted)}
				/>
				{answerable && (comment.viewerCanMarkAsAnswer || comment.isAnswer) && (
					<button
						class="link"
						onClick={() => send({ type: 'markAnswer', id: comment.id, on: !comment.isAnswer })}
					>
						{comment.isAnswer ? 'Unmark as answer' : 'Mark as answer'}
					</button>
				)}
				{canReply && !discussion.locked && (
					<button
						class="link"
						onClick={() => {
							setReplyTo(replyTo === comment.id ? undefined : comment.id);
							focus(replyBox);
						}}
					>
						Reply
					</button>
				)}
			</>
		);

		return (
			<div class={`thread${comment.replies.length > 0 ? ' has-replies' : ''}`}>
				<div class="tl-row">
					<Avatar login={comment.author} url={comment.avatarUrl} />
					<div class={`tl-body${comment.isAnswer ? ' answered' : ''}`}>
						{comment.isAnswer && <p class="answer-badge">✓ Answer</p>}
						<CommentCard
							author={comment.author}
							createdAt={comment.createdAt}
							body={comment.body}
							verb="commented"
							edited={Boolean(comment.lastEditedAt)}
							url={comment.url}
							actions={actions}
							canEdit={comment.viewerCanUpdate}
							onSave={(body) =>
								ops.run(`edit:${comment.id}`, { type: 'editComment', id: comment.id, body })
							}
							footer={footer(comment, true)}
						/>
					</div>
				</div>

				{comment.replies.length > 0 && (
					<div class="tl-replies">
						{comment.replies.map((reply) => (
							<div class="tl-row" key={reply.id}>
								<Avatar login={reply.author} url={reply.avatarUrl} />
								<CommentCard
									author={reply.author}
									createdAt={reply.createdAt}
									body={reply.body}
									verb="replied"
									edited={Boolean(reply.lastEditedAt)}
									url={reply.url}
									actions={actions}
									canEdit={reply.viewerCanUpdate}
									onSave={(body) =>
										ops.run(`edit:${reply.id}`, { type: 'editComment', id: reply.id, body })
									}
									// Replies can't be replied to — GitHub allows one level.
									footer={footer(reply, false)}
								/>
							</div>
						))}
					</div>
				)}

				{replyTo === comment.id && (
					<div class="reply-box">
						<Editor
							value={replyDraft}
							onInput={setReplyDraft}
							rows={4}
							textareaRef={replyBox}
							placeholder="Write a reply…"
							footer={
								<>
									<button onClick={() => setReplyTo(undefined)}>Cancel</button>
									<ActionButton
										class="primary"
										busy={ops.busy(`reply:${comment.id}`)}
										disabled={!replyDraft.trim()}
										label="Reply"
										busyLabel="Replying…"
										onClick={() =>
											ops.run(`reply:${comment.id}`, {
												type: 'reply',
												replyToId: comment.id,
												body: replyDraft,
											})
										}
									/>
								</>
							}
						/>
					</div>
				)}
			</div>
		);
	};

	const total = discussion.comments.reduce((n, c) => n + 1 + c.replies.length, 0);

	return (
		<div class="discussion issue">
			<header>
				<h1>
					{discussion.title} <span class="num">#{discussion.number}</span>
					{discussion.viewerCanUpdate && (
						<button class="gear" title="Rename" onClick={() => send({ type: 'editTitle' })}>
							✎
						</button>
					)}
				</h1>
				<p class="meta">
					<span class={`pill ${discussion.closed ? 'closed' : 'open'}`}>
						{discussion.closed ? '✓ Closed' : '⊙ Open'}
					</span>
					<span class="repo">{repo}</span>
					<span class="muted">
						<strong>{discussion.author}</strong> started this in{' '}
						{discussion.category.emoji} {discussion.category.name}
					</span>
				</p>
				<div class="actions">
					<button onClick={() => send({ type: 'refresh' })}>Refresh</button>
					<button onClick={() => send({ type: 'openExternal', url: discussion.url })}>
						Open on GitHub
					</button>
					{loading && <span class="muted">Refreshing…</span>}
				</div>
			</header>

			{actionError && <p class="error">{actionError}</p>}

			<div class="layout">
				<main>
					<div class="timeline">
						<div class="tl-row">
							<Avatar login={discussion.author} url={discussion.authorAvatarUrl} />
							<CommentCard
								author={discussion.author}
								createdAt={discussion.createdAt}
								body={discussion.body}
								verb="started this discussion"
								edited={Boolean(discussion.lastEditedAt)}
								url={discussion.url}
								actions={leadActions}
								canEdit={discussion.viewerCanUpdate}
								onSave={(body) => ops.run('editBody', { type: 'editBody', body })}
								empty={<p class="muted">No description provided.</p>}
								footer={
									<Upvote
										count={discussion.upvotes}
										on={discussion.viewerHasUpvoted}
										disabled={!discussion.viewerCanUpvote && !discussion.viewerHasUpvoted}
										onToggle={() => upvote(discussion.id, discussion.viewerHasUpvoted)}
									/>
								}
							/>
						</div>
					</div>

					<h2 class="count">
						{total} {total === 1 ? 'comment' : 'comments'}
					</h2>

					<div class="timeline threads">
						{discussion.comments.map((c) => (
							<Thread comment={c} key={c.id} />
						))}
					</div>

					{discussion.locked ? (
						<p class="muted">This discussion is locked.</p>
					) : (
						<section class="compose">
							<h2>Add a comment</h2>
							<Editor
								value={draft}
								onInput={setDraft}
								textareaRef={composer}
								footer={
									<>
										{discussion.viewerCanUpdate && (
											<ActionButton
												busy={ops.busy('state')}
												label={discussion.closed ? 'Reopen discussion' : 'Close discussion'}
												busyLabel={discussion.closed ? 'Reopening…' : 'Closing…'}
												onClick={() =>
													ops.run('state', { type: 'setState', closed: !discussion.closed })
												}
											/>
										)}
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
					)}
				</main>

				<aside>
					<Section
						title="Category"
						onEdit={discussion.viewerCanUpdate ? () => send({ type: 'editCategory' }) : undefined}
					>
						<p>
							{discussion.category.emoji} {discussion.category.name}
						</p>
					</Section>

					<Section title="Labels">
						<LabelList labels={discussion.labels} />
					</Section>

					{discussion.category.isAnswerable && (
						<Section title="Answer">
							{discussion.comments.some((c) => c.isAnswer) ? (
								<p>Answered</p>
							) : (
								<p class="muted">Not answered yet</p>
							)}
						</Section>
					)}

					<Section title={`${discussion.participants.length} participants`}>
						<Participants people={discussion.participants} />
					</Section>
				</aside>
			</div>
		</div>
	);
}

render(<App />, document.getElementById('root')!);
