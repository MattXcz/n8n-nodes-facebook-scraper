/**
 * CLI prototype: fetch ONE Reel exactly like the n8n node does and print the JSON.
 *   FB_COOKIES="c_user=...; xs=..." node dist/probe.js <reel-or-post-url> [--anon] [--highest] [--save]
 * --save writes the raw HTML to .probe/<id>.html (contains your session data - do not share unredacted!).
 */
import { mkdirSync, writeFileSync } from 'fs';
import { FacebookClient } from './lib/client';
import { canonicalReelUrl } from './lib/utils';

async function main() {
	const args = process.argv.slice(2);
	const url = args.find((a) => !a.startsWith('--'));
	if (!url) {
		console.error('usage: node dist/probe.js <reel-or-post-url> [--anon] [--highest] [--save]');
		process.exit(2);
	}
	const anonymous = args.includes('--anon') || !process.env.FB_COOKIES;
	const client = new FacebookClient(
		{ cookies: process.env.FB_COOKIES, userAgent: process.env.FB_UA, proxyUrl: process.env.FB_PROXY },
		{ anonymous, videoPreference: args.includes('--highest') ? 'highest' : 'progressive', maxRetries: 0 },
	);
	console.error('session:', JSON.stringify(client.describeSession()));
	if (args.includes('--save') && /\/reels?\//.test(url)) {
		const { id } = await client.resolveReelId(url);
		const page = await client.fetchPage(canonicalReelUrl(id));
		mkdirSync('.probe', { recursive: true });
		writeFileSync(`.probe/${id}.html`, page.html);
		console.error(`saved .probe/${id}.html status=${page.status} final=${page.finalUrl} bytes=${page.html.length}`);
	}
	const res = /\/reels?\/|\/share\/r\//.test(url) ? await client.getReelByUrl(url) : await client.getPostByUrl(url);
	console.log(JSON.stringify(res, null, 2));
}
main().catch((e) => {
	console.error(`ERROR ${e.code ?? ''}: ${e.message}`);
	process.exit(1);
});
