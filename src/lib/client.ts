import { fetch as undiciFetch, ProxyAgent, type Dispatcher } from 'undici';
import { FacebookScraperError, isFacebookError } from './errors';
import { FacebookSession, redactSecrets } from './session';
import { detectPageSignals, parseReelPage } from './parser';
import { parsePostPage } from './postParser';
import { IFacebookCredentials, IFetchResult, IPostSummary, IReelSummary } from './types';
import { canonicalReelUrl, delay, errorMessage, parsePostUrl, parseReelUrl, postIdFromUrl, reelIdFromUrl } from './utils';

export interface ClientOptions {
	/** When true, cookies are never sent even if present in the credential. */
	anonymous?: boolean;
	videoPreference?: 'progressive' | 'highest';
	timeoutMs?: number;
	maxRetries?: number;
	/** Injected in tests. */
	fetchImpl?: typeof undiciFetch;
}

const DEFAULT_UA =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

/**
 * Thin HTTP client for www.facebook.com. Fetches a Reel page exactly like a
 * top-level browser navigation (Sec-Fetch-Mode: navigate). This matters:
 * verified in a real browser, the same URL requested as an XHR/fetch
 * (Sec-Fetch-Mode: cors) returns a shell WITHOUT the Relay Reel data, while a
 * navigation returns the full data.
 */
export class FacebookClient {
	private readonly session: FacebookSession;
	private readonly creds: IFacebookCredentials;
	private readonly opts: Required<Omit<ClientOptions, 'fetchImpl'>> & { fetchImpl: typeof undiciFetch };
	private dispatcher?: Dispatcher;

	constructor(creds: IFacebookCredentials = {}, opts: ClientOptions = {}) {
		this.creds = creds;
		this.opts = {
			anonymous: opts.anonymous ?? false,
			videoPreference: opts.videoPreference ?? 'progressive',
			timeoutMs: opts.timeoutMs ?? 30000,
			maxRetries: opts.maxRetries ?? 2,
			fetchImpl: opts.fetchImpl ?? undiciFetch,
		};
		this.session = new FacebookSession(this.opts.anonymous ? null : creds.cookies);
		if (!this.opts.anonymous && creds.cookies && creds.cookies.trim() && !this.session.isLoggedIn) {
			throw new FacebookScraperError(
				'SESSION_EXPIRED',
				`Cookies are missing ${this.session.missingRequired().join(', ')}. Both c_user and xs are required for a logged-in session.`,
			);
		}
		if (creds.proxyUrl) this.dispatcher = new ProxyAgent(creds.proxyUrl);
	}

	get authenticated(): boolean {
		return !this.opts.anonymous && this.session.isLoggedIn;
	}

	describeSession() {
		return { ...this.session.describe(), anonymous: this.opts.anonymous };
	}

	private headers(): Record<string, string> {
		const h: Record<string, string> = {
			'user-agent': this.creds.userAgent?.trim() || DEFAULT_UA,
			accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
			'accept-language': this.creds.acceptLanguage?.trim() || 'cs-CZ,cs;q=0.9,en;q=0.8',
			'cache-control': 'no-cache',
			pragma: 'no-cache',
			'sec-ch-ua': '"Chromium";v="140", "Not=A?Brand";v="24", "Google Chrome";v="140"',
			'sec-ch-ua-mobile': '?0',
			'sec-ch-ua-platform': '"macOS"',
			'sec-fetch-dest': 'document',
			'sec-fetch-mode': 'navigate',
			'sec-fetch-site': 'none',
			'sec-fetch-user': '?1',
			'upgrade-insecure-requests': '1',
		};
		if (this.authenticated) h.cookie = this.session.header();
		return h;
	}

	/** GET with manual redirect handling so we can see every hop (login/checkpoint detection, share resolution). */
	async fetchPage(url: string): Promise<IFetchResult> {
		const redirects: string[] = [];
		let current = url;
		for (let hop = 0; hop < 8; hop++) {
			let res;
			try {
				res = await this.opts.fetchImpl(current, {
					method: 'GET',
					headers: this.headers(),
					redirect: 'manual',
					dispatcher: this.dispatcher,
					signal: AbortSignal.timeout(this.opts.timeoutMs),
				} as any);
			} catch (e) {
				const cause = (e as { cause?: { message?: string } })?.cause?.message;
				throw new FacebookScraperError('NETWORK_ERROR', redactSecrets(`${errorMessage(e)}${cause ? ` (${cause})` : ''}`, this.session));
			}
			const setCookie = typeof (res.headers as any).getSetCookie === 'function' ? (res.headers as any).getSetCookie() : [];
			const removed = this.authenticated ? this.session.absorbSetCookie(setCookie) : [];
			if (removed.includes('xs') || removed.includes('c_user')) {
				throw new FacebookScraperError('SESSION_EXPIRED', 'Facebook invalidated the session cookies (xs/c_user deleted).');
			}
			if (res.status >= 300 && res.status < 400) {
				const loc = res.headers.get('location');
				if (!loc) break;
				const next = new URL(loc, current).toString();
				redirects.push(next);
				this.classifyRedirect(next);
				current = next;
				continue;
			}
			const html = await res.text();
			return { finalUrl: current, status: res.status, html, redirects };
		}
		throw new FacebookScraperError('HTTP_ERROR', `Too many redirects for ${url}.`);
	}

	private classifyRedirect(next: string): void {
		const p = next.toLowerCase();
		if (/\/checkpoint\//.test(p)) throw new FacebookScraperError('VERIFICATION_REQUIRED');
		if (/\/login(?:\.php|\/|\?|$)/.test(p) || /\/login\/\?next=/.test(p)) {
			throw new FacebookScraperError(this.authenticated ? 'SESSION_EXPIRED' : 'LOGIN_REQUIRED');
		}
	}

	/** Resolves facebook.com/share/r/... (and fb.watch) to a numeric Reel id. */
	async resolveReelId(inputUrl: string): Promise<{ id: string; prefetched?: IFetchResult }> {
		const parsed = parseReelUrl(inputUrl);
		if (parsed.kind !== 'share') return { id: parsed.id };
		const page = await this.fetchPage(parsed.url);
		for (const r of [...page.redirects].reverse()) {
			const id = reelIdFromUrl(r);
			if (id) return { id, prefetched: reelIdFromUrl(page.finalUrl) === id ? page : undefined };
		}
		// No HTTP redirect: Facebook sometimes answers 200 with a canonical link / og:url.
		const canon =
			(page.html.match(/<link rel="canonical" href="([^"]+)"/i) || [])[1] ??
			(page.html.match(/<meta property="og:url" content="([^"]+)"/i) || [])[1];
		const id = canon ? reelIdFromUrl(canon.replace(/&amp;/g, '&')) : null;
		if (id) return { id, prefetched: page };
		this.throwForPage(page, null);
		throw new FacebookScraperError('CONTENT_UNAVAILABLE', `Share link ${inputUrl} did not resolve to a Reel.`);
	}

	private throwForPage(page: IFetchResult, reelId: string | null): void {
		const s = detectPageSignals(page.html, page.finalUrl);
		if (page.status === 429 || s.rateLimited) throw new FacebookScraperError('RATE_LIMITED', undefined, page.status);
		if (s.checkpoint) throw new FacebookScraperError('VERIFICATION_REQUIRED', undefined, page.status);
		if (s.loginWall) throw new FacebookScraperError(this.authenticated ? 'SESSION_EXPIRED' : 'LOGIN_REQUIRED', undefined, page.status);
		if (this.authenticated && !s.pageUserId && /"USER_ID":"0"/.test(page.html)) {
			throw new FacebookScraperError('SESSION_EXPIRED', 'Cookies were sent but Facebook served a logged-out page.');
		}
		if (page.status === 404 || page.status === 410 || s.unavailable) {
			throw new FacebookScraperError('CONTENT_UNAVAILABLE', reelId ? `Reel ${reelId} is not available.` : undefined, page.status);
		}
		if (page.status >= 500) throw new FacebookScraperError('HTTP_ERROR', `Facebook returned HTTP ${page.status}.`, page.status);
		if (page.status >= 400) throw new FacebookScraperError('HTTP_ERROR', `Facebook returned HTTP ${page.status}.`, page.status);
	}

	async getReelByUrl(inputUrl: string): Promise<IReelSummary> {
		return this.withRetry(async () => {
			const { id, prefetched } = await this.resolveReelId(inputUrl);
			const page = prefetched ?? (await this.fetchPage(canonicalReelUrl(id)));
			const landed = reelIdFromUrl(page.finalUrl);
			if (landed && landed !== id) {
				throw new FacebookScraperError('CONTENT_UNAVAILABLE', `Facebook redirected Reel ${id} to a different video (${landed}).`);
			}
			this.throwForPage(page, id);
			try {
				return parseReelPage(page.html, {
					reelId: id,
					inputUrl,
					authenticated: this.authenticated,
					videoPreference: this.opts.videoPreference,
				});
			} catch (e) {
				if (isFacebookError(e, 'PAGE_STRUCTURE_CHANGED') && !this.authenticated) {
					throw new FacebookScraperError('LOGIN_REQUIRED', `${e.message} Anonymous access returned no Reel data; add session cookies.`);
				}
				throw e;
			}
		});
	}

	/** Resolves facebook.com/share/p/... to a post URL + id. */
	async resolvePost(inputUrl: string): Promise<{ postId: string; url: string; prefetched?: IFetchResult }> {
		const parsed = parsePostUrl(inputUrl);
		if (parsed.kind === 'post') return { postId: parsed.postId, url: parsed.url };
		const page = await this.fetchPage(parsed.url);
		const candidates = [...page.redirects].reverse();
		const canon =
			(page.html.match(/<link rel="canonical" href="([^"]+)"/i) || [])[1] ??
			(page.html.match(/<meta property="og:url" content="([^"]+)"/i) || [])[1];
		if (canon) candidates.push(canon.replace(/&amp;/g, '&'));
		for (const c of candidates) {
			const id = postIdFromUrl(c);
			if (id) {
				const sameAsFinal = postIdFromUrl(page.finalUrl) === id;
				return { postId: id, url: (parsePostUrl(c) as { url: string }).url, prefetched: sameAsFinal || c === canon ? page : undefined };
			}
		}
		this.throwForPage(page, null);
		throw new FacebookScraperError('CONTENT_UNAVAILABLE', `Share link ${inputUrl} did not resolve to a post.`);
	}

	async getPostByUrl(inputUrl: string): Promise<IPostSummary> {
		return this.withRetry(async () => {
			const { postId, url, prefetched } = await this.resolvePost(inputUrl);
			const page = prefetched ?? (await this.fetchPage(url));
			this.throwForPage(page, null);
			try {
				return parsePostPage(page.html, {
					postId,
					inputUrl,
					authenticated: this.authenticated,
					videoPreference: this.opts.videoPreference,
				});
			} catch (e) {
				if (isFacebookError(e, 'PAGE_STRUCTURE_CHANGED') && !this.authenticated) {
					throw new FacebookScraperError('LOGIN_REQUIRED', `${e.message} Anonymous access returned no post data.`);
				}
				throw e;
			}
		});
	}

	/** Lightweight check used by the credential test: is this a logged-in session? */
	async verifySession(): Promise<{ ok: boolean; message: string }> {
		if (!this.session.isLoggedIn) return { ok: false, message: `Missing cookies: ${this.session.missingRequired().join(', ')}` };
		try {
			const page = await this.fetchPage('https://www.facebook.com/settings/');
			const s = detectPageSignals(page.html, page.finalUrl);
			if (s.checkpoint) return { ok: false, message: 'Account requires a security check (checkpoint).' };
			if (s.pageUserId && s.pageUserId === this.session.userId) return { ok: true, message: 'Session is valid.' };
			return { ok: false, message: 'Facebook did not accept the session (logged-out page returned).' };
		} catch (e) {
			return { ok: false, message: redactSecrets(errorMessage(e), this.session) };
		}
	}

	private async withRetry<T>(op: () => Promise<T>): Promise<T> {
		let attempt = 0;
		for (;;) {
			try {
				return await op();
			} catch (e) {
				const retryable =
					isFacebookError(e, 'NETWORK_ERROR') ||
					(isFacebookError(e, 'HTTP_ERROR') && (e.httpStatus ?? 0) >= 500) ||
					isFacebookError(e, 'RATE_LIMITED');
				if (!retryable || attempt >= this.opts.maxRetries) {
					if (e instanceof Error) e.message = redactSecrets(e.message, this.session);
					throw e;
				}
				const base = isFacebookError(e, 'RATE_LIMITED') ? 15000 : 1500;
				await delay(base * Math.pow(2, attempt) + Math.floor(Math.random() * 500));
				attempt++;
			}
		}
	}
}
