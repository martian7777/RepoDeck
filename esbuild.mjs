import * as esbuild from 'esbuild';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * libsodium-wrappers' ESM entry (which its `exports` map forces esbuild to pick) imports a
 * sibling `.mjs` it doesn't ship, so the bundle can't resolve it. Its CommonJS build is
 * self-contained; resolve the package straight to that file, sidestepping the exports map.
 */
const libsodiumCjs = {
	name: 'libsodium-cjs',
	setup(build) {
		build.onResolve({ filter: /^libsodium-wrappers$/ }, () => ({
			// require.resolve uses the `require` export condition → the CommonJS build.
			path: require.resolve('libsodium-wrappers'),
		}));
	},
};

/** The extension host: Node, CommonJS, and `vscode` is provided by the runtime. */
const extensionConfig = {
	entryPoints: ['src/extension.ts'],
	bundle: true,
	outfile: 'dist/extension.js',
	platform: 'node',
	format: 'cjs',
	target: 'node18',
	external: ['vscode'],
	plugins: [libsodiumCjs],
	sourcemap: !production,
	minify: production,
	logLevel: 'info',
};

/** The webviews: browser, IIFE, Preact aliased into JSX. */
const webviewConfig = {
	entryPoints: {
		board: 'webview/board/main.tsx',
		form: 'webview/form/main.tsx',
		pr: 'webview/pr/main.tsx',
		issue: 'webview/issue/main.tsx',
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
