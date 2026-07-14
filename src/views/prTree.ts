import * as vscode from 'vscode';
import { getLogin, getOctokit } from '../auth/session';
import { readRepoState } from '../github/repoContext';
import type { PullSummary } from '../github/prs';

type Node = CategoryNode | PullNode;

class CategoryNode {
	readonly kind = 'category';
	constructor(
		readonly label: string,
		readonly match: (pull: PullSummary, login: string) => boolean,
	) {}
}

class PullNode {
	readonly kind = 'pull';
	constructor(readonly pull: PullSummary) {}
}

/**
 * Four categories, one API call.
 *
 * These were four GitHub search queries. Search is capped at 30 requests a minute, so a
 * PR tree alone could exhaust nearly a sixth of that budget per refresh. `pulls.list`
 * returns reviewers, assignees and the author in a single response — everything these
 * predicates need — against the ordinary 5,000/hour budget.
 */
const CATEGORIES = [
	new CategoryNode('Waiting for My Review', (p, login) => p.reviewers.includes(login)),
	new CategoryNode('Assigned to Me', (p, login) => p.assignees.includes(login)),
	new CategoryNode('Created by Me', (p, login) => p.author === login),
	new CategoryNode('All Open', () => true),
];

/** See `toIssue` — view/item commands get the tree element, row clicks get the payload. */
export function toPull(arg: PullSummary | { pull: PullSummary }): PullSummary {
	return 'pull' in arg ? arg.pull : arg;
}

export class PullsTreeProvider implements vscode.TreeDataProvider<Node> {
	private readonly changed = new vscode.EventEmitter<Node | undefined>();
	readonly onDidChangeTreeData = this.changed.event;

	private pulls: Promise<PullSummary[]> | undefined;

	constructor(private readonly context: vscode.ExtensionContext) {}

	refresh(): void {
		this.pulls = undefined;
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

	private load(): Promise<PullSummary[]> {
		this.pulls ??= (async () => {
			const [state, octokit] = await Promise.all([
				readRepoState(),
				getOctokit(this.context, false),
			]);
			if (!state.ref || !octokit) {
				return [];
			}

			const { data } = await octokit.rest.pulls.list({
				...state.ref,
				state: 'open',
				per_page: 100,
			});

			return data.map((p) => ({
				number: p.number,
				title: p.title,
				state: p.state,
				url: p.html_url,
				author: p.user?.login ?? 'unknown',
				draft: p.draft ?? false,
				assignees: (p.assignees ?? []).map((a) => a.login),
				reviewers: (p.requested_reviewers ?? []).map((r) => r.login),
			}));
		})();

		return this.pulls;
	}

	async getChildren(node?: Node): Promise<Node[]> {
		if (!node) {
			const state = await readRepoState();
			return state.ref ? [...CATEGORIES] : [];
		}
		if (node.kind === 'pull') {
			return [];
		}

		const login = getLogin();
		if (!login) {
			return [];
		}

		const pulls = await this.load();
		return pulls.filter((p) => node.match(p, login)).map((p) => new PullNode(p));
	}
}
