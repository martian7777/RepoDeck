import * as vscode from 'vscode';
import { getOctokit } from '../auth/session';
import { readRepoState, type RepoRef } from '../github/repoContext';
import type { PullSummary } from '../github/prs';

type Node = CategoryNode | PullNode;

class CategoryNode {
	readonly kind = 'category';
	constructor(
		readonly label: string,
		readonly query: (ref: RepoRef, login: string) => string,
	) {}
}

class PullNode {
	readonly kind = 'pull';
	constructor(readonly pull: PullSummary) {}
}

/** See `toIssue` — view/item commands get the tree element, row clicks get the payload. */
export function toPull(arg: PullSummary | { pull: PullSummary }): PullSummary {
	return 'pull' in arg ? arg.pull : arg;
}

const CATEGORIES = [
	new CategoryNode(
		'Waiting for My Review',
		(r, login) => `repo:${r.owner}/${r.repo} is:pr is:open review-requested:${login}`,
	),
	new CategoryNode(
		'Assigned to Me',
		(r, login) => `repo:${r.owner}/${r.repo} is:pr is:open assignee:${login}`,
	),
	new CategoryNode(
		'Created by Me',
		(r, login) => `repo:${r.owner}/${r.repo} is:pr is:open author:${login}`,
	),
	new CategoryNode('All Open', (r) => `repo:${r.owner}/${r.repo} is:pr is:open`),
];

export class PullsTreeProvider implements vscode.TreeDataProvider<Node> {
	private readonly changed = new vscode.EventEmitter<Node | undefined>();
	readonly onDidChangeTreeData = this.changed.event;

	constructor(private readonly context: vscode.ExtensionContext) {}

	refresh(): void {
		this.changed.fire(undefined);
	}

	getTreeItem(node: Node): vscode.TreeItem {
		if (node.kind === 'category') {
			return Object.assign(
				new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded),
				{ contextValue: 'category' },
			);
		}

		const { pull } = node;
		const item = new vscode.TreeItem(`#${pull.number} ${pull.title}`);
		item.description = pull.author;
		item.iconPath = new vscode.ThemeIcon(
			pull.draft ? 'git-pull-request-draft' : 'git-pull-request',
			new vscode.ThemeColor(pull.draft ? 'descriptionForeground' : 'charts.green'),
		);
		item.contextValue = 'pull';
		item.command = {
			command: 'repodeck.openPr',
			title: 'Open Pull Request',
			arguments: [pull],
		};
		return item;
	}

	async getChildren(node?: Node): Promise<Node[]> {
		if (!node) {
			const state = await readRepoState();
			return state.ref ? [...CATEGORIES] : [];
		}
		if (node.kind === 'pull') {
			return [];
		}

		const [state, octokit] = await Promise.all([readRepoState(), getOctokit(this.context, false)]);
		if (!state.ref || !octokit) {
			return [];
		}

		const login = (await octokit.rest.users.getAuthenticated()).data.login;
		const { data } = await octokit.rest.search.issuesAndPullRequests({
			q: node.query(state.ref, login),
			per_page: 50,
		});

		return data.items.map(
			(i) =>
				new PullNode({
					number: i.number,
					title: i.title,
					state: i.state,
					url: i.html_url,
					author: i.user?.login ?? 'unknown',
					draft: i.draft ?? false,
				}),
		);
	}
}
