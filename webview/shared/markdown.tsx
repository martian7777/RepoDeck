import { Marked } from 'marked';

/**
 * Renders issue and PR bodies.
 *
 * Issue bodies are text a stranger can write, and this HTML goes into a webview that talks
 * to the extension host. The CSP already blocks inline scripts, but defence in depth is
 * cheap here: raw HTML in the source is dropped at the renderer rather than escaped and
 * rendered, so no attacker-authored tag ever reaches the DOM in any form.
 */
const marked = new Marked({
	gfm: true,
	breaks: true,
	renderer: {
		html: () => '',
	},
});

/** Anything not on this list is stripped, including javascript: and data: URLs. */
const SAFE_PROTOCOL = /^(https?:|mailto:|#)/i;

function sanitize(html: string): string {
	// marked emits no <script> (we dropped raw HTML above), but links and images still
	// carry attacker-controlled hrefs.
	return html
		.replace(/(href|src)\s*=\s*"([^"]*)"/gi, (whole, attr, url) =>
			SAFE_PROTOCOL.test(url.trim()) ? whole : `${attr}="#"`,
		)
		.replace(/\son\w+\s*=\s*"[^"]*"/gi, '');
}

export function Markdown({ text }: { text: string }) {
	if (!text?.trim()) {
		return null;
	}
	const html = sanitize(marked.parse(text, { async: false }) as string);
	return <div class="md" dangerouslySetInnerHTML={{ __html: html }} />;
}
