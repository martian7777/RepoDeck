import * as vscode from 'vscode';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export interface RepoRef {
	owner: string;
	repo: string;
}

export interface RepoState {
	root: string | undefined;
	/** True once the folder is a git repo (even an empty one). */
	isGitRepo: boolean;
	hasCommits: boolean;
	/** Set only when a GitHub remote is configured and parseable. */
	ref: RepoRef | undefined;
}

/** Runs git in `cwd`, returning stdout, or undefined if git exits non-zero. */
export async function git(cwd: string, ...args: string[]): Promise<string | undefined> {
	try {
		const { stdout } = await exec('git', args, { cwd });
		return stdout.trim();
	} catch {
		return undefined;
	}
}

/**
 * Parses the owner/repo out of a remote URL. Handles the three forms git hands us:
 * https://github.com/o/r.git, git@github.com:o/r.git, and ssh://git@github.com/o/r.git
 */
export function parseRemote(url: string): RepoRef | undefined {
	const match = /github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/.exec(url.trim());
	if (!match) {
		return undefined;
	}
	return { owner: match[1], repo: match[2] };
}

export function workspaceRoot(): string | undefined {
	return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

export async function readRepoState(): Promise<RepoState> {
	const root = workspaceRoot();
	if (!root) {
		return { root: undefined, isGitRepo: false, hasCommits: false, ref: undefined };
	}

	const isGitRepo = (await git(root, 'rev-parse', '--is-inside-work-tree')) === 'true';
	if (!isGitRepo) {
		return { root, isGitRepo: false, hasCommits: false, ref: undefined };
	}

	// `rev-parse HEAD` fails on a repo with no commits, which is exactly the state
	// `Initialize Repository` has to handle, so absence here is information, not an error.
	const hasCommits = (await git(root, 'rev-parse', '--verify', 'HEAD')) !== undefined;

	const remoteName = vscode.workspace.getConfiguration('repodeck').get<string>('remoteName', 'origin');
	const url = await git(root, 'remote', 'get-url', remoteName);
	const ref = url ? parseRemote(url) : undefined;

	return { root, isGitRepo, hasCommits, ref };
}

/** Publishes `repodeck:hasRepo` so the views/menus can react without polling. */
export async function refreshRepoContext(): Promise<RepoState> {
	const state = await readRepoState();
	await vscode.commands.executeCommand('setContext', 'repodeck:hasRepo', state.ref !== undefined);
	return state;
}
