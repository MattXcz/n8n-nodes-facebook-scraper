import { FacebookScraperError } from './errors';

export type ParsedReelUrl =
	| { kind: 'reel'; id: string; url: string }
	| { kind: 'share'; url: string }
	| { kind: 'watch'; id: string; url: string };

const FB_HOST = /^(?:www\.|m\.|web\.|mbasic\.)?facebook\.com$|^fb\.watch$/i;

/**
 * Classifies a user-supplied Facebook URL.
 *  - facebook.com/reel/<id>            -> reel (id known, no network needed)
 *  - facebook.com/share/r/<code>/      -> share (must follow redirect)
 *  - facebook.com/share/v/<code>/      -> share
 *  - fb.watch/<code>                   -> share
 *  - facebook.com/watch/?v=<id>, /<page>/videos/<id> -> watch (treated as reel id)
 */
export function parseReelUrl(input: string): ParsedReelUrl {
	if (!input || typeof input !== 'string') {
		throw new FacebookScraperError('INVALID_URL', 'URL is empty.');
	}
	let u: URL;
	try {
		const trimmed = input.trim();
		u = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
	} catch {
		throw new FacebookScraperError('INVALID_URL', `Not a valid URL: "${input}".`);
	}
	if (!FB_HOST.test(u.hostname)) {
		throw new FacebookScraperError('INVALID_URL', `Not a Facebook URL: "${u.hostname}".`);
	}
	if (/^fb\.watch$/i.test(u.hostname)) {
		return { kind: 'share', url: u.toString() };
	}
	const path = u.pathname;
	let m = path.match(/^\/reels?\/(\d{6,})/i);
	if (m) return { kind: 'reel', id: m[1], url: canonicalReelUrl(m[1]) };
	if (/^\/share\/(?:r|v)\/[A-Za-z0-9_-]+/i.test(path)) {
		return { kind: 'share', url: `https://www.facebook.com${path}` };
	}
	m = path.match(/\/videos\/(?:[^/]+\/)?(\d{6,})/i);
	if (m) return { kind: 'watch', id: m[1], url: canonicalReelUrl(m[1]) };
	const v = u.searchParams.get('v');
	if (/^\/watch\/?$/i.test(path) && v && /^\d{6,}$/.test(v)) {
		return { kind: 'watch', id: v, url: canonicalReelUrl(v) };
	}
	throw new FacebookScraperError(
		'INVALID_URL',
		`Unsupported Facebook URL "${input}". Expected /reel/<id> or /share/r/<code>/.`,
	);
}

export type ParsedPostUrl =
	| { kind: 'post'; postId: string; url: string; groupSlug: string | null }
	| { kind: 'share'; url: string };

/**
 * Classifies a Facebook post URL. `postId` is numeric or a `pfbid…` token.
 *  - /groups/<g>/posts/<id>/, /groups/<g>/permalink/<id>/
 *  - /<page>/posts/<id|pfbid>/
 *  - /permalink.php?story_fbid=<id|pfbid>&id=<owner>, /story.php?story_fbid=…
 *  - /groups/<g>/?multi_permalinks=<id>
 *  - /share/p/<code>/ (redirect is followed)
 */
export function parsePostUrl(input: string): ParsedPostUrl {
	if (!input || typeof input !== 'string') throw new FacebookScraperError('INVALID_URL', 'URL is empty.');
	let u: URL;
	try {
		const t = input.trim();
		u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`);
	} catch {
		throw new FacebookScraperError('INVALID_URL', `Not a valid URL: "${input}".`);
	}
	if (!FB_HOST.test(u.hostname) || /^fb\.watch$/i.test(u.hostname)) {
		throw new FacebookScraperError('INVALID_URL', `Not a Facebook post URL: "${u.hostname}".`);
	}
	const path = u.pathname;
	const ID = '(\\d{6,}|pfbid[A-Za-z0-9]+)';
	if (/^\/share\/p\/[A-Za-z0-9_-]+/i.test(path)) return { kind: 'share', url: `https://www.facebook.com${path}` };
	let m = path.match(new RegExp(`^/groups/([^/]+)/(posts|permalink)/${ID}`, 'i'));
	if (m) return { kind: 'post', postId: m[3], groupSlug: m[1], url: `https://www.facebook.com/groups/${m[1]}/${m[2].toLowerCase()}/${m[3]}/` };
	const mp = u.searchParams.get('multi_permalinks');
	m = path.match(/^\/groups\/([^/]+)\/?$/i);
	if (m && mp && /^\d{6,}$/.test(mp.split(',')[0])) {
		const id = mp.split(',')[0];
		return { kind: 'post', postId: id, groupSlug: m[1], url: `https://www.facebook.com/groups/${m[1]}/posts/${id}/` };
	}
	if (/^\/(?:permalink|story)\.php$/i.test(path)) {
		const sid = u.searchParams.get('story_fbid');
		const owner = u.searchParams.get('id');
		if (sid && new RegExp(`^${ID}$`).test(sid)) {
			const q = owner ? `&id=${encodeURIComponent(owner)}` : '';
			return { kind: 'post', postId: sid, groupSlug: null, url: `https://www.facebook.com/permalink.php?story_fbid=${sid}${q}` };
		}
	}
	m = path.match(new RegExp(`^/([^/]+)/posts/(?:[^/]+/)?${ID}`, 'i'));
	if (m) return { kind: 'post', postId: m[2], groupSlug: null, url: `https://www.facebook.com/${m[1]}/posts/${m[2]}/` };
	throw new FacebookScraperError(
		'INVALID_URL',
		`Unsupported Facebook post URL "${input}". Expected /groups/<group>/posts/<id>/, /<page>/posts/<id>/, permalink.php?story_fbid=… or /share/p/<code>/.`,
	);
}

export function postIdFromUrl(url: string): string | null {
	try {
		const p = parsePostUrl(url);
		return p.kind === 'post' ? p.postId : null;
	} catch {
		return null;
	}
}

export function canonicalReelUrl(id: string): string {
	return `https://www.facebook.com/reel/${id}`;
}

/** Extracts a reel id from a URL Facebook redirected us to, or null. */
export function reelIdFromUrl(url: string): string | null {
	try {
		const p = parseReelUrl(url);
		return p.kind === 'share' ? null : p.id;
	} catch {
		return null;
	}
}

const NAMED: Record<string, string> = {
	amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#039': "'",
};

/** Decodes named, decimal and hex HTML entities (Facebook uses &#x10d; etc. heavily). */
export function decodeHtmlEntities(text: string): string {
	return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#039);/gi, (all, ent: string) => {
		if (ent[0] === '#') {
			const cp = ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
			return Number.isFinite(cp) && cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : all;
		}
		const v = NAMED[ent.toLowerCase()];
		return v ?? all;
	});
}

/**
 * Parses localized compact counts as Facebook prints them in og:title,
 * e.g. "22 tis.", "1,4 tis.", "3,2 mil.", "12K", "1.2M", "845".
 * Returns null when the text isn't a number.
 */
export function parseCompactNumber(raw: string | null | undefined): number | null {
	if (raw === null || raw === undefined) return null;
	const s = String(raw).replace(/[  ]/g, ' ').trim().toLowerCase();
	const m = s.match(/^(\d{1,3}(?:[ .,]\d{3})+|\d+(?:[.,]\d+)?)\s*(k|m|b|tis\.?|mil\.?|mld\.?|tys\.?|mln\.?|tsd\.?|mio\.?)?$/i);
	if (!m) return null;
	let numStr = m[1];
	const suffix = (m[2] || '').replace('.', '');
	if (/^\d{1,3}(?:[ .,]\d{3})+$/.test(numStr) && !suffix) {
		numStr = numStr.replace(/[ .,]/g, '');
	} else {
		numStr = numStr.replace(/ /g, '').replace(',', '.');
	}
	const value = parseFloat(numStr);
	if (!Number.isFinite(value)) return null;
	const mult: Record<string, number> = {
		'': 1, k: 1e3, tis: 1e3, tys: 1e3, tsd: 1e3, m: 1e6, mil: 1e6, mln: 1e6, mio: 1e6, b: 1e9, mld: 1e9,
	};
	return Math.round(value * (mult[suffix] ?? 1));
}

/** Converts a fbcdn `oe` (hex unix seconds) parameter into an ISO date, or null. */
export function cdnUrlExpiry(url: string | null | undefined): string | null {
	if (!url) return null;
	const m = url.match(/[?&]oe=([0-9A-Fa-f]{8})\b/);
	if (!m) return null;
	const secs = parseInt(m[1], 16);
	return Number.isFinite(secs) ? new Date(secs * 1000).toISOString() : null;
}

export function unixToIso(ts: unknown): string | null {
	const n = typeof ts === 'string' ? Number(ts) : ts;
	if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return null;
	return new Date(n * 1000).toISOString();
}

/** First non-empty line of the caption, trimmed to a sensible title length. */
export function titleFromCaption(caption: string | null, max = 120): string | null {
	if (!caption) return null;
	const first = caption.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0);
	if (!first) return null;
	const chars = Array.from(first); // keep emoji / surrogate pairs intact
	return chars.length > max ? chars.slice(0, max - 1).join('').trimEnd() + '…' : first;
}

/** Extracts a vanity username from a profile URL, ignoring profile.php?id=. */
export function usernameFromProfileUrl(url: string | null | undefined): string | null {
	if (!url) return null;
	try {
		const u = new URL(url);
		if (/profile\.php$/i.test(u.pathname)) return null;
		const seg = u.pathname.split('/').filter(Boolean)[0];
		return seg && !/^(people|pages|groups|watch|reel)$/i.test(seg) ? seg : null;
	} catch {
		return null;
	}
}

export async function delay(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

export async function randomDelay(min: number, max: number): Promise<void> {
	if (max <= 0) return;
	await delay(Math.floor(Math.random() * (max - min + 1)) + min);
}

export function errorMessage(e: unknown): string {
	if (e instanceof Error) return e.message;
	return typeof e === 'string' ? e : 'Unknown error';
}
