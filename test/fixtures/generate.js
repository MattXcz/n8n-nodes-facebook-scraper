/**
 * Generates the anonymized HTML fixtures used by the parser tests.
 *
 * Source: real responses of https://www.facebook.com/reel/1397612515779779
 * captured 2026-10-05 in a logged-in desktop browser and as an anonymous
 * request. The JSON shapes, key names, nesting (RelayPrefetchedStreamCache ->
 * __bbox.result.data), the presence of a *recommended* Reel next to the
 * requested one, og:title format etc. are copied 1:1. Anonymized:
 *   - viewer (logged-in account) id  -> 100000000000001
 *   - all fbcdn URL signatures       -> fake (oe= kept as a valid hex expiry)
 *   - tracking / encrypted blobs     -> removed
 *   - the recommended Reel's caption/owner -> invented
 * Fixtures marked SYNTHETIC below were NOT observed live (login wall,
 * checkpoint, unavailable, rate limit, DASH-only) and are built from the
 * same skeleton to test error handling.
 *
 *   node test/fixtures/generate.js
 */
const fs = require('fs');
const path = require('path');

const REEL = '1397612515779779';
const OTHER = '28670499499212735';
const OWNER = '61577048296791';
const VIEWER = '100000000000001';
const OE = '6A000000'; // 2026-05-03T... expiry in hex seconds
const cdn = (p) => `https://scontent.fprg6-1.fna.fbcdn.net${p}?_nc_cat=1&ccb=1-7&_nc_sid=anon&oh=00_ANON&oe=${OE}`;

const CAPTION =
	'Tohle je ta jediná karamelová omáčka, kterou kdy budeš potřebovat. Dokonalá na zmrzlinu, palačinky nebo jen tak na lžičku. 👀Ale hlavně je nezbytností pro všechny hřejivé podzimní recepty ❤️\n \nSuroviny\n100 g cukru\n50 ml vody\n100 ml smetany\n35 g másla\n \nPostup:\n1)Do pánve dáme cukr a vodu. Necháme na mírném plameni rozpustit a postupně přivedeme k varu. \n2) Když je cukr úplně rozpuštěný a směs začíná bublat, tak přestáváme míchat, jinak začne krystalizovat (pokud se tak stane, opět přilijeme vodu a necháme rozpustit) \n3)Když se karamel zbarví do sympatické zrzavé, odstavíme ho z plamene a vlijeme smetanu. Pozor, bude to prskat.  Můžeme vrátit na mírný plamen a opatrným mícháním karamel rozpustit ve smetaně. 4)Sundáme z plamene, přihodíme máslo a promícháme. \n5)Až karamel trochu vychladne, můžeme jej přecedit, aby byl krásně hladký.  Karamelovou omáčku uchovávejte v lednici.\n \nTip: spolu s máslem můžete přidat špetku soli, pokud toužíte po slaném karamelu';

const storyId = (owner, vid) => Buffer.from(`S:_I${owner}:VK:${vid}`).toString('base64');

function sjs(label, data, extensions, path_) {
	return {
		require: [[
			'ScheduledServerJS', 'handle', null,
			[{ __bbox: { require: [[
				'RelayPrefetchedStreamCache', 'next', [],
				['adp_FBUnifiedVideoRootWithEntrypointQueryRelayPreloader_anon', {
					__bbox: { complete: false, result: { label, path: path_, data, extensions: { ...extensions, is_final: false } }, sequence_number: 0 },
				}],
			]] } }],
		]],
	};
}

function videoNode(id, owner, { progressive = true, quality = ['SD', 'HD'], dash = false } = {}) {
	const manifest = dash
		? `<?xml version="1.0" encoding="UTF-8"?>\n<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static"><Period id="0"><AdaptationSet id="0" contentType="video">` +
			`<Representation id="1v" bandwidth="157784" codecs="av01" mimeType="video/mp4" width="720" height="1280" FBQualityClass="hd" FBQualityLabel="240p"><BaseURL>${cdn('/o1/v/t2/f2/m367/VIDEO240.mp4').replace(/&/g, '&amp;')}</BaseURL></Representation>` +
			`<Representation id="2v" bandwidth="2154864" codecs="av01" mimeType="video/mp4" width="1080" height="1920" FBQualityClass="hd" FBQualityLabel="1080p"><BaseURL>${cdn('/o1/v/t2/f2/m367/VIDEO1080.mp4').replace(/&/g, '&amp;')}</BaseURL></Representation>` +
			`</AdaptationSet><AdaptationSet id="1" contentType="audio"><Representation id="3a" bandwidth="61767" codecs="mp4a.40.5" mimeType="audio/mp4"><BaseURL>${cdn('/o1/v/t2/f2/m69/AUDIO.mp4').replace(/&/g, '&amp;')}</BaseURL></Representation></AdaptationSet></Period></MPD>`
		: '<?xml version="1.0"?><MPD><Period><AdaptationSet contentType="video"/><AdaptationSet contentType="audio"/></Period></MPD>';
	return {
		__typename: 'Video',
		id,
		shareable_url: `https://www.facebook.com/reel/${id}`,
		__isNode: 'Video',
		first_frame_thumbnail: cdn(`/v/t15.5256-10/FIRSTFRAME_${id}_n.jpg`),
		height: 1920,
		width: 1080,
		length_in_second: 6.453,
		is_looping: true,
		permalink_url: `https://www.facebook.com/reel/${id}/`,
		video_status_type: 'OK',
		min_quality_preference: 'HD',
		videoDeliveryLegacyFields: null,
		videoDeliveryResponseFragment: {
			videoDeliveryResponseResult: {
				dash_manifests: [{ manifest_xml: manifest, failure_reason: null }],
				dash_manifest_urls: [{ manifest_url: `https://www.facebook.com/dash_mpd_debug.mpd?v=${id}&dummy=.mpd`, failure_reason: null }],
				progressive_urls: progressive
					? quality.map((q) => ({ progressive_url: cdn(`/o1/v/t2/f2/m367/${q}_${id}.mp4`), failure_reason: null, metadata: { quality: q } }))
					: [{ progressive_url: null, failure_reason: { type: 'NotEligible', message_format: '' }, metadata: { quality: 'SD' } }],
				hls_playlist_urls: [{ hls_playlist_url: null, failure_reason: { type: 'NotEligibleForHls', message_format: '', message_params: [] } }],
				id,
			},
			id,
		},
		preferred_thumbnail: { image: { uri: cdn(`/v/t51.82787-10/THUMB_${id}_n.jpg`) }, image_preview_payload: null, id: '1399357822392225' },
		playable_duration_in_ms: 6453,
		owner: { __typename: 'User', id: owner },
	};
}

function ownerFull(id, name) {
	return { __typename: 'User', __isActor: 'User', id, name, is_verified: false, url: `https://www.facebook.com/profile.php?id=${id}` };
}

function pageHtml(blocks, { userId = VIEWER, meta = '' } = {}) {
	const scripts = blocks.map((b) => `<script type="application/json" data-content-len="${JSON.stringify(b).length}" data-sjs>${JSON.stringify(b)}</script>`).join('\n');
	return `<!DOCTYPE html><html lang="cs" id="facebook"><head><meta charset="utf-8" /><title>Facebook</title>${meta}</head><body>
<script type="application/json" data-sjs>{"require":[["ServerJS","handle",null,[{"define":[["CurrentUserInitialData",[],{"ACCOUNT_ID":"${userId}","USER_ID":"${userId}","NAME":"Anon"},270]]}]]]}</script>
${scripts}
</body></html>`;
}

/** Real logged-in structure: requested Reel + one recommended Reel. */
function loggedIn({ feedback = { total_comment_count: 12, share_count_reduced: '352' }, reactors = { count: 1461 }, dash = false, progressive = true, caption = CAPTION } = {}) {
	const ext = (ids) => ({ all_video_dash_prefetch_representations: ids.map((v) => ({ initial_representation_ids: [], video_id: v, nextgendash: true })) });
	const sid = storyId(OWNER, REEL);
	const otherSid = 'UzpfSUZTOjE6LTYwMzc2MDkxNzIzMjY0NTAyNzQ6ZUp3VDJ6SzdjYzZUdjI4';
	const blocks = [
		// #56 - root video query: Video node + delivery urls
		sjs(undefined, {
			video: { creation_story: { attachments: [{ media: videoNode(REEL, OWNER, { dash, progressive }) }], id: sid, sponsored_data: null }, id: REEL },
			viewer: { actor: { __typename: 'User', id: VIEWER }, video_feed_unit_feed: { edges: [] } },
		}, ext([REEL])),
		// #60 - RECOMMENDED next reel (must be ignored)
		sjs('FBUnifiedVideoContainer_reels$stream$FBUnifiedVideoContainer_video_feed_unit_feed', {
			node: { __typename: 'Story', attachments: [{ media: videoNode(OTHER, '61590802700690') }], id: otherSid },
			cursor: null,
		}, ext([REEL, OTHER]), ['viewer', 'video_feed_unit_feed', 'edges', 0]),
		// #72 - footer: caption, creation_time, owner name
		sjs('FBUnifiedVideoMediaContentContainer_reels$defer$FBUnifiedVideoMediaFooter_footer_eAnYh', {
			sponsored_data: null,
			attachments: [{ media: { __typename: 'Video', owner: ownerFull(OWNER, 'Zápisky z kuchyně'), id: REEL, length_in_second: 6.453, track_title: 'Zápisky z kuchyně · Původní zvuk' } }],
			privacy_scope: { description: 'Veřejný' },
			id: sid,
			post_id: '122217668462901609',
			creation_time: 1789233612,
			is_reshare: false,
			actors: [ownerFull(OWNER, 'Zápisky z kuchyně')],
			feedback: { associated_group: null, id: 'ZmVlZGJhY2s6MTIyMjE3NjY4NDYyOTAxNjA5' },
			message: caption === null ? null : { text: caption, ranges: [] },
			translated_message_for_viewer: null,
		}, ext([REEL, OTHER]), ['video', 'creation_story']),
		// #75 - recommended reel footer (must be ignored)
		sjs('FBUnifiedVideoMediaContentContainer_reels$defer$FBUnifiedVideoMediaFooter_footer_eAnYh', {
			attachments: [{ media: { __typename: 'Video', owner: ownerFull('61590802700690', 'Jiný Autor'), id: OTHER } }],
			id: otherSid,
			post_id: '999',
			creation_time: 1786211783,
			actors: [ownerFull('61590802700690', 'Jiný Autor')],
			feedback: { associated_group: null, id: 'ZmVlZGJhY2s6OTk5' },
			message: { text: 'DOPORUČENÉ VIDEO – nesmí se objevit ve výstupu', ranges: [] },
		}, ext([OTHER]), ['viewer', 'video_feed_unit_feed', 'edges', 0, 'node']),
		// #78 - recommended reel feedback (must be ignored)
		sjs('FBUnifiedVideoUFI', {
			id: otherSid,
			video: { id: OTHER },
			attachments: [{ media: { __typename: 'Video', video_owner_type: 'FACEBOOK_USER', __isNode: 'Video', id: OTHER, shareable_url: `https://www.facebook.com/reel/${OTHER}` } }],
			feedback: { if_viewer_can_see_comments: { id: 'x' }, id: 'ZmVlZGJhY2s6OTk5', total_comment_count: 1821, share_count_reduced: '9999' },
			fb_reel_react_button: { story: { id: otherSid, feedback: { id: 'ZmVlZGJhY2s6OTk5', unified_reactors: { count: 88888 } } } },
			post_id: '999',
		}, ext([OTHER])),
		// #81 - requested reel feedback (comments, shares, reactions)
		sjs('FBUnifiedVideoUFI', {
			id: sid,
			video: { id: REEL },
			attachments: [{ media: { __typename: 'Video', video_owner_type: 'FACEBOOK_USER', __isNode: 'Video', id: REEL, shareable_url: `https://www.facebook.com/reel/${REEL}` } }],
			feedback: { if_viewer_can_see_comments: { id: 'ZmVlZGJhY2s6MTIyMjE3NjY4NDYyOTAxNjA5' }, id: 'ZmVlZGJhY2s6MTIyMjE3NjY4NDYyOTAxNjA5', cross_universe_feedback_info: { aggregated_comment_count: null }, ...feedback },
			fb_reel_react_button: { story: { id: sid, feedback: { id: 'ZmVlZGJhY2s6MTIyMjE3NjY4NDYyOTAxNjA5', unified_reactors: reactors } } },
			post_id: '122217668462901609',
			url: `https://www.facebook.com/reel/${REEL}`,
		}, ext([REEL])),
	];
	return pageHtml(blocks);
}

function esc(s) {
	// Facebook encodes non-ASCII in meta content as hex entities (observed).
	return Array.from(s)
		.map((ch) => {
			const cp = ch.codePointAt(0);
			if (ch === '&') return '&amp;';
			if (ch === '"') return '&quot;';
			if (ch === '<') return '&lt;';
			if (ch === '>') return '&gt;';
			return cp > 127 ? `&#x${cp.toString(16)};` : ch;
		})
		.join('');
}

function anonymous() {
	const title = `22 tis. zhlédnutí · 1,4 tis. reakcí | ${CAPTION} | Zápisky z kuchyně`;
	const meta = [
		`<meta property="og:type" content="video.other" />`,
		`<meta property="og:title" content="${esc(title)}" />`,
		`<meta property="og:description" content="${esc(Array.from(CAPTION).slice(0, 200).join('') + '...')}" />`,
		`<meta property="og:url" content="https://www.facebook.com/${OWNER}/videos/tohle-je-ta-jedin%C3%A1-karamelov%C3%A1-om%C3%A1%C4%8Dka/${REEL}/" />`,
		`<meta property="og:image" content="${cdn('/v/t51.82787-15/OGTHUMB_n.jpg').replace(/&/g, '&amp;')}" />`,
		`<meta property="og:locale" content="en_US" />`,
	].join('\n');
	return pageHtml([], { userId: '0', meta });
}

const out = path.join(__dirname);
const files = {
	'reel-logged-in.html': loggedIn(),
	'reel-logged-in-no-stats.html': loggedIn({ feedback: { share_count_reduced: null }, reactors: null }),
	'reel-anonymous.html': anonymous(),
	// SYNTHETIC
	'reel-dash-only.html': loggedIn({ dash: true, progressive: false }),
	'reel-structure-changed.html': pageHtml([{ require: [['ServerJS', 'handle', null, [{ something: { totally: 'different' } }]]] }]),
	'content-unavailable.html': pageHtml([], { userId: VIEWER }).replace('<body>', "<body><span>This content isn't available right now</span>"),
	'logged-out-with-cookies.html': pageHtml([], { userId: '0' }),
	'rate-limited.html': pageHtml([], { userId: VIEWER }).replace('<body>', "<body><h2>You’re Temporarily Blocked</h2>"),
};
for (const [name, html] of Object.entries(files)) fs.writeFileSync(path.join(out, name), html);
console.log('written', Object.keys(files).join(', '));
