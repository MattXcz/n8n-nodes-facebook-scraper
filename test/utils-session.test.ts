import { parseReelUrl, parseCompactNumber, decodeHtmlEntities, cdnUrlExpiry, titleFromCaption } from '../src/lib/utils';
import { FacebookSession, redactSecrets } from '../src/lib/session';
import { inspect } from 'util';

describe('parseReelUrl', () => {
	it.each([
		['https://www.facebook.com/reel/1397612515779779', 'reel', '1397612515779779'],
		['https://m.facebook.com/reel/1397612515779779/?mibextid=abc', 'reel', '1397612515779779'],
		['facebook.com/reel/1397612515779779', 'reel', '1397612515779779'],
		['https://www.facebook.com/61577048296791/videos/some-slug/1397612515779779/', 'watch', '1397612515779779'],
		['https://www.facebook.com/watch/?v=1397612515779779', 'watch', '1397612515779779'],
	])('%s', (url, kind, id) => {
		const p = parseReelUrl(url);
		expect(p.kind).toBe(kind);
		expect((p as { id: string }).id).toBe(id);
	});
	it('recognizes share links', () => {
		expect(parseReelUrl('https://www.facebook.com/share/r/1AbCdEfGh/').kind).toBe('share');
		expect(parseReelUrl('https://fb.watch/abc123/').kind).toBe('share');
	});
	it.each(['', 'not a url', 'https://www.instagram.com/reel/abc/', 'https://www.facebook.com/someone', 'https://evil-facebook.com/reel/1397612515779779'])(
		'rejects %p',
		(u) => expect(() => parseReelUrl(u)).toThrow(/INVALID_URL/),
	);
});

describe('helpers', () => {
	it.each([
		['22 tis.', 22000], ['1,4 tis.', 1400], ['3,2 mil.', 3200000], ['12K', 12000], ['1.2M', 1200000],
		['845', 845], ['12,345', 12345], ['1 234', 1234], ['0', 0], ['abc', null], ['', null],
	])('parseCompactNumber(%p) = %p', (s, n) => expect(parseCompactNumber(s as string)).toBe(n));

	it('decodes hex entities incl. emoji', () => {
		expect(decodeHtmlEntities('om&#xe1;&#x10d;ka &#x1f440; &amp; &quot;x&quot;')).toBe('omáčka 👀 & "x"');
	});
	it('reads fbcdn expiry', () => {
		expect(cdnUrlExpiry('https://x.fbcdn.net/a.mp4?_nc=1&oe=6AC94F40')).toBe(new Date(0x6ac94f40 * 1000).toISOString());
		expect(cdnUrlExpiry('https://x/a.mp4')).toBeNull();
	});
	it('title keeps emoji intact', () => {
		expect(titleFromCaption('\n\n👀 Ahoj světe\nřádek 2')).toBe('👀 Ahoj světe');
		expect(titleFromCaption(null)).toBeNull();
	});
});

describe('FacebookSession', () => {
	const header = 'c_user=100000000000001; xs=12%3ASECRETSECRET%3A2%3A1700000000; datr=DATRDATRDATR; fr=FRFRFRFRFR';
	it('parses a cookie header', () => {
		const s = new FacebookSession(header);
		expect(s.isLoggedIn).toBe(true);
		expect(s.userId).toBe('100000000000001');
		expect(s.header()).toContain('xs=12%3ASECRETSECRET');
	});
	it('parses a JSON cookie export and ignores other domains', () => {
		const s = new FacebookSession(JSON.stringify([
			{ name: 'c_user', value: '1', domain: '.facebook.com' },
			{ name: 'xs', value: 'abc', domain: '.facebook.com' },
			{ name: 'sessionid', value: 'ig', domain: '.instagram.com' },
		]));
		expect(s.isLoggedIn).toBe(true);
		expect(s.header()).not.toContain('sessionid');
	});
	it('reports missing required cookies', () => {
		expect(new FacebookSession('datr=1').missingRequired()).toEqual(['c_user', 'xs']);
	});
	it('detects invalidated session from Set-Cookie', () => {
		const s = new FacebookSession(header);
		expect(s.absorbSetCookie(['xs=deleted; expires=Thu, 01 Jan 1970 00:00:01 GMT; path=/; domain=.facebook.com'])).toEqual(['xs']);
		expect(s.isLoggedIn).toBe(false);
	});
	it('rotates cookies from Set-Cookie', () => {
		const s = new FacebookSession(header);
		s.absorbSetCookie(['fr=NEWFR; expires=Fri, 01 Jan 2100 00:00:00 GMT; path=/']);
		expect(s.header()).toContain('fr=NEWFR');
	});
	it('never leaks secrets via JSON / inspect / redact', () => {
		const s = new FacebookSession(header);
		expect(JSON.stringify({ s })).not.toContain('SECRETSECRET');
		expect(inspect(s)).not.toContain('SECRETSECRET');
		expect(redactSecrets(`failed with cookie ${header}`, s)).not.toMatch(/SECRETSECRET|DATRDATR|FRFRFR/);
	});
});
