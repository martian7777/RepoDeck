import * as vscode from 'vscode';
import { describe } from '../features/initRepo';

function nonce(): string {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

/**
 * Shell HTML for a webview bundle in `media/`.
 *
 * The CSP allows no remote origins at all: the webview never talks to GitHub, it posts
 * intents to the extension host, which holds the token. That keeps the token out of a
 * context that renders user-authored issue text.
 */
export function renderHtml(
	webview: vscode.Webview,
	extensionUri: vscode.Uri,
	bundle: 'board' | 'form' | 'pr' | 'issue' | 'discussion',
	title: string,
): string {
	const n = nonce();
	const script = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', `${bundle}.js`));
	const style = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'webview.css'));

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource}; script-src 'nonce-${n}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link href="${style}" rel="stylesheet">
<title>${title}</title>
</head>
<body>
<div id="root"></div>
<script nonce="${n}" src="${script}"></script>
</body>
</html>`;
}

/**
 * Wires a panel's message handler so the webview always learns when an action settled.
 *
 * A button that spins until it hears back must never be left spinning, so the acknowledgement
 * fires from `finally` — that covers the handler's early returns, which post nothing at all.
 * Messages without an `opId` (`ready`, `refresh`, the copy actions) are simply not tracked.
 */
export function onPanelMessage(
	panel: vscode.WebviewPanel,
	handle: (msg: any) => Promise<void>,
): void {
	panel.webview.onDidReceiveMessage(async (msg) => {
		let ok = true;
		try {
			await handle(msg);
		} catch (err) {
			panel.webview.postMessage({ type: 'actionError', message: describe(err) });
			ok = false;
		} finally {
			if (typeof msg?.opId === 'number') {
				panel.webview.postMessage({ type: 'done', opId: msg.opId, ok });
			}
		}
	});
}
