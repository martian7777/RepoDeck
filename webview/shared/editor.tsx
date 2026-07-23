import type { ComponentChildren } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { Markdown } from './markdown';

/**
 * The comment composer: Write/Preview tabs and a formatting toolbar.
 *
 * Every toolbar button is one of two primitives — wrap the selection, or prefix each
 * selected line — applied through `document.execCommand('insertText')` so the editor's
 * native undo stack keeps working. `setRangeText` is the fallback for when that's gone.
 */

interface Tool {
	label: string;
	title: string;
	apply: (t: HTMLTextAreaElement) => void;
}

const TOOLS: Tool[][] = [
	[
		{ label: 'H', title: 'Heading', apply: (t) => prefixLines(t, '### ') },
		{ label: 'B', title: 'Bold', apply: (t) => wrap(t, '**', '**', 'text') },
		{ label: 'I', title: 'Italic', apply: (t) => wrap(t, '_', '_', 'text') },
	],
	[
		{ label: '❝', title: 'Quote', apply: (t) => prefixLines(t, '> ') },
		{ label: '<>', title: 'Code', apply: (t) => code(t) },
		{ label: '🔗', title: 'Link', apply: (t) => link(t) },
	],
	[
		{ label: '1.', title: 'Numbered list', apply: (t) => numberLines(t) },
		{ label: '•', title: 'Bulleted list', apply: (t) => prefixLines(t, '- ') },
		{ label: '☑', title: 'Task list', apply: (t) => prefixLines(t, '- [ ] ') },
	],
	[
		{ label: '@', title: 'Mention a user', apply: (t) => insert(t, '@') },
		{ label: '#', title: 'Reference an issue or pull request', apply: (t) => insert(t, '#') },
	],
];

/** Replaces the current selection, keeping undo intact where the browser still allows it. */
function replace(t: HTMLTextAreaElement, text: string, selectStart: number, selectEnd: number) {
	t.focus();
	const start = t.selectionStart;
	if (!document.execCommand('insertText', false, text)) {
		t.setRangeText(text, start, t.selectionEnd, 'end');
		t.dispatchEvent(new Event('input', { bubbles: true }));
	}
	t.setSelectionRange(start + selectStart, start + selectEnd);
}

function wrap(t: HTMLTextAreaElement, before: string, after: string, placeholder: string) {
	const selected = t.value.slice(t.selectionStart, t.selectionEnd);
	const inner = selected || placeholder;
	replace(t, `${before}${inner}${after}`, before.length, before.length + inner.length);
}

function insert(t: HTMLTextAreaElement, text: string) {
	replace(t, text, text.length, text.length);
}

/** Expands the selection to whole lines first, so a prefix lands in column zero. */
function lineRange(t: HTMLTextAreaElement): [number, number] {
	const start = t.value.lastIndexOf('\n', t.selectionStart - 1) + 1;
	const nextBreak = t.value.indexOf('\n', t.selectionEnd);
	return [start, nextBreak === -1 ? t.value.length : nextBreak];
}

function prefixLines(t: HTMLTextAreaElement, prefix: string) {
	const [from, to] = lineRange(t);
	t.setSelectionRange(from, to);
	const lines = t.value.slice(from, to).split('\n');
	// A prefix already there is a toggle-off, which is how GitHub's buttons behave.
	const off = lines.every((l) => l.startsWith(prefix));
	const next = lines
		.map((l) => (off ? l.slice(prefix.length) : `${prefix}${l}`))
		.join('\n');
	replace(t, next, 0, next.length);
}

function numberLines(t: HTMLTextAreaElement) {
	const [from, to] = lineRange(t);
	t.setSelectionRange(from, to);
	const next = t.value
		.slice(from, to)
		.split('\n')
		.map((l, i) => `${i + 1}. ${l}`)
		.join('\n');
	replace(t, next, 0, next.length);
}

/** Inline backticks for a single line, a fenced block for anything longer. */
function code(t: HTMLTextAreaElement) {
	const selected = t.value.slice(t.selectionStart, t.selectionEnd);
	if (selected.includes('\n')) {
		replace(t, `\`\`\`\n${selected}\n\`\`\``, 4, 4 + selected.length);
	} else {
		wrap(t, '`', '`', 'code');
	}
}

function link(t: HTMLTextAreaElement) {
	const selected = t.value.slice(t.selectionStart, t.selectionEnd);
	// A selected URL becomes the target; anything else becomes the label.
	if (/^https?:\/\//i.test(selected.trim())) {
		replace(t, `[](${selected})`, 1, 1);
	} else {
		const label = selected || 'text';
		replace(t, `[${label}](url)`, label.length + 3, label.length + 6);
	}
}

export function Editor(props: {
	value: string;
	onInput: (value: string) => void;
	placeholder?: string;
	rows?: number;
	/** Buttons rendered on the right of the "Markdown is supported" footer. */
	footer?: ComponentChildren;
	/** Focus and select nothing on mount — used when Quote reply opens the composer. */
	autoFocus?: boolean;
	textareaRef?: { current: HTMLTextAreaElement | null };
}) {
	const [tab, setTab] = useState<'write' | 'preview'>('write');
	const own = useRef<HTMLTextAreaElement | null>(null);
	const area = props.textareaRef ?? own;

	const run = (tool: Tool) => {
		if (area.current) {
			tool.apply(area.current);
			props.onInput(area.current.value);
		}
	};

	return (
		<div class="editor">
			<div class="editor-bar">
				<div class="tabs small">
					<button class={tab === 'write' ? 'on' : undefined} onClick={() => setTab('write')}>
						Write
					</button>
					<button class={tab === 'preview' ? 'on' : undefined} onClick={() => setTab('preview')}>
						Preview
					</button>
				</div>
				{tab === 'write' && (
					<div class="toolbar">
						{TOOLS.map((group, i) => (
							<div class="tool-group" key={i}>
								{group.map((tool) => (
									<button
										key={tool.label}
										title={tool.title}
										// The button must not steal focus, or the selection it acts on is gone.
										onMouseDown={(e) => e.preventDefault()}
										onClick={() => run(tool)}
									>
										{tool.label}
									</button>
								))}
							</div>
						))}
					</div>
				)}
			</div>

			{tab === 'write' ? (
				<textarea
					ref={area}
					rows={props.rows ?? 6}
					value={props.value}
					autofocus={props.autoFocus}
					placeholder={props.placeholder ?? 'Add your comment here…'}
					onInput={(e) => props.onInput((e.target as HTMLTextAreaElement).value)}
				/>
			) : (
				<div class="preview">
					{props.value.trim() ? (
						<Markdown text={props.value} />
					) : (
						<p class="muted">Nothing to preview.</p>
					)}
				</div>
			)}

			<div class="editor-foot">
				<span class="muted">Markdown is supported</span>
				<div class="actions">{props.footer}</div>
			</div>
		</div>
	);
}
