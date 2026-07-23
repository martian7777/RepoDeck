import * as vscode from 'vscode';
import { getOctokit } from '../auth/session';
import { readRepoState } from '../github/repoContext';
import {
	discussionsEnabled,
	listCategories,
	listDiscussions,
	type DiscussionCategory,
	type DiscussionSummary,
} from '../github/discussions';

type Node = CategoryNode | DiscussionNode | NoticeNode;

class CategoryNode {
	readonly kind = 'category';
	constructor(
		readonly category: DiscussionCategory,
		readonly discussions: DiscussionSummary[],
	) {}
}

class DiscussionNode {
	readonly kind = 'discussion';
	constructor(readonly discussion: DiscussionSummary) {}
}

/** A leaf that only explains something — Discussions turned off, nothing posted yet. */
class NoticeNode {
	readonly kind = 'notice';
	constructor(readonly text: string) {}
}

/** See issuesTree's `toIssue` — view/item commands get the node, row clicks the payload. */
export function toDiscussion(
	arg: DiscussionSummary | { discussion: DiscussionSummary },
): DiscussionSummary {
	return 'discussion' in arg ? arg.discussion : arg;
}

interface Loaded {
	enabled: boolean;
	categories: DiscussionCategory[];
	discussions: DiscussionSummary[];
}

/**
 * Discussions grouped the way GitHub's own sidebar groups them.
 *
 * Unlike the Issues and Pull Requests trees, the groups aren't predicates we choose — they
 * are the repository's own categories, so they come from the API alongside the list. Both
 * are read once per refresh and shared by every group.
 */
export class DiscussionsTreeProvider implements vscode.TreeDataProvider<Node> {
	private readonly changed = new vscode.EventEmitter<Node | undefined>();
	readonly onDidChangeTreeData = this.changed.event;

	private loaded: Promise<Loaded> | undefined;

	constructor(private readonly context: vscode.ExtensionContext) {}

	refresh(): void {
		this.loaded = undefined;
		this.changed.fire(undefined);
	}

	getTreeItem(node: Node): vscode.TreeItem {
		if (node.kind === 'notice') {
			const item = new vscode.TreeItem(node.text);
			item.contextValue = 'notice';
			return item;
		}

		if (node.kind === 'category') {
			const label = node.category.emoji
				? `${node.category.emoji} ${node.category.name}`
				: node.category.name;
			const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Expanded);
			item.description = String(node.discussions.length);
			item.contextValue = 'category';
			return item;
		}

		const { discussion } = node;
		const item = new vscode.TreeItem(`#${discussion.number} ${discussion.title}`);
		item.description = discussion.author;
		item.tooltip = new vscode.MarkdownString(
			`**#${discussion.number}** ${discussion.title}\n\n` +
				`${discussion.categoryName} · ${discussion.comments} comments · ${discussion.upvotes} upvotes`,
		);
		item.iconPath = discussion.answered
			? new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'))
			: new vscode.ThemeIcon(
					'comment-discussion',
					new vscode.ThemeColor(discussion.closed ? 'descriptionForeground' : 'charts.blue'),
				);
		item.contextValue = 'discussion';
		item.command = {
			command: 'repodeck.openDiscussion',
			title: 'Open Discussion',
			arguments: [discussion],
		};
		return item;
	}

	private load(): Promise<Loaded> {
		this.loaded ??= (async () => {
			const empty: Loaded = { enabled: false, categories: [], discussions: [] };
			const [state, octokit] = await Promise.all([
				readRepoState(),
				getOctokit(this.context, false),
			]);
			if (!state.ref || !octokit) {
				return empty;
			}

			// A repo with the feature off errors on `discussions` rather than returning
			// nothing, so this gate has to come first.
			if (!(await discussionsEnabled(octokit, state.ref).catch(() => false))) {
				return empty;
			}

			const [categories, discussions] = await Promise.all([
				listCategories(octokit, state.ref),
				listDiscussions(octokit, state.ref),
			]);
			return { enabled: true, categories, discussions };
		})();

		return this.loaded;
	}

	async getChildren(node?: Node): Promise<Node[]> {
		if (node) {
			return node.kind === 'category' ? node.discussions.map((d) => new DiscussionNode(d)) : [];
		}

		const state = await readRepoState();
		if (!state.ref) {
			return [];
		}

		const { enabled, categories, discussions } = await this.load();
		if (!enabled) {
			return [new NoticeNode("Discussions aren't enabled for this repository.")];
		}
		if (discussions.length === 0) {
			return [new NoticeNode('No discussions yet.')];
		}

		// Categories keep GitHub's own order; empty ones are left out rather than shown as
		// a row that opens onto nothing.
		return categories
			.map((c) => new CategoryNode(c, discussions.filter((d) => d.categoryId === c.id)))
			.filter((c) => c.discussions.length > 0);
	}
}
