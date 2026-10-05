import { readFileSync } from 'fs';
import { join } from 'path';
import { FacebookClient } from '../src/lib/client';
import { FacebookReels } from '../src/nodes/FacebookReels/FacebookReels.node';

const fx = (n: string) => readFileSync(join(__dirname, 'fixtures', n), 'utf8');
const REEL = '1397612515779779';
const COOKIES = 'c_user=100000000000001; xs=12%3ASECRETXS%3A2; datr=DATR123456';

type Route = { status: number; body?: string; location?: string; setCookie?: string[] };

function mockFetch(routes: Record<string, Route>, seen: Array<{ url: string; headers: Record<string, string> }> = []) {
	return (async (url: string, init: { headers: Record<string, string> }) => {
		seen.push({ url, headers: init.headers });
		const key = Object.keys(routes).find((k) => url.startsWith(k));
		const r = key ? routes[key] : { status: 404, body: '' };
		const headers = new Headers();
		if (r.location) headers.set('location', r.location);
		(headers as any).getSetCookie = () => r.setCookie ?? [];
		return { status: r.status, headers, text: async () => r.body ?? '' } as any;
	}) as any;
}

describe('FacebookClient', () => {
	it('direct link: sends navigation headers + cookies and parses the page', async () => {
		const seen: any[] = [];
		const c = new FacebookClient({ cookies: COOKIES }, { fetchImpl: mockFetch({ [`https://www.facebook.com/reel/${REEL}`]: { status: 200, body: fx('reel-logged-in.html') } }, seen) });
		const r = await c.getReelByUrl(`https://www.facebook.com/reel/${REEL}/?s=abc`);
		expect(r.id).toBe(REEL);
		expect(r.authenticated).toBe(true);
		expect(seen[0].headers['sec-fetch-mode']).toBe('navigate');
		expect(seen[0].headers.cookie).toContain('xs=');
	});

	it('share link: follows redirect to /reel/<id>', async () => {
		const c = new FacebookClient({ cookies: COOKIES }, {
			fetchImpl: mockFetch({
				'https://www.facebook.com/share/r/1AbCdEf/': { status: 302, location: `https://www.facebook.com/reel/${REEL}/?mibextid=xyz` },
				[`https://www.facebook.com/reel/${REEL}`]: { status: 200, body: fx('reel-logged-in.html') },
			}),
		});
		const r = await c.getReelByUrl('https://www.facebook.com/share/r/1AbCdEf/');
		expect(r.id).toBe(REEL);
		expect(r.inputUrl).toBe('https://www.facebook.com/share/r/1AbCdEf/');
		expect(r.commentCount).toBe(12);
	});

	it('invalid session: redirect to login -> SESSION_EXPIRED, secrets not in message', async () => {
		const c = new FacebookClient({ cookies: COOKIES }, {
			maxRetries: 0,
			fetchImpl: mockFetch({ [`https://www.facebook.com/reel/${REEL}`]: { status: 302, location: 'https://www.facebook.com/login/?next=https%3A%2F%2Fwww.facebook.com%2Freel%2F1397612515779779' } }),
		});
		await expect(c.getReelByUrl(`https://www.facebook.com/reel/${REEL}`)).rejects.toThrow(/SESSION_EXPIRED/);
	});

	it('invalid session: logged-out page despite cookies -> SESSION_EXPIRED', async () => {
		const c = new FacebookClient({ cookies: COOKIES }, { maxRetries: 0, fetchImpl: mockFetch({ 'https://www.facebook.com/reel/': { status: 200, body: fx('logged-out-with-cookies.html') } }) });
		await expect(c.getReelByUrl(`https://www.facebook.com/reel/${REEL}`)).rejects.toThrow(/SESSION_EXPIRED/);
	});

	it('invalid session: xs deleted via Set-Cookie -> SESSION_EXPIRED', async () => {
		const c = new FacebookClient({ cookies: COOKIES }, { maxRetries: 0, fetchImpl: mockFetch({ 'https://www.facebook.com/reel/': { status: 200, body: fx('reel-logged-in.html'), setCookie: ['xs=deleted; expires=Thu, 01 Jan 1970 00:00:01 GMT'] } }) });
		await expect(c.getReelByUrl(`https://www.facebook.com/reel/${REEL}`)).rejects.toThrow(/SESSION_EXPIRED/);
	});

	it('incomplete cookies are rejected up front', () => {
		expect(() => new FacebookClient({ cookies: 'datr=1' })).toThrow(/c_user, xs/);
	});

	it('checkpoint, rate limit, unavailable, anonymous login wall', async () => {
		const mk = (route: Route, cookies: string | null = COOKIES) =>
			new FacebookClient({ cookies: cookies ?? undefined }, { anonymous: !cookies, maxRetries: 0, fetchImpl: mockFetch({ 'https://www.facebook.com/reel/': route }) });
		const u = `https://www.facebook.com/reel/${REEL}`;
		await expect(mk({ status: 302, location: 'https://www.facebook.com/checkpoint/1501092823525282/' }).getReelByUrl(u)).rejects.toThrow(/VERIFICATION_REQUIRED/);
		await expect(mk({ status: 429, body: '' }).getReelByUrl(u)).rejects.toThrow(/RATE_LIMITED/);
		await expect(mk({ status: 200, body: fx('rate-limited.html') }).getReelByUrl(u)).rejects.toThrow(/RATE_LIMITED/);
		await expect(mk({ status: 200, body: fx('content-unavailable.html') }).getReelByUrl(u)).rejects.toThrow(/CONTENT_UNAVAILABLE/);
		await expect(mk({ status: 302, location: 'https://www.facebook.com/login.php?next=x' }, null).getReelByUrl(u)).rejects.toThrow(/LOGIN_REQUIRED/);
	});

	it('anonymous mode never sends cookies', async () => {
		const seen: any[] = [];
		const c = new FacebookClient({ cookies: COOKIES }, { anonymous: true, fetchImpl: mockFetch({ 'https://www.facebook.com/reel/': { status: 200, body: fx('reel-anonymous.html') } }, seen) });
		const r = await c.getReelByUrl(`https://www.facebook.com/reel/${REEL}`);
		expect(seen[0].headers.cookie).toBeUndefined();
		expect(r.authenticated).toBe(false);
		expect(r.viewCount).toBe(22000);
	});
});

describe('n8n node: several items, one failing', () => {
	function ctx(urls: string[], onError: 'continueRegularOutput' | 'continueErrorOutput' | 'stopWorkflow') {
		return {
			getInputData: () => urls.map((u) => ({ json: { u } })),
			getNodeParameter: (name: string, i: number, fallback?: unknown) => {
				if (name === 'authentication') return 'session';
				if (name === 'url') return urls[i];
				if (name === 'options') return { delayBetweenItems: 0 };
				return fallback;
			},
			getCredentials: async () => ({ cookies: COOKIES }),
			getNode: () => ({ name: 'FB', type: 'facebookReels', typeVersion: 1, onError, parameters: {} }),
			continueOnFail: () => onError !== 'stopWorkflow',
			helpers: {
				returnJsonArray: (d: any) => [{ json: d }],
				constructExecutionMetaData: (d: any[], m: any) => d.map((x) => ({ ...x, pairedItem: m.itemData })),
			},
		} as any;
	}

	const realFetch = global.fetch;
	beforeAll(() => {
		// The node constructs its own client; route undici through the mock.
		jest.spyOn(require('undici'), 'fetch').mockImplementation(
			mockFetch({ [`https://www.facebook.com/reel/${REEL}`]: { status: 200, body: fx('reel-logged-in.html') } }) as any,
		);
	});
	afterAll(() => {
		jest.restoreAllMocks();
		global.fetch = realFetch;
	});

	const urls = [`https://www.facebook.com/reel/${REEL}`, 'https://www.facebook.com/not-a-reel', `https://www.facebook.com/reel/${REEL}`];

	it('continue (regular output): 3 items out, the middle one has error', async () => {
		const [out] = await new FacebookReels().execute.call(ctx(urls, 'continueRegularOutput'));
		expect(out).toHaveLength(3);
		expect(out[0].json.id).toBe(REEL);
		expect(out[1].json.errorCode).toBe('INVALID_URL');
		expect(out[1].pairedItem).toEqual({ item: 1 });
		expect(out[1].error).toBeUndefined();
		expect(out[2].json.id).toBe(REEL);
	});

	it('continue (error output): failing item carries .error', async () => {
		const [out] = await new FacebookReels().execute.call(ctx(urls, 'continueErrorOutput'));
		expect(out[1].error).toBeDefined();
		expect(out[0].error).toBeUndefined();
	});

	it('stop workflow: throws on the failing item', async () => {
		await expect(new FacebookReels().execute.call(ctx(urls, 'stopWorkflow'))).rejects.toThrow(/INVALID_URL/);
	});
});
