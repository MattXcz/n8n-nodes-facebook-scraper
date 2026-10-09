import { readFileSync } from 'fs';
import { join } from 'path';
import { FacebookClient } from '../src/lib/client';
import { mp4HasAudio } from '../src/lib/utils';

const fx = (n: string) => readFileSync(join(__dirname, 'fixtures', n));
const REEL = '1397612515779779';

/** Serves the Reel page; any fbcdn URL gets `mp4` honoring HTTP Range. */
function fetchWith(mp4: Buffer, seen: string[] = []) {
	return (async (url: string, init: { headers: Record<string, string> }) => {
		const headers = new Headers();
		(headers as any).getSetCookie = () => [];
		if (url.startsWith('https://www.facebook.com/reel/')) {
			return { status: 200, ok: true, headers, text: async () => fx('reel-logged-in.html').toString('utf8') } as any;
		}
		seen.push(init.headers.range);
		const m = /bytes=(\d+)-(\d+)/.exec(init.headers.range ?? '');
		const body = m ? mp4.subarray(Number(m[1]), Number(m[2]) + 1) : mp4;
		return { status: m ? 206 : 200, ok: true, headers, arrayBuffer: async () => body } as any;
	}) as any;
}

describe('mp4HasAudio', () => {
	const reader = (b: Buffer) => async (s: number, e: number) => b.subarray(s, e + 1);
	it('detects an audio track (moov at start)', async () => {
		expect(await mp4HasAudio(reader(fx('audio-video.mp4')), 1024)).toBe(true);
	});
	it('detects a video-only file (moov at end, needs a second range)', async () => {
		expect(await mp4HasAudio(reader(fx('video-only.mp4')), 1024)).toBe(false);
	});
	it('returns null for non-MP4 data', async () => {
		expect(await mp4HasAudio(reader(Buffer.from('<!DOCTYPE html><html></html>')), 1024)).toBeNull();
	});
});

describe('FacebookClient audio check', () => {
	it('progressive file with audio -> videoHasAudio true, hasSeparateAudio false', async () => {
		const seen: string[] = [];
		const c = new FacebookClient({}, { anonymous: true, fetchImpl: fetchWith(fx('audio-video.mp4'), seen) });
		const r = await c.getReelByUrl(`https://www.facebook.com/reel/${REEL}`);
		expect(r.platform).toBe('facebook');
		expect(r.videoHasAudio).toBe(true);
		expect(r.hasSeparateAudio).toBe(false);
		expect(seen[0]).toMatch(/^bytes=0-/);
	});

	it('progressive file without audio + audioUrl -> hasSeparateAudio true', async () => {
		const c = new FacebookClient({}, { anonymous: true, fetchImpl: fetchWith(fx('video-only.mp4')) });
		const r = await c.getReelByUrl(`https://www.facebook.com/reel/${REEL}`);
		expect(r.videoHasAudio).toBe(false);
		expect(r.hasSeparateAudio).toBe(r.audioUrl !== null);
	});

	it('probe failure never fails the lookup -> videoHasAudio null', async () => {
		const base = fetchWith(fx('audio-video.mp4'));
		const failing = (async (url: string, init: any) => {
			if (url.startsWith('https://www.facebook.com/')) return base(url, init);
			throw new Error('network down');
		}) as any;
		const c = new FacebookClient({}, { anonymous: true, fetchImpl: failing });
		const r = await c.getReelByUrl(`https://www.facebook.com/reel/${REEL}`);
		expect(r.videoHasAudio).toBeNull();
		expect(r.videoUrl).not.toBeNull();
	});
});
