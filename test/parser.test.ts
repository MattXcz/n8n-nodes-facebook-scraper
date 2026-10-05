import { readFileSync } from 'fs';
import { join } from 'path';
import { parseReelPage, parseOgTitle, detectPageSignals } from '../src/lib/parser';
import { FacebookScraperError } from '../src/lib/errors';

const fx = (n: string) => readFileSync(join(__dirname, 'fixtures', n), 'utf8');
const REEL = '1397612515779779';
const opts = { reelId: REEL, inputUrl: `https://www.facebook.com/reel/${REEL}`, authenticated: true, now: new Date('2026-10-05T00:00:00Z') };

describe('logged-in Reel page (real structure)', () => {
	const r = parseReelPage(fx('reel-logged-in.html'), opts);

	it('keeps Instagram-compatible field names', () => {
		for (const k of ['id', 'url', 'title', 'description', 'thumbnail', 'videoUrl', 'likeCount', 'commentCount', 'viewCount', 'topComment', 'author', 'authorFullName', 'takenAt', 'mediaType', 'isVideo']) {
			expect(r).toHaveProperty(k);
		}
	});

	it('extracts caption with Czech diacritics, emoji and newlines intact', () => {
		expect(r.description).toContain('karamelová omáčka');
		expect(r.description).toContain('👀');
		expect(r.description).toContain('❤️');
		expect(r.description).toContain('\nSuroviny\n100 g cukru\n');
		expect(r.title?.startsWith('Tohle je ta jediná karamelová omáčka')).toBe(true);
		expect(Array.from(r.title ?? '').length).toBeLessThanOrEqual(120);
		expect(r.title).not.toContain('\n');
	});

	it('returns data of the requested Reel, not the recommended one', () => {
		expect(r.id).toBe(REEL);
		expect(r.description).not.toContain('DOPORUČENÉ');
		expect(r.commentCount).toBe(12); // recommended has 1821
		expect(r.likeCount).toBe(1461); // recommended has 88888
		expect(r.shareCount).toBe(352);
		expect(r.authorFullName).toBe('Zápisky z kuchyně');
		expect(r.videoUrl).toContain(`HD_${REEL}`);
		expect(r.thumbnail).toContain(`THUMB_${REEL}`);
	});

	it('prefers the HD progressive MP4 (single file with audio)', () => {
		expect(r.videoDeliveryType).toBe('progressive');
		expect(r.videoQuality).toBe('HD');
		expect(r.hasSeparateAudio).toBe(false);
		expect(r.videoUrlSd).toContain(`SD_${REEL}`);
		expect(r.videoUrlExpiresAt).toBe(new Date(0x6a000000 * 1000).toISOString());
	});

	it('returns ISO 8601 date and author info', () => {
		expect(r.takenAt).toBe(new Date(1789233612 * 1000).toISOString());
		expect(r.author).toBe('61577048296791'); // profile.php?id= -> no vanity name
		expect(r.authorUrl).toBe('https://www.facebook.com/profile.php?id=61577048296791');
		expect(r.postId).toBe('122217668462901609');
		expect(r.width).toBe(1080);
		expect(r.height).toBe(1920);
		expect(r.durationSeconds).toBeCloseTo(6.453);
	});

	it('uses null (not 0) for stats Facebook did not provide', () => {
		expect(r.viewCount).toBeNull(); // not present in logged-in page
		expect(r.topComment).toBeNull();
		expect(r.statsSource).toBe('relay');
		expect(r.dataSource).toBe('relay');
	});
});

describe('missing statistics', () => {
	const r = parseReelPage(fx('reel-logged-in-no-stats.html'), opts);
	it('returns null for hidden stats, keeps other data', () => {
		expect(r.likeCount).toBeNull();
		expect(r.commentCount).toBeNull();
		expect(r.shareCount).toBeNull();
		expect(r.viewCount).toBeNull();
		expect(r.statsSource).toBeNull();
		expect(r.videoUrl).not.toBeNull();
		expect(r.description).toContain('karamelová');
	});
	it('keeps a real zero as 0', () => {
		const html = fx('reel-logged-in.html').replace('"total_comment_count":12', '"total_comment_count":0');
		expect(parseReelPage(html, opts).commentCount).toBe(0);
	});
});

describe('anonymous page (og fallback, real format)', () => {
	const r = parseReelPage(fx('reel-anonymous.html'), { ...opts, authenticated: false });
	it('parses full caption, author and rounded localized stats from og:title', () => {
		expect(r.description?.startsWith('Tohle je ta jediná karamelová omáčka')).toBe(true);
		expect(r.description).toContain('slaném karamelu');
		expect(r.description).toContain('\n');
		expect(r.authorFullName).toBe('Zápisky z kuchyně');
		expect(r.viewCount).toBe(22000);
		expect(r.likeCount).toBe(1400);
		expect(r.commentCount).toBeNull();
		expect(r.statsSource).toBe('og');
		expect(r.dataSource).toBe('og');
		expect(r.thumbnail).toContain('OGTHUMB');
		expect(r.videoUrl).toBeNull();
		expect(r.takenAt).toBeNull();
	});
});

describe('DASH-only (SYNTHETIC)', () => {
	it('falls back to DASH video track and reports separate audio', () => {
		const r = parseReelPage(fx('reel-dash-only.html'), opts);
		expect(r.videoDeliveryType).toBe('dash');
		expect(r.videoUrl).toContain('VIDEO1080');
		expect(r.videoUrl).not.toContain('&amp;');
		expect(r.hasSeparateAudio).toBe(true);
		expect(r.audioUrl).toContain('AUDIO');
		expect(r.videoQuality).toBe('1080p');
	});
	it('"highest" preference picks DASH even when progressive exists', () => {
		const html = fx('reel-dash-only.html');
		const r = parseReelPage(html, { ...opts, videoPreference: 'highest' });
		expect(r.videoQuality).toBe('1080p');
	});
});

describe('structure changed', () => {
	it('throws PAGE_STRUCTURE_CHANGED', () => {
		expect(() => parseReelPage(fx('reel-structure-changed.html'), opts)).toThrow(FacebookScraperError);
		expect(() => parseReelPage(fx('reel-structure-changed.html'), opts)).toThrow(/PAGE_STRUCTURE_CHANGED/);
	});
	it('does not return the recommended Reel when asked for an id not on the page', () => {
		expect(() => parseReelPage(fx('reel-logged-in.html'), { ...opts, reelId: '1111111111111111' })).toThrow(/PAGE_STRUCTURE_CHANGED/);
	});
});

describe('og:title parsing', () => {
	it.each([
		['22 tis. zhlédnutí · 1,4 tis. reakcí | Ahoj | Autor', 22000, 1400, 'Ahoj', 'Autor'],
		['1.2M views · 845 reactions | Hello | World | Page', 1200000, 845, 'Hello | World', 'Page'],
		['Jen text | Autor', null, null, 'Jen text', 'Autor'],
	])('%s', (t, v, re, cap, au) => {
		const s = parseOgTitle(t);
		expect(s.views).toBe(v);
		expect(s.reactions).toBe(re);
		expect(s.caption).toBe(cap);
		expect(s.author).toBe(au);
	});
});

describe('page signals', () => {
	it('detects unavailable / rate limit / logged-out', () => {
		expect(detectPageSignals(fx('content-unavailable.html'), 'https://www.facebook.com/reel/1').unavailable).toBe(true);
		expect(detectPageSignals(fx('rate-limited.html'), 'https://www.facebook.com/reel/1').rateLimited).toBe(true);
		expect(detectPageSignals(fx('logged-out-with-cookies.html'), 'https://www.facebook.com/reel/1').pageUserId).toBeNull();
		expect(detectPageSignals(fx('reel-logged-in.html'), 'https://www.facebook.com/reel/1').pageUserId).toBe('100000000000001');
		expect(detectPageSignals('', 'https://www.facebook.com/checkpoint/123/').checkpoint).toBe(true);
	});
});
