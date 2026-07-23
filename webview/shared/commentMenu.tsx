import { useEffect, useRef, useState } from 'preact/hooks';

/**
 * The `…` menu GitHub hangs off a comment.
 *
 * Copy link and Copy Markdown go through the extension host, which owns the clipboard —
 * a webview has no reliable `navigator.clipboard`. Quote reply and Edit are local: they
 * only move text around inside the panel.
 */
export function CommentMenu(props: {
	/** Permalink. Absent on entries GitHub gave us no url for, which hides Copy link. */
	url?: string;
	/** Raw markdown source, for Copy Markdown and Quote reply. */
	body: string;
	onCopyLink: (url: string) => void;
	onCopyMarkdown: (body: string) => void;
	onQuoteReply: (body: string) => void;
	/** Absent when the viewer didn't write this, which hides Edit. */
	onEdit?: () => void;
}) {
	const [open, setOpen] = useState(false);
	const root = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (!open) {
			return;
		}
		const onDown = (e: MouseEvent) => {
			if (!root.current?.contains(e.target as Node)) {
				setOpen(false);
			}
		};
		const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
		document.addEventListener('mousedown', onDown);
		document.addEventListener('keydown', onKey);
		return () => {
			document.removeEventListener('mousedown', onDown);
			document.removeEventListener('keydown', onKey);
		};
	}, [open]);

	const pick = (fn: () => void) => () => {
		setOpen(false);
		fn();
	};

	return (
		<div class="menu" ref={root}>
			<button class="dots" title="More options" aria-label="More options" onClick={() => setOpen(!open)}>
				⋯
			</button>
			{open && (
				<div class="menu-pop">
					{props.url && (
						<button onClick={pick(() => props.onCopyLink(props.url!))}>
							<span class="glyph">🔗</span> Copy link
						</button>
					)}
					<button onClick={pick(() => props.onCopyMarkdown(props.body))}>
						<span class="glyph">M</span> Copy Markdown
					</button>
					<button onClick={pick(() => props.onQuoteReply(props.body))}>
						<span class="glyph">❝</span> Quote reply
					</button>
					{props.onEdit && (
						<button onClick={pick(props.onEdit)}>
							<span class="glyph">✎</span> Edit
						</button>
					)}
				</div>
			)}
		</div>
	);
}

/** Turns a body into the `> `-prefixed block Quote reply drops into the composer. */
export function quote(body: string): string {
	const quoted = (body || '').split('\n').map((l) => `> ${l}`).join('\n');
	return `${quoted}\n\n`;
}
