import { readFileSync } from 'fs';
import { join } from 'path';
import { parsePostPage } from '../src/lib/postParser';
import { parsePostUrl } from '../src/lib/utils';
import { FacebookClient } from '../src/lib/client';
import { runWithAuth } from '../src/lib/strategy';

const fx = (n: string) => readFileSync(join(__dirname, 'fixtures', n), 'utf8');
const VID = '1819897855848074';
const TXT = '1819812229189970';
const base = { inputUrl: `https://www.facebook.com/groups/bambulabczsk/permalink/${VID}/`, authenticated: true, now: new Date('2026-10-05T00:00:00Z') };

describe('parsePostUrl', () => {
	it.each([
		[`https://www.facebook.com/groups/bambulabczsk/permalink/${VID}/`, VID, 'bambulabczsk'],
		[`https://www.facebook.com/groups/bambulabczsk/posts/${VID}/?comment_id=1`, VID, 'bambulabczsk'],
		[`https://m.facebook.com/groups/891472575357278/posts/${VID}`, VID, '891472575357278'],
		[`https://www.facebook.com/groups/bambulabczsk/?multi_permalinks=${VID}`, VID, 'bambulabczsk'],
		['https://www.facebook.com/ceskatelevize/posts/pfbid02abcDEF123xyz', 'pfbid02abcDEF123xyz', null],
		['https://www.facebook.com/permalink.php?story_fbid=pfbid0xyz789&id=100064', 'pfbid0xyz789', null],
		['https://www.facebook.com/story.php?story_fbid=1234567890&id=42', '1234567890', null],
	])('%s', (url, id, group) => {
		const p = parsePostUrl(url);
		expect(p.kind).toBe('post');
		expect((p as any).postId).toBe(id);
		expect((p as any).groupSlug).toBe(group);
	});
	it('share/p', () => expect(parsePostUrl('https://www.facebook.com/share/p/1AbC/').kind).toBe('share'));
	it.each(['https://www.facebook.com/reel/1397612515779779', 'https://www.facebook.com/groups/bambulabczsk', 'https://example.com/posts/1234567'])('rejects %s', (u) =>
		expect(() => parsePostUrl(u)).toThrow(/INVALID_URL/),
	);
});

describe('group post with video (real structure)', () => {
	const r = parsePostPage(fx('post-group-video.html'), { ...base, postId: VID });
	it('core fields', () => {
		expect(r.id).toBe(VID);
		expect(r.url).toBe(`https://www.facebook.com/groups/bambulabczsk/posts/${VID}/`);
		expect(r.description).toContain('čistící věži? Za mě naprosto parádní věc');
		expect(r.description?.length).toBeGreaterThan(300);
		expect(r.descriptionTruncated).toBe(false);
		expect(r.authorFullName).toBe('Osoba 1');
		expect(r.author).toBeNull(); // group members: no public profile url
		expect(r.takenAt).toBe(new Date(1791194007 * 1000).toISOString());
	});
	it('group info', () => {
		expect(r.groupId).toBe('891472575357278');
		expect(r.groupName).toBe('Bambu Lab CZ/SK');
		expect(r.groupUrl).toBe('https://www.facebook.com/groups/bambulabczsk/');
	});
	it('stats: real zero shares stays 0, unreliable view 0 becomes null', () => {
		expect(r.likeCount).toBe(26);
		expect(r.commentCount).toBe(17);
		expect(r.shareCount).toBe(0);
		expect(r.viewCount).toBeNull();
	});
	it('top comment = first ranked top-level comment', () => {
		expect(r.topComment).toEqual({ text: expect.stringContaining('dozvídám až teď'), author: 'Osoba 3', likeCount: 0 });
	});
	it('video', () => {
		expect(r.mediaType).toBe('video');
		expect(r.isVideo).toBe(true);
		expect(r.videoUrl).toContain('HD_2084751125578123');
		expect(r.thumbnail).toContain('PTHUMB');
		expect(r.videoUrlExpiresAt).not.toBeNull();
	});
});

describe('group text-only post (real structure)', () => {
	const r = parsePostPage(fx('post-group-text.html'), { ...base, postId: TXT });
	it('parses text with diacritics, emoji and newlines', () => {
		expect(r.description).toBe('Dobrý den,\nNeprodává náhodou někdo prázdné Bambu cívky? Koupil bych tak 10 ks. Prosím nabídněte. Děkuji 🙏\nMartin');
		expect(r.mediaType).toBe('text');
		expect(r.isVideo).toBe(false);
		expect(r.images).toEqual([]);
		expect(r.thumbnail).toBeNull();
		expect(r.videoUrl).toBeNull();
	});
	it('real zero reactions are 0', () => {
		expect(r.likeCount).toBe(0);
		expect(r.commentCount).toBe(2);
		expect(r.topComment?.author).toBe('Osoba 6');
		expect(r.topComment?.likeCount).toBe(1);
	});
});

describe('anonymous group post (real og format)', () => {
	const r = parsePostPage(fx('post-group-anonymous.html'), { ...base, postId: VID, authenticated: false });
	it('returns truncated text and marks it', () => {
		expect(r.dataSource).toBe('og');
		expect(r.descriptionTruncated).toBe(true);
		expect(r.description?.endsWith('...')).toBe(true);
		expect(r.groupName).toBe('Bambu Lab CZ/SK');
		expect(r.title).toBe('Už jste zkoušeli tu novou funkci v Bambu Studio na vynechání zbytečných vrstev v čistící věži');
		expect(r.takenAt).toBeNull();
		expect(r.likeCount).toBeNull();
		expect(r.mediaType).toBe('video');
		expect(r.videoUrl).toBeNull();
	});
});

describe('SYNTHETIC post types', () => {
	it('carousel: all photos in full resolution', () => {
		const r = parsePostPage(fx('post-album.html'), { ...base, postId: '1820000000000001' });
		expect(r.mediaType).toBe('carousel');
		expect(r.images.map((i) => i.id)).toEqual(['901', '902', '903']);
		expect(r.images[0].url).toContain('FULL_901');
		expect(r.images[0].width).toBe(2048);
		expect(r.images[0].alt).toContain('3D tiskárny');
		expect(r.thumbnail).toContain('FULL_901');
		expect(r.description).toBe('Moje první tisky 😊\nPLA + PETG');
	});
	it('link: unwraps l.facebook.com and missing stats are null', () => {
		const r = parsePostPage(fx('post-link.html'), { ...base, postId: '1820000000000002' });
		expect(r.mediaType).toBe('link');
		expect(r.linkUrl).toBe('https://wiki.bambulab.com/cs/software/bambu-studio/prime-tower');
		expect(r.linkTitle).toBe('Prime tower – Bambu Lab Wiki');
		expect(r.likeCount).toBeNull();
		expect(r.commentCount).toBeNull();
		expect(r.shareCount).toBeNull();
		expect(r.statsSource).toBeNull();
	});
	it('shared post: data of the original (attached_story) does not leak', () => {
		const r = parsePostPage(fx('post-shared.html'), { ...base, postId: '1820000000000003' });
		expect(r.description).toBe('Sdílím zajímavý příspěvek');
		expect(r.images).toEqual([]);
	});
	it('pfbid URL resolves to the numeric post_id', () => {
		const html = fx('post-group-text.html').split(`/posts/${TXT}/`).join(`/posts/pfbid0TESTabc/`);
		const r = parsePostPage(html, { ...base, postId: 'pfbid0TESTabc' });
		expect(r.id).toBe(TXT);
	});
	it('unknown post id -> PAGE_STRUCTURE_CHANGED', () => {
		expect(() => parsePostPage(fx('post-group-text.html'), { ...base, postId: '1111111111111' })).toThrow(/PAGE_STRUCTURE_CHANGED/);
	});
});

// ---------------------------------------------------------------- auth strategy

function mockFetch(byCookie: { anon: string | number; session: string | number }) {
	return (async (_url: string, init: { headers: Record<string, string> }) => {
		const v = init.headers.cookie ? byCookie.session : byCookie.anon;
		const headers = new Headers();
		(headers as any).getSetCookie = () => [];
		if (typeof v === 'number') return { status: v, headers, text: async () => '' } as any;
		return { status: 200, headers, text: async () => v } as any;
	}) as any;
}
const COOKIES = 'c_user=100000000000001; xs=12%3ASECRET';
const mk = (pages: { anon: string | number; session: string | number }) => {
	const f = mockFetch(pages);
	return {
		anon: new FacebookClient({ cookies: COOKIES }, { anonymous: true, fetchImpl: f, maxRetries: 0 }),
		session: new FacebookClient({ cookies: COOKIES }, { anonymous: false, fetchImpl: f, maxRetries: 0 }),
	};
};
const url = `https://www.facebook.com/groups/bambulabczsk/permalink/${VID}/`;

describe('auth strategy (authUsed / credentialsRequired)', () => {
	it('auto: public truncated -> uses session, credentialsRequired=true', async () => {
		const c = mk({ anon: fx('post-group-anonymous.html'), session: fx('post-group-video.html') });
		const r = await runWithAuth('post', 'auto', c, (cl) => cl.getPostByUrl(url));
		expect(r.authUsed).toBe('session');
		expect(r.credentialsRequired).toBe(true);
		expect(r.publicAttempt?.complete).toBe(false);
		expect(r.publicAttempt?.missing).toEqual(expect.arrayContaining(['description (truncated)', 'takenAt', 'stats']));
		expect(r.authenticated).toBe(true);
		expect(r.likeCount).toBe(26);
	});
	it('auto: public page complete -> no credentials used, credentialsRequired=false', async () => {
		const html = fx('post-group-text.html').replace(/"USER_ID":"100000000000001"/, '"USER_ID":"0"');
		const c = mk({ anon: html, session: 500 });
		const r = await runWithAuth('post', 'auto', c, (cl) => cl.getPostByUrl(`https://www.facebook.com/groups/bambulabczsk/posts/${TXT}/`));
		expect(r.authUsed).toBe('public');
		expect(r.credentialsRequired).toBe(false);
		expect(r.publicAttempt).toEqual({ complete: true, missing: [], error: null });
	});
	it('auto: public login wall -> session, error recorded', async () => {
		const c = mk({ anon: '<html><body><form id="login_form"></form></body></html>', session: fx('post-group-video.html') });
		const r = await runWithAuth('post', 'auto', c, (cl) => cl.getPostByUrl(url));
		expect(r.authUsed).toBe('session');
		expect(r.credentialsRequired).toBe(true);
		expect(r.publicAttempt?.error).toMatch(/LOGIN_REQUIRED/);
	});
	it('none: returns incomplete public data with credentialsRequired=true', async () => {
		const c = mk({ anon: fx('post-group-anonymous.html'), session: 500 });
		const r = await runWithAuth('post', 'none', { anon: c.anon }, (cl) => cl.getPostByUrl(url));
		expect(r.authUsed).toBe('public');
		expect(r.credentialsRequired).toBe(true);
	});
	it('session: not tested publicly -> credentialsRequired=null', async () => {
		const c = mk({ anon: 500, session: fx('post-group-video.html') });
		const r = await runWithAuth('post', 'session', c, (cl) => cl.getPostByUrl(url));
		expect(r.authUsed).toBe('session');
		expect(r.credentialsRequired).toBeNull();
		expect(r.publicAttempt).toBeNull();
	});
	it('auto for Reels: anonymous lacks videoUrl -> session', async () => {
		const c = mk({ anon: fx('reel-anonymous.html'), session: fx('reel-logged-in.html') });
		const r = await runWithAuth('reel', 'auto', c, (cl) => cl.getReelByUrl('https://www.facebook.com/reel/1397612515779779'));
		expect(r.authUsed).toBe('session');
		expect(r.publicAttempt?.missing).toEqual(expect.arrayContaining(['videoUrl', 'takenAt']));
		expect(r.videoUrl).not.toBeNull();
	});
	it('auto: invalid URL is not retried with session', async () => {
		const c = mk({ anon: 500, session: 500 });
		await expect(runWithAuth('post', 'auto', c, (cl) => cl.getPostByUrl('https://www.facebook.com/nothing'))).rejects.toThrow(/INVALID_URL/);
	});
});

describe('n8n node: Detect From URL + Auto auth, mixed items', () => {
	it('reel + post + invalid -> 3 items, each with authUsed / credentialsRequired', async () => {
		const { FacebookReels } = require('../src/nodes/FacebookReels/FacebookReels.node');
		const undici = require('undici');
		const spy = jest.spyOn(undici, 'fetch').mockImplementation((async (u: string, init: { headers: Record<string, string> }) => {
			const headers = new Headers();
			(headers as any).getSetCookie = () => [];
			const logged = !!init.headers.cookie;
			const body = u.includes('/reel/')
				? fx(logged ? 'reel-logged-in.html' : 'reel-anonymous.html')
				: fx(logged ? 'post-group-video.html' : 'post-group-anonymous.html');
			return { status: 200, headers, text: async () => body } as any;
		}) as any);
		const urls = ['https://www.facebook.com/reel/1397612515779779', url, 'https://www.facebook.com/nothing-here'];
		const ctx = {
			getInputData: () => urls.map(() => ({ json: {} })),
			getNodeParameter: (n: string, i: number, d?: unknown) =>
				n === 'authentication' ? 'auto' : n === 'resource' ? 'detect' : n === 'url' ? urls[i] : n === 'options' ? { delayBetweenItems: 0 } : d,
			getCredentials: async () => ({ cookies: COOKIES }),
			getNode: () => ({ name: 'FB', onError: 'continueRegularOutput' }),
			continueOnFail: () => true,
			helpers: { returnJsonArray: (d: any) => [{ json: d }], constructExecutionMetaData: (d: any[], m: any) => d.map((x) => ({ ...x, pairedItem: m.itemData })) },
		} as any;
		const [out] = await new FacebookReels().execute.call(ctx);
		spy.mockRestore();
		expect(out).toHaveLength(3);
		expect(out[0].json).toMatchObject({ resource: 'reel', authUsed: 'session', credentialsRequired: true });
		expect(out[1].json).toMatchObject({ resource: 'post', authUsed: 'session', credentialsRequired: true, groupName: 'Bambu Lab CZ/SK' });
		expect(out[2].json.errorCode).toBe('INVALID_URL');
	});
});
