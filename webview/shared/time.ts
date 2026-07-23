const UNITS: [limit: number, seconds: number, name: string][] = [
	[60, 1, 'second'],
	[3600, 60, 'minute'],
	[86400, 3600, 'hour'],
	[2592000, 86400, 'day'],
	[31536000, 2592000, 'month'],
	[Infinity, 31536000, 'year'],
];

/** "3 hours ago", the way GitHub timestamps a comment. */
export function ago(iso: string): string {
	if (!iso) {
		return '';
	}
	const seconds = Math.round((Date.now() - Date.parse(iso)) / 1000);
	if (!Number.isFinite(seconds)) {
		return '';
	}
	if (seconds < 45) {
		return 'just now';
	}

	const abs = Math.abs(seconds);
	const [, per, name] = UNITS.find(([limit]) => abs < limit)!;
	const n = Math.round(abs / per);
	const phrase = `${n} ${name}${n === 1 ? '' : 's'}`;
	return seconds < 0 ? `in ${phrase}` : `${phrase} ago`;
}

/** The full timestamp, for the `title` tooltip behind the relative one. */
export function exact(iso: string): string {
	return iso ? new Date(iso).toLocaleString() : '';
}
