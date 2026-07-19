import type { Octokit } from '@octokit/rest';
import _sodium from 'libsodium-wrappers';
import { git, type RepoRef } from './repoContext';

/**
 * A workflow run's overall outcome, collapsed from GitHub's `status` + `conclusion` pair
 * into the single dimension the tree actually renders an icon for. `in_progress` covers
 * everything still running (queued, in_progress, waiting, requested).
 */
export type RunState = 'success' | 'failure' | 'cancelled' | 'skipped' | 'in_progress';

export interface WorkflowSummary {
	id: number;
	name: string;
	/** The workflow file path, e.g. `.github/workflows/ci.yml`. */
	path: string;
	state: string;
	url: string;
}

export interface RunSummary {
	id: number;
	/** The run's display name, e.g. the workflow name or the commit title. */
	name: string;
	/** GitHub's per-workflow run counter, shown as `#13`. */
	runNumber: number;
	state: RunState;
	branch: string;
	event: string;
	url: string;
	createdAt: string;
	/** True while the run can still be cancelled. */
	inProgress: boolean;
}

export interface StepSummary {
	name: string;
	number: number;
	state: RunState;
}

export interface JobSummary {
	id: number;
	name: string;
	state: RunState;
	url: string;
	steps: StepSummary[];
}

export interface SecretSummary {
	name: string;
	updatedAt: string;
}

export interface VariableSummary {
	name: string;
	value: string;
	updatedAt: string;
}

/** Where a secret or variable lives: the repository, or a named environment. */
export type Scope = { kind: 'repo' } | { kind: 'environment'; name: string };

/** Collapses GitHub's `status`/`conclusion` pair into one displayable state. */
function toRunState(status: string | null, conclusion: string | null): RunState {
	if (status !== 'completed') {
		return 'in_progress';
	}
	switch (conclusion) {
		case 'success':
			return 'success';
		case 'cancelled':
			return 'cancelled';
		case 'skipped':
		case 'neutral':
			return 'skipped';
		default:
			// failure, timed_out, action_required, stale, startup_failure, null.
			return 'failure';
	}
}

// ---- Workflows, runs, jobs ----

export async function listWorkflows(octokit: Octokit, ref: RepoRef): Promise<WorkflowSummary[]> {
	const { data } = await octokit.rest.actions.listRepoWorkflows({ ...ref, per_page: 100 });
	return data.workflows.map((w) => ({
		id: w.id,
		name: w.name,
		path: w.path,
		state: w.state,
		url: w.html_url,
	}));
}

function mapRun(r: {
	id: number;
	name?: string | null;
	display_title?: string;
	run_number: number;
	status: string | null;
	conclusion: string | null;
	head_branch: string | null;
	event: string;
	html_url: string;
	created_at: string;
}): RunSummary {
	const state = toRunState(r.status, r.conclusion);
	return {
		id: r.id,
		name: r.name || r.display_title || `Run ${r.run_number}`,
		runNumber: r.run_number,
		state,
		branch: r.head_branch ?? '',
		event: r.event,
		url: r.html_url,
		createdAt: r.created_at,
		inProgress: state === 'in_progress',
	};
}

/** Recent runs across all workflows, optionally filtered to one branch. */
export async function listRuns(
	octokit: Octokit,
	ref: RepoRef,
	opts: { branch?: string; perPage?: number } = {},
): Promise<RunSummary[]> {
	const { data } = await octokit.rest.actions.listWorkflowRunsForRepo({
		...ref,
		...(opts.branch ? { branch: opts.branch } : {}),
		per_page: opts.perPage ?? 20,
	});
	return data.workflow_runs.map(mapRun);
}

/** Recent runs of a single workflow. */
export async function listRunsForWorkflow(
	octokit: Octokit,
	ref: RepoRef,
	workflowId: number,
	perPage = 20,
): Promise<RunSummary[]> {
	const { data } = await octokit.rest.actions.listWorkflowRuns({
		...ref,
		workflow_id: workflowId,
		per_page: perPage,
	});
	return data.workflow_runs.map(mapRun);
}

/** Jobs (with their steps) for a run — steps come embedded, so this is one call. */
export async function listJobs(
	octokit: Octokit,
	ref: RepoRef,
	runId: number,
): Promise<JobSummary[]> {
	const { data } = await octokit.rest.actions.listJobsForWorkflowRun({
		...ref,
		run_id: runId,
		per_page: 100,
	});
	return data.jobs.map((j) => ({
		id: j.id,
		name: j.name,
		state: toRunState(j.status, j.conclusion),
		url: j.html_url ?? '',
		steps: (j.steps ?? []).map((s) => ({
			name: s.name,
			number: s.number,
			state: toRunState(s.status, s.conclusion ?? null),
		})),
	}));
}

export async function rerunRun(octokit: Octokit, ref: RepoRef, runId: number): Promise<void> {
	await octokit.rest.actions.reRunWorkflow({ ...ref, run_id: runId });
}

export async function cancelRun(octokit: Octokit, ref: RepoRef, runId: number): Promise<void> {
	await octokit.rest.actions.cancelWorkflowRun({ ...ref, run_id: runId });
}

// ---- Environments ----

export async function listEnvironments(octokit: Octokit, ref: RepoRef): Promise<string[]> {
	const { data } = await octokit.rest.repos.getAllEnvironments({ ...ref });
	return (data.environments ?? []).map((e) => e.name);
}

// ---- Secrets ----

export async function listSecrets(
	octokit: Octokit,
	ref: RepoRef,
	scope: Scope,
): Promise<SecretSummary[]> {
	const data =
		scope.kind === 'repo'
			? (await octokit.rest.actions.listRepoSecrets({ ...ref, per_page: 100 })).data
			: (
					await octokit.rest.actions.listEnvironmentSecrets({
						...ref,
						environment_name: scope.name,
						per_page: 100,
					})
				).data;
	return data.secrets.map((s) => ({ name: s.name, updatedAt: s.updated_at }));
}

/**
 * Creates or updates a secret. GitHub only accepts values sealed against the target's
 * public key, so we fetch that key, encrypt with libsodium, and upload the ciphertext —
 * the value never traverses our own storage in the clear.
 */
export async function upsertSecret(
	octokit: Octokit,
	ref: RepoRef,
	scope: Scope,
	name: string,
	value: string,
): Promise<void> {
	if (scope.kind === 'repo') {
		const { data: key } = await octokit.rest.actions.getRepoPublicKey({ ...ref });
		await octokit.rest.actions.createOrUpdateRepoSecret({
			...ref,
			secret_name: name,
			encrypted_value: await encryptSecret(key.key, value),
			key_id: key.key_id,
		});
	} else {
		const { data: key } = await octokit.rest.actions.getEnvironmentPublicKey({
			...ref,
			environment_name: scope.name,
		});
		await octokit.rest.actions.createOrUpdateEnvironmentSecret({
			...ref,
			environment_name: scope.name,
			secret_name: name,
			encrypted_value: await encryptSecret(key.key, value),
			key_id: key.key_id,
		});
	}
}

export async function deleteSecret(
	octokit: Octokit,
	ref: RepoRef,
	scope: Scope,
	name: string,
): Promise<void> {
	if (scope.kind === 'repo') {
		await octokit.rest.actions.deleteRepoSecret({ ...ref, secret_name: name });
	} else {
		await octokit.rest.actions.deleteEnvironmentSecret({
			...ref,
			environment_name: scope.name,
			secret_name: name,
		});
	}
}

// ---- Variables ----

export async function listVariables(
	octokit: Octokit,
	ref: RepoRef,
	scope: Scope,
): Promise<VariableSummary[]> {
	const data =
		scope.kind === 'repo'
			? (await octokit.rest.actions.listRepoVariables({ ...ref, per_page: 100 })).data
			: (
					await octokit.rest.actions.listEnvironmentVariables({
						...ref,
						environment_name: scope.name,
						per_page: 100,
					})
				).data;
	return data.variables.map((v) => ({ name: v.name, value: v.value, updatedAt: v.updated_at }));
}

export async function createVariable(
	octokit: Octokit,
	ref: RepoRef,
	scope: Scope,
	name: string,
	value: string,
): Promise<void> {
	if (scope.kind === 'repo') {
		await octokit.rest.actions.createRepoVariable({ ...ref, name, value });
	} else {
		await octokit.rest.actions.createEnvironmentVariable({
			...ref,
			environment_name: scope.name,
			name,
			value,
		});
	}
}

export async function updateVariable(
	octokit: Octokit,
	ref: RepoRef,
	scope: Scope,
	name: string,
	value: string,
): Promise<void> {
	if (scope.kind === 'repo') {
		await octokit.rest.actions.updateRepoVariable({ ...ref, name, value });
	} else {
		await octokit.rest.actions.updateEnvironmentVariable({
			...ref,
			environment_name: scope.name,
			name,
			value,
		});
	}
}

export async function deleteVariable(
	octokit: Octokit,
	ref: RepoRef,
	scope: Scope,
	name: string,
): Promise<void> {
	if (scope.kind === 'repo') {
		await octokit.rest.actions.deleteRepoVariable({ ...ref, name });
	} else {
		await octokit.rest.actions.deleteEnvironmentVariable({
			...ref,
			environment_name: scope.name,
			name,
		});
	}
}

// ---- Helpers ----

/** Sealed-box encrypts `value` against a base64 `publicKey`, per GitHub's secret API. */
async function encryptSecret(publicKey: string, value: string): Promise<string> {
	await _sodium.ready;
	const sodium = _sodium;
	const binKey = sodium.from_base64(publicKey, sodium.base64_variants.ORIGINAL);
	const binValue = sodium.from_string(value);
	const sealed = sodium.crypto_box_seal(binValue, binKey);
	return sodium.to_base64(sealed, sodium.base64_variants.ORIGINAL);
}

/** The checked-out branch, used to scope the "Current Branch" section. */
export async function currentBranch(root: string): Promise<string | undefined> {
	const branch = await git(root, 'branch', '--show-current');
	return branch && branch.length > 0 ? branch : undefined;
}
