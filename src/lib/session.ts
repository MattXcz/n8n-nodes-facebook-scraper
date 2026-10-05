import { FacebookScraperError } from './errors';

/**
 * Facebook session = a set of browser cookies. The essential ones are
 * `c_user` (numeric account id) and `xs` (session secret); `datr`, `fr` and
 * `sb` make the session look like the same browser and reduce checkpoints.
 *
 * Why cookies and not username/password: Facebook's web login uses an
 * encrypted password payload, device fingerprinting and frequent 2FA /
 * checkpoint challenges. Automating it is fragile and is the fastest way to get
 * the account locked, so this node reuses a session the user created in a
 * real browser. `xs` typically stays valid for months unless the user logs out.
 */
export class FacebookSession {
	private jar = new Map<string, string>();

	static readonly REQUIRED = ['c_user', 'xs'];
	/** Cookies that never leave this module in logs/debug output. */
	static readonly SECRET = new Set(['xs', 'fr', 'datr', 'sb', 'c_user', 'presence', 'wd', 'dpr', 'ps_l', 'ps_n']);

	constructor(raw?: string | null) {
		if (raw && raw.trim()) {
			for (const [k, v] of FacebookSession.parseCookieInput(raw)) this.jar.set(k, v);
		}
	}

	/**
	 * Accepts:
	 *  - a Cookie header: "c_user=123; xs=abc%3A..; datr=..."
	 *  - a JSON export (EditThisCookie / Cookie-Editor): [{"name":"c_user","value":"123",...}, ...]
	 *  - a JSON object: {"c_user":"123","xs":"..."}
	 */
	static parseCookieInput(raw: string): Map<string, string> {
		const out = new Map<string, string>();
		const text = raw.trim();
		if (text.startsWith('[') || text.startsWith('{')) {
			let data: unknown;
			try {
				data = JSON.parse(text);
			} catch {
				throw new FacebookScraperError('SESSION_EXPIRED', 'Cookies field looks like JSON but cannot be parsed.');
			}
			if (Array.isArray(data)) {
				for (const c of data) {
					if (c && typeof c === 'object' && 'name' in c && 'value' in c) {
						const dom = String((c as { domain?: string }).domain ?? 'facebook.com');
						if (/facebook\.com$/i.test(dom.replace(/^\./, ''))) {
							out.set(String((c as { name: string }).name), String((c as { value: string }).value));
						}
					}
				}
			} else if (data && typeof data === 'object') {
				for (const [k, v] of Object.entries(data as Record<string, unknown>)) out.set(k, String(v));
			}
			return out;
		}
		for (const part of text.replace(/^cookie:\s*/i, '').split(/;\s*|\n+/)) {
			const idx = part.indexOf('=');
			if (idx <= 0) continue;
			const k = part.slice(0, idx).trim();
			const v = part.slice(idx + 1).trim();
			if (k) out.set(k, v);
		}
		return out;
	}

	get isLoggedIn(): boolean {
		return FacebookSession.REQUIRED.every((k) => !!this.jar.get(k));
	}

	get userId(): string | null {
		return this.jar.get('c_user') ?? null;
	}

	missingRequired(): string[] {
		return FacebookSession.REQUIRED.filter((k) => !this.jar.get(k));
	}

	header(): string {
		return [...this.jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
	}

	/**
	 * Merges Set-Cookie headers from a response (Facebook rotates `fr`,
	 * sometimes `xs`). `deleted` / expired cookies are removed, which is how
	 * an invalidated session shows up (xs=deleted).
	 * Returns names of cookies that were removed.
	 */
	absorbSetCookie(setCookie: string[] | undefined): string[] {
		const removed: string[] = [];
		for (const line of setCookie ?? []) {
			const [pair, ...attrs] = line.split(';');
			const idx = pair.indexOf('=');
			if (idx <= 0) continue;
			const name = pair.slice(0, idx).trim();
			const value = pair.slice(idx + 1).trim();
			const expired =
				value === 'deleted' ||
				value === '' ||
				attrs.some((a) => /^\s*max-age=\s*(0|-\d+)\s*$/i.test(a)) ||
				attrs.some((a) => {
					const m = a.match(/^\s*expires=(.+)$/i);
					return !!m && Date.parse(m[1]) < Date.now();
				});
			if (expired) {
				if (this.jar.delete(name)) removed.push(name);
			} else {
				this.jar.set(name, value);
			}
		}
		return removed;
	}

	/** Safe, log-friendly description: cookie names only, never values. */
	describe(): { cookieNames: string[]; loggedIn: boolean; userIdMasked: string | null } {
		const uid = this.userId;
		return {
			cookieNames: [...this.jar.keys()].sort(),
			loggedIn: this.isLoggedIn,
			userIdMasked: uid ? `${uid.slice(0, 3)}…${uid.slice(-2)}` : null,
		};
	}

	/** Prevent accidental leaks via console.log / JSON.stringify / util.inspect. */
	toJSON(): unknown {
		return this.describe();
	}
	[Symbol.for('nodejs.util.inspect.custom')](): string {
		return `FacebookSession(${JSON.stringify(this.describe())})`;
	}
}

/** Replaces any cookie-like secrets in arbitrary text (error messages, debug output). */
export function redactSecrets(text: string, session?: FacebookSession): string {
	let out = text.replace(/\b(c_user|xs|fr|datr|sb)=([^;\s"&]+)/gi, '$1=<redacted>');
	if (session) {
		for (const name of FacebookSession.SECRET) {
			const v = (session as unknown as { jar: Map<string, string> }).jar.get(name);
			if (v && v.length >= 6) out = out.split(v).join('<redacted>');
		}
	}
	return out;
}
