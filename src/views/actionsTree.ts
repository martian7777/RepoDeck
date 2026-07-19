import * as vscode from 'vscode';
import { getOctokit, type Client } from '../auth/session';
import { readRepoState, type RepoRef } from '../github/repoContext';
import {
	currentBranch,
	listEnvironments,
	listJobs,
	listRuns,
	listRunsForWorkflow,
	listSecrets,
	listVariables,
	listWorkflows,
	type JobSummary,
	type RunState,
	type RunSummary,
	type Scope,
	type SecretSummary,
	type VariableSummary,
	type WorkflowSummary,
} from '../github/actions';

/** The three top-level sections, matching the GitHub Actions extension's layout. */
type Section = 'currentBranch' | 'workflows' | 'settings';

class SectionNode {
	readonly kind = 'section';
	constructor(readonly section: Section) {}
}
class WorkflowNode {
	readonly kind = 'workflow';
	constructor(readonly workflow: WorkflowSummary) {}
}
export class RunNode {
	readonly kind = 'run';
	constructor(readonly run: RunSummary) {}
}
class JobNode {
	readonly kind = 'job';
	constructor(readonly job: JobSummary) {}
}
class StepNode {
	readonly kind = 'step';
	constructor(
		readonly name: string,
		readonly state: RunState,
	) {}
}
class EnvironmentsNode {
	readonly kind = 'environmentsGroup';
}
class EnvironmentNode {
	readonly kind = 'environment';
	constructor(readonly name: string) {}
}
/** The "Secrets" / "Variables" wrappers directly under Settings. */
class SettingsCategoryNode {
	readonly kind = 'settingsCategory';
	constructor(readonly category: 'secrets' | 'variables') {}
}
/** A container listing secrets or variables for a given scope (repo or environment). */
export class GroupNode {
	readonly kind: 'secretsGroup' | 'variablesGroup';
	constructor(
		kind: 'secretsGroup' | 'variablesGroup',
		readonly scope: Scope,
		readonly label: string,
	) {
		this.kind = kind;
	}
}
export class SecretNode {
	readonly kind = 'secret';
	constructor(
		readonly secret: SecretSummary,
		readonly scope: Scope,
	) {}
}
export class VariableNode {
	readonly kind = 'variable';
	constructor(
		readonly variable: VariableSummary,
		readonly scope: Scope,
	) {}
}
/** A non-interactive placeholder row, e.g. "No repository variables defined". */
class MessageNode {
	readonly kind = 'message';
	constructor(readonly text: string) {}
}

type Node =
	| SectionNode
	| WorkflowNode
	| RunNode
	| JobNode
	| StepNode
	| EnvironmentsNode
	| EnvironmentNode
	| SettingsCategoryNode
	| GroupNode
	| SecretNode
	| VariableNode
	| MessageNode;

const SECTION_LABELS: Record<Section, string> = {
	currentBranch: 'Current Branch',
	workflows: 'Workflows',
	settings: 'Settings',
};

/** State → codicon + theme colour, shared by runs, jobs, and steps. */
function stateIcon(state: RunState): vscode.ThemeIcon {
	switch (state) {
		case 'success':
			return new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('charts.green'));
		case 'failure':
			return new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red'));
		case 'in_progress':
			return new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('charts.yellow'));
		default:
			// cancelled, skipped.
			return new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('descriptionForeground'));
	}
}

export class ActionsTreeProvider implements vscode.TreeDataProvider<Node> {
	private readonly changed = new vscode.EventEmitter<Node | undefined>();
	readonly onDidChangeTreeData = this.changed.event;

	constructor(private readonly context: vscode.ExtensionContext) {}

	refresh(): void {
		this.changed.fire(undefined);
	}

	/** Resolves the repo ref and an authenticated client, or undefined if not ready. */
	private async resolve(): Promise<{ octokit: Client; ref: RepoRef; root: string } | undefined> {
		const [state, octokit] = await Promise.all([
			readRepoState(),
			getOctokit(this.context, false),
		]);
		if (!state.ref || !state.root || !octokit) {
			return undefined;
		}
		return { octokit, ref: state.ref, root: state.root };
	}

	getTreeItem(node: Node): vscode.TreeItem {
		const Collapsed = vscode.TreeItemCollapsibleState.Collapsed;
		const Expanded = vscode.TreeItemCollapsibleState.Expanded;

		switch (node.kind) {
			case 'section': {
				const item = new vscode.TreeItem(SECTION_LABELS[node.section], Expanded);
				item.contextValue = 'section';
				return item;
			}
			case 'workflow': {
				const item = new vscode.TreeItem(node.workflow.name, Collapsed);
				item.iconPath = new vscode.ThemeIcon('play-circle');
				item.description = node.workflow.path.replace(/^\.github\/workflows\//, '');
				item.contextValue = 'workflow';
				return item;
			}
			case 'run': {
				const { run } = node;
				const item = new vscode.TreeItem(`${run.name} #${run.runNumber}`, Collapsed);
				item.iconPath = stateIcon(run.state);
				item.description = `${run.event} · ${run.branch}`;
				item.tooltip = new vscode.MarkdownString(
					`**${run.name}** #${run.runNumber}\n\n${run.state} · ${run.event} · \`${run.branch}\``,
				);
				item.contextValue = run.inProgress ? 'runActive' : 'run';
				return item;
			}
			case 'job': {
				const item = new vscode.TreeItem(
					node.job.name,
					node.job.steps.length ? Collapsed : vscode.TreeItemCollapsibleState.None,
				);
				item.iconPath = stateIcon(node.job.state);
				item.contextValue = 'job';
				return item;
			}
			case 'step': {
				const item = new vscode.TreeItem(node.name);
				item.iconPath = stateIcon(node.state);
				item.contextValue = 'step';
				return item;
			}
			case 'environmentsGroup': {
				const item = new vscode.TreeItem('Environments', Collapsed);
				item.iconPath = new vscode.ThemeIcon('server-environment');
				item.contextValue = 'environmentsGroup';
				return item;
			}
			case 'environment': {
				const item = new vscode.TreeItem(node.name, Collapsed);
				item.iconPath = new vscode.ThemeIcon('server-environment');
				item.contextValue = 'environment';
				return item;
			}
			case 'settingsCategory': {
				const isSecrets = node.category === 'secrets';
				const item = new vscode.TreeItem(isSecrets ? 'Secrets' : 'Variables', Collapsed);
				item.iconPath = new vscode.ThemeIcon(isSecrets ? 'lock' : 'symbol-text');
				item.contextValue = 'settingsCategory';
				return item;
			}
			case 'secretsGroup':
			case 'variablesGroup': {
				const item = new vscode.TreeItem(node.label, Collapsed);
				item.contextValue = node.kind;
				return item;
			}
			case 'secret': {
				const item = new vscode.TreeItem(node.secret.name);
				item.iconPath = new vscode.ThemeIcon('key');
				item.tooltip = `Updated ${node.secret.updatedAt}`;
				item.contextValue = 'secret';
				return item;
			}
			case 'variable': {
				const item = new vscode.TreeItem(node.variable.name);
				item.description = node.variable.value;
				item.iconPath = new vscode.ThemeIcon('symbol-text');
				item.tooltip = `${node.variable.name} = ${node.variable.value}`;
				item.contextValue = 'variable';
				return item;
			}
			case 'message': {
				const item = new vscode.TreeItem(node.text);
				item.contextValue = 'message';
				return item;
			}
		}
	}

	async getChildren(node?: Node): Promise<Node[]> {
		if (!node) {
			const state = await readRepoState();
			return state.ref
				? [
						new SectionNode('currentBranch'),
						new SectionNode('workflows'),
						new SectionNode('settings'),
					]
				: [];
		}

		switch (node.kind) {
			case 'section':
				return this.sectionChildren(node.section);
			case 'workflow':
				return this.runsForWorkflow(node.workflow.id);
			case 'run':
				return this.jobsForRun(node.run.id);
			case 'job':
				return node.job.steps.map((s) => new StepNode(s.name, s.state));
			case 'environmentsGroup':
				return this.environments();
			case 'environment':
				return [
					new GroupNode('secretsGroup', { kind: 'environment', name: node.name }, 'Secrets'),
					new GroupNode('variablesGroup', { kind: 'environment', name: node.name }, 'Variables'),
				];
			case 'settingsCategory':
				return node.category === 'secrets'
					? [new GroupNode('secretsGroup', { kind: 'repo' }, 'Repository Secrets')]
					: [new GroupNode('variablesGroup', { kind: 'repo' }, 'Repository Variables')];
			case 'secretsGroup':
				return this.secrets(node.scope);
			case 'variablesGroup':
				return this.variables(node.scope);
			default:
				return [];
		}
	}

	private async sectionChildren(section: Section): Promise<Node[]> {
		if (section === 'settings') {
			return [
				new EnvironmentsNode(),
				new SettingsCategoryNode('secrets'),
				new SettingsCategoryNode('variables'),
			];
		}

		const resolved = await this.resolve();
		if (!resolved) {
			return [];
		}
		const { octokit, ref, root } = resolved;

		if (section === 'currentBranch') {
			const branch = await currentBranch(root);
			if (!branch) {
				return [new MessageNode('No branch checked out')];
			}
			const runs = await listRuns(octokit, ref, { branch });
			return runs.length
				? runs.map((r) => new RunNode(r))
				: [new MessageNode(`No runs on ${branch}`)];
		}

		// Workflows section.
		const workflows = await listWorkflows(octokit, ref);
		return workflows.length
			? workflows.map((w) => new WorkflowNode(w))
			: [new MessageNode('No workflows defined')];
	}

	private async runsForWorkflow(workflowId: number): Promise<Node[]> {
		const resolved = await this.resolve();
		if (!resolved) {
			return [];
		}
		const runs = await listRunsForWorkflow(resolved.octokit, resolved.ref, workflowId);
		return runs.length ? runs.map((r) => new RunNode(r)) : [new MessageNode('No runs yet')];
	}

	private async jobsForRun(runId: number): Promise<Node[]> {
		const resolved = await this.resolve();
		if (!resolved) {
			return [];
		}
		const jobs = await listJobs(resolved.octokit, resolved.ref, runId);
		return jobs.length ? jobs.map((j) => new JobNode(j)) : [new MessageNode('No jobs')];
	}

	private async environments(): Promise<Node[]> {
		const resolved = await this.resolve();
		if (!resolved) {
			return [];
		}
		const names = await listEnvironments(resolved.octokit, resolved.ref);
		return names.length
			? names.map((n) => new EnvironmentNode(n))
			: [new MessageNode('No environments defined')];
	}

	private async secrets(scope: Scope): Promise<Node[]> {
		const resolved = await this.resolve();
		if (!resolved) {
			return [];
		}
		const secrets = await listSecrets(resolved.octokit, resolved.ref, scope);
		return secrets.length
			? secrets.map((s) => new SecretNode(s, scope))
			: [new MessageNode('No secrets defined')];
	}

	private async variables(scope: Scope): Promise<Node[]> {
		const resolved = await this.resolve();
		if (!resolved) {
			return [];
		}
		const variables = await listVariables(resolved.octokit, resolved.ref, scope);
		return variables.length
			? variables.map((v) => new VariableNode(v, scope))
			: [new MessageNode('No variables defined')];
	}
}
