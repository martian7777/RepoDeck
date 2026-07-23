import { useEffect, useRef, useState } from 'preact/hooks';

/**
 * Action buttons that spin until the extension host says the work is done.
 *
 * A click posts an intent and then waits on a network round trip — usually two, the mutation
 * and the refetch behind it — with nothing on screen to show for it. So every tracked message
 * carries an `opId` the host echoes back in a `done` message, and the button that started it
 * stays disabled and spinning until that arrives.
 */

interface VsCode {
	postMessage(msg: unknown): void;
}

export interface Ops {
	/** Posts a message and tracks it under `key` until the host acknowledges it. */
	run(key: string, msg: Record<string, unknown>): Promise<boolean>;
	/** Posts and forgets — for copy, open and quote, which settle on the spot. */
	post(msg: Record<string, unknown>): void;
	busy(key: string): boolean;
}

export function useOps(vscode: VsCode, onStart?: () => void): Ops {
	const [pending, setPending] = useState<Record<string, boolean>>({});

	// Keyed by opId: the key to clear, and the promise to settle. Refs, not state, because a
	// resolver captured in a stale render would never fire.
	const waiting = useRef(new Map<number, { key: string; resolve: (ok: boolean) => void }>());
	const nextId = useRef(0);

	useEffect(() => {
		const onMessage = (e: MessageEvent) => {
			const msg = e.data;
			if (msg?.type !== 'done' || typeof msg.opId !== 'number') {
				return;
			}
			const op = waiting.current.get(msg.opId);
			if (!op) {
				return;
			}
			waiting.current.delete(msg.opId);
			// The key stays busy while any other in-flight op still claims it.
			const stillBusy = [...waiting.current.values()].some((o) => o.key === op.key);
			if (!stillBusy) {
				setPending((p) => {
					const next = { ...p };
					delete next[op.key];
					return next;
				});
			}
			op.resolve(msg.ok !== false);
		};
		window.addEventListener('message', onMessage);
		return () => window.removeEventListener('message', onMessage);
	}, []);

	return {
		run(key, msg) {
			onStart?.();
			const opId = nextId.current++;
			setPending((p) => ({ ...p, [key]: true }));
			return new Promise<boolean>((resolve) => {
				waiting.current.set(opId, { key, resolve });
				vscode.postMessage({ ...msg, opId });
			});
		},
		post(msg) {
			onStart?.();
			vscode.postMessage(msg);
		},
		busy: (key) => Boolean(pending[key]),
	};
}

/** An action button that spins and renames itself while its operation is in flight. */
export function ActionButton(props: {
	busy: boolean;
	label: string;
	/** Present-participle label shown while busy — "Merging…", "Commenting…". */
	busyLabel: string;
	class?: string;
	disabled?: boolean;
	title?: string;
	onClick: () => void;
}) {
	return (
		<button
			class={props.busy ? `busy${props.class ? ` ${props.class}` : ''}` : props.class}
			disabled={props.disabled || props.busy}
			title={props.title}
			onClick={props.onClick}
		>
			{props.busy && <span class="spinner" />}
			{props.busy ? props.busyLabel : props.label}
		</button>
	);
}
