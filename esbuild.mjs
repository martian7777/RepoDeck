import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** The extension host: Node, CommonJS, and `vscode` is provided by the runtime. */
const extensionConfig = {
	entryPoints: ['src/extension.ts'],
	bundle: true,
	outfile: 'dist/extension.js',
	platform: 'node',
	format: 'cjs',
	target: 'node18',
	external: ['vscode'],
	sourcemap: !production,
	minify: production,
	logLevel: 'info',
};

/** The webviews: browser, IIFE, Preact aliased into JSX. */
const webviewConfig = {
	entryPoints: {
		board: 'webview/board/main.tsx',
		form: 'webview/form/main.tsx',
	},
	bundle: true,
	outdir: 'media',
	platform: 'browser',
	format: 'iife',
	target: 'es2020',
	jsx: 'automatic',
	jsxImportSource: 'preact',
	sourcemap: !production,
	minify: production,
	logLevel: 'info',
};

if (watch) {
	const contexts = await Promise.all([
		esbuild.context(extensionConfig),
		esbuild.context(webviewConfig),
	]);
	await Promise.all(contexts.map((c) => c.watch()));
	console.log('watching...');
} else {
	await Promise.all([esbuild.build(extensionConfig), esbuild.build(webviewConfig)]);
}
