import * as vscode from 'vscode';
import { getOctokit } from '../auth/session';
import { readRepoState, type RepoRef } from '../github/repoContext';

export interface IssueItem {
	number: number;
	title: string;
	state: string;
	url: string;
	assignees: string[];
	labels: string[];
	nodeId: string;
}

type Node = CategoryNode | IssueNode;

class CategoryNode {
	readonly kind = 'category';
	constructor(
		readonly label: string,
		readonly query: (ref: RepoRef, login: string) => string,
	) {}
}

class IssueNode {
	readonly kind = 'issue';
	constructor(readonly issue: IssueItem) {}
}

/**
 * VS Code hands the *tree element* to view/item commands, but the element passed to a
 * TreeItem's `command.arguments`. So a command can be invoked with either shape depending
 * on whether the user clicked the row or its inline button — normalise both here.
 */
export function toIssue(arg: IssueItem | { issue: IssueItem }): IssueItem {
	return 'issue' in arg ? arg.issue : arg;
}

const CATEGORIES = [
	new CategoryNode(
		'Assigned to Me',
		(r, login) => `repo:${r.owner}/${r.repo} is:issue is:open assignee:${login}`,
	),
	new CategoryNode(
		'Created by Me',
		(r, login) => `repo:${r.owner}/${r.repo} is:issue is:open author:${login}`,
	),
	new CategoryNode('All Open Issues', (r) => `repo:${r.owner}/${r.repo} is:issue is:open`),
];

export class IssuesTreeProvider implements vscode.TreeDataProvider<Node> {
	private readonly changed = new vscode.EventEmitter<Node | undefined>();
	readonly onDidChangeTreeData = this.changed.event;

	constructor(private readonly context: vscode.ExtensionContext) {}

	refresh(): void {
		this.changed.fire(undefined);
	}

	getTreeItem(node: Node): vscode.TreeItem {
		if (node.kind === 'category') {
			const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
			item.contextValue = 'category';
			return item;
		}

		const { issue } = node;
		const item = new vscode.TreeItem(`#${issue.number} ${issue.title}`);
		item.description = issue.assignees.join(', ');
		item.tooltip = new vscode.MarkdownString(
			`**#${issue.number}** ${issue.title}\n\n${issue.labels.map((l) => `\`${l}\``).join(' ')}`,
		);
		item.iconPath = new vscode.ThemeIcon(
			issue.state === 'open' ? 'issues' : 'issue-closed',
			new vscode.ThemeColor(issue.state === 'open' ? 'charts.green' : 'charts.purple'),
		);
		item.contextValue = 'issue';
		item.command = {
			command: 'repodeck.openIssue',
			title: 'Open Issue',
			arguments: [issue],
		};
		return item;
	}

	async getChildren(node?: Node): Promise<Node[]> {
		if (!node) {
			const state = await readRepoState();
			return state.ref ? [...CATEGORIES] : [];
		}
		if (node.kind === 'issue') {
			return [];
		}

		const [state, octokit] = await Promise.all([
			readRepoState(),
			getOctokit(this.context, false),
		]);
		if (!state.ref || !octokit) {
			return [];
		}

		const login = (await octokit.rest.users.getAuthenticated()).data.login;

		// The search API is one call for any category, where the issues API would need
		// different endpoints per filter.
		const { data } = await octokit.rest.search.issuesAndPullRequests({
			q: node.query(state.ref, login),
			per_page: 50,
		});

		return data.items.map(
			(i) =>
				new IssueNode({
					number: i.number,
					title: i.title,
					state: i.state,
					url: i.html_url,
					nodeId: i.node_id,
					assignees: (i.assignees ?? []).map((a) => a.login),
					labels: (i.labels ?? []).map((l) => (typeof l === 'string' ? l : (l.name ?? ''))),
				}),
		);
	}
}
