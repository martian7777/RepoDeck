import * as vscode from 'vscode';

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
	bundle: 'board' | 'form' | 'pr' | 'issue',
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
