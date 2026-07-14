import * as vscode from 'vscode';
import { getLogin, getOctokit } from '../auth/session';
import { readRepoState } from '../github/repoContext';

export interface IssueItem {
	number: number;
	title: string;
	state: string;
	url: string;
	assignees: string[];
	labels: string[];
	nodeId: string;
	author: string;
}

type Node = CategoryNode | IssueNode;

class CategoryNode {
	readonly kind = 'category';
	constructor(
		readonly label: string,
		readonly match: (issue: IssueItem, login: string) => boolean,
	) {}
}

class IssueNode {
	readonly kind = 'issue';
	constructor(readonly issue: IssueItem) {}
}

/**
 * Categories are predicates over one fetch, not separate queries.
 *
 * These used to be GitHub search queries — one API call each. The search API allows only
 * 30 requests a minute across all searches, so three categories × a few refreshes hit the
 * limit fast. `issues.listForRepo` costs one call against the 5,000/hour budget and
 * returns everything these predicates need.
 */
const CATEGORIES = [
	new CategoryNode('Assigned to Me', (i, login) => i.assignees.includes(login)),
	new CategoryNode('Created by Me', (i, login) => i.author === login),
	new CategoryNode('All Open Issues', () => true),
];

/** See prTree's `toPull` — view/item commands get the tree element, row clicks the payload. */
export function toIssue(arg: IssueItem | { issue: IssueItem }): IssueItem {
	return 'issue' in arg ? arg.issue : arg;
}

export class IssuesTreeProvider implements vscode.TreeDataProvider<Node> {
	private readonly changed = new vscode.EventEmitter<Node | undefined>();
	readonly onDidChangeTreeData = this.changed.event;

	/** One fetch feeds every category; cleared on refresh. */
	private issues: Promise<IssueItem[]> | undefined;

	constructor(private readonly context: vscode.ExtensionContext) {}

	refresh(): void {
		this.issues = undefined;
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

	private load(): Promise<IssueItem[]> {
		this.issues ??= (async () => {
			const [state, octokit] = await Promise.all([
				readRepoState(),
				getOctokit(this.context, false),
			]);
			if (!state.ref || !octokit) {
				return [];
			}

			const { data } = await octokit.rest.issues.listForRepo({
				...state.ref,
				state: 'open',
				per_page: 100,
			});

			// The REST API treats pull requests as issues; anything with a `pull_request`
			// key is a PR and belongs in the other tree.
			return data
				.filter((i) => !i.pull_request)
				.map((i) => ({
					number: i.number,
					title: i.title,
					state: i.state,
					url: i.html_url,
					nodeId: i.node_id,
					author: i.user?.login ?? '',
					assignees: (i.assignees ?? []).map((a) => a.login),
					labels: (i.labels ?? []).map((l) => (typeof l === 'string' ? l : (l.name ?? ''))),
				}));
		})();

		return this.issues;
	}

	async getChildren(node?: Node): Promise<Node[]> {
		if (!node) {
			const state = await readRepoState();
			return state.ref ? [...CATEGORIES] : [];
		}
		if (node.kind === 'issue') {
			return [];
		}

		const login = getLogin();
		if (!login) {
			return [];
		}

		const issues = await this.load();
		return issues.filter((i) => node.match(i, login)).map((i) => new IssueNode(i));
	}
}
