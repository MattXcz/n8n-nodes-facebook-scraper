/**
 * Anonymized fixtures for POST pages.
 *
 * Source (real, captured 2026-10-05, logged-in desktop browser + anonymous request):
 *   https://www.facebook.com/groups/bambulabczsk/permalink/1819897855848074/  (group post with video)
 *   https://www.facebook.com/groups/bambulabczsk/posts/1819812229189970/      (group text-only post)
 * Copied 1:1: key names and nesting (data.node_v2 Story, comet_sections.content.story.message,
 * feedback ids = base64("feedback:<post_id>"), Comment ids = base64("comment:<post>_<id>"),
 * reaction_count / share_count / comment_rendering_instance, `to` Group, og tags format).
 * Anonymized: person names -> "Osoba N", pfbid tokens, fbcdn signatures, comment texts, viewer id.
 * SYNTHETIC (not observed live yet): photo album, link post, shared post (attached_story), pfbid URL.
 *
 *   node test/fixtures/generate-posts.js
 */
const fs = require('fs');
const path = require('path');

const VIEWER = '100000000000001';
const GROUP = { __typename: 'Group', __isActor: 'Group', id: '891472575357278', name: 'Bambu Lab CZ/SK', url: 'https://www.facebook.com/groups/bambulabczsk/' };
const OE = '6A000000';
const cdn = (p) => `https://scontent.fprg6-1.fna.fbcdn.net${p}?_nc_cat=1&ccb=1-7&oh=00_ANON&oe=${OE}`;
const b64 = (s) => Buffer.from(s).toString('base64');
const storyId = (pid) => b64(`S:_I1480308703:VK:${pid}`);
const author = { __typename: 'User', name: 'Osoba 1', id: 'pfbid0ANONAUTHOR1', __isActor: 'User', url: null };

const VIDEO_TEXT =
	'Už jste zkoušeli tu novou funkci v Bambu Studio na vynechání zbytečných vrstev v čistící věži? Za mě naprosto parádní věc která ušetří i čas i materiál. Má to tedy i nějaké nevýhody, jako je například to že musíte mít kolem modelů a věže spoustu místa, nebo maximální možná výška objektu. Ale na postavy kde tiskenete třeba jen oči a nos jinou barvou je to super.';
const TEXT_ONLY = 'Dobrý den,\nNeprodává náhodou někdo prázdné Bambu cívky? Koupil bych tak 10 ks. Prosím nabídněte. Děkuji 🙏\nMartin';

function wrap(data, extensions = {}) {
	return {
		require: [['ScheduledServerJS', 'handle', null, [{ __bbox: { require: [['RelayPrefetchedStreamCache', 'next', [], ['adp_CometGroupPermalinkRootContentQuery_anon', { __bbox: { complete: false, result: { data, extensions: { ...extensions, is_final: true } }, sequence_number: 0 } }]]] } }]]],
	};
}

function comment(pid, cid, name, text, likes, depth = 0) {
	return {
		id: b64(`comment:${pid}_${cid}`),
		feedback: { id: b64(`feedback:${pid}_${cid}`), reactors: { count_reduced: String(likes) }, __typename: 'Feedback' },
		legacy_fbid: cid,
		depth,
		body: { text, ranges: [] },
		author: { __typename: 'User', id: 'pfbidANONC' + cid, name, url: null },
		created_time: 1791199474,
		preferred_body: { __typename: 'TextWithEntities', text, translation_type: 'ORIGINAL' },
		__typename: 'Comment',
	};
}

function feedbackTarget(pid, { reactions, shares, comments, edges, views = 0 }) {
	const fid = b64(`feedback:${pid}`);
	return {
		associated_group: { id: GROUP.id },
		id: fid,
		subscription_target_id: pid,
		comment_list_renderer: {
			__typename: 'XFBCommentListRendererForCommentsAPIPermalink',
			feedback: {
				comment_rendering_instance: comments === null ? null : { comments: { total_count: comments } },
				comment_rendering_instance_for_feed_location: { comments: { count: edges.length, total_count: comments, edges: edges.map((n) => ({ node: n, cursor: null })) } },
				id: fid,
				__typename: 'Feedback',
			},
		},
		comet_ufi_summary_and_actions_renderer: {
			__typename: 'UnauthenticatedUCometUFISummaryAndActionsRenderer',
			feedback: {
				id: fid,
				subscription_target_id: pid,
				i18n_reaction_count: reactions === null ? null : String(reactions),
				reaction_count: reactions === null ? null : { count: reactions, is_empty: reactions === 0 },
				top_reactions: { count: 1, edges: reactions ? [{ node: { id: '1635855486666999', localized_name: 'To se mi líbí' }, i18n_reaction_count: String(reactions), reaction_count: reactions }] : [] },
				i18n_share_count: shares === null ? null : String(shares),
				share_count: shares === null ? null : { count: shares, is_empty: shares === 0 },
				comments_count_summary_renderer: { __typename: 'TotalCommentsCountSummaryRenderer', feedback: { id: fid, comment_rendering_instance: comments === null ? null : { comments: { total_count: comments } } } },
				video_view_count: views,
			},
		},
		owning_profile: { __typename: 'User', name: author.name, id: author.id },
		top_level_comments: null,
	};
}

function story(pid, { text, attachments = [], textOnly = false, stats, attached_story = null, permalinkKind = 'posts' }) {
	const sid = storyId(pid);
	const permalink = `https://www.facebook.com/groups/bambulabczsk/${permalinkKind}/${pid}/`;
	const msg = text === null ? null : { text, ranges: [] };
	return {
		__typename: 'Story',
		__isFeedUnit: 'Story',
		actors: [author],
		creation_time: 1791194007,
		seo_title: text ? text.split(/[\n?]/)[0] : null,
		post_id: pid,
		id: sid,
		feedback: { associated_group: { id: GROUP.id }, id: b64(`feedback:${pid}`), owning_profile: { __typename: 'User', name: author.name, id: author.id } },
		attachments,
		attached_story,
		comet_sections: {
			__typename: 'CometFeedStoryCometSections',
			content: {
				story: {
					feedback: { id: b64(`feedback:${pid}`) },
					comet_sections: {
						message: { story: { id: sid, url: permalink, is_text_only_story: textOnly, message: msg, permalink_url: `https://www.facebook.com/groups/bambulabczsk/posts/${pid}/` } },
						message_container: { story: { message: msg, id: sid } },
					},
					attachments,
					post_id: pid,
					actors: [author],
					message: msg,
					wwwURL: permalink,
					target_group: { __typename: 'Group', id: GROUP.id },
					attached_story,
					id: sid,
				},
			},
			feedback: {
				story: {
					story_ufi_container: {
						story: {
							is_text_only_story: textOnly,
							feedback_context: { feedback_target_with_context: feedbackTarget(pid, stats) },
							id: sid,
							url: permalink,
							post_id: pid,
							target_group: { __typename: 'Group', id: GROUP.id },
							message: msg,
							actors: [author],
							view_count: null,
						},
					},
				},
			},
		},
		permalink_url: `https://www.facebook.com/groups/bambulabczsk/posts/${pid}/`,
		to: GROUP,
	};
}

function videoAttachment(vid) {
	const media = {
		__typename: 'Video',
		thumbnailImage: { uri: cdn(`/v/t15.5256-10/VTHUMB_${vid}_n.jpg`) },
		id: vid,
		owner: { __typename: 'User', id: author.id },
		playable_duration_in_ms: 25518,
		recipient_group: { __typename: 'Group', id: GROUP.id },
		videoId: vid,
		publish_time: 1791194001,
		width: 576,
		height: 1024,
		permalink_url: `https://www.facebook.com/osoba.1/videos/${vid}/`,
		videoDeliveryLegacyFields: {
			dash_manifest_xml_string: '<?xml version="1.0"?><MPD><Period><AdaptationSet contentType="video"/></Period></MPD>',
			dash_manifest_url: `https://www.facebook.com/dash_mpd_debug.mpd?v=${vid}&dummy=.mpd`,
			browser_native_sd_url: `https://video.fprg6-1.fna.fbcdn.net/o1/v/t2/f2/m412/SD_${vid}.mp4?_nc_cat=1&oe=${OE}`,
			browser_native_hd_url: `https://video.fprg6-1.fna.fbcdn.net/o1/v/t2/f2/m366/HD_${vid}.mp4?_nc_cat=1&oe=${OE}`,
			id: vid,
		},
		videoDeliveryResponseFragment: null,
		preferred_thumbnail: { image: { uri: cdn(`/v/t15.5256-10/PTHUMB_${vid}_n.jpg`) }, id: '2333420140527424' },
		video_container_type: 'GROUP_POST',
		__isNode: 'Video',
	};
	return [{
		deduplication_key: 'd7704f6bb1e581218a159eeb88c7c8c0',
		target: { __typename: 'Video', id: vid },
		__typename: 'StoryAttachment',
		style_list: ['video_autoplay', 'video_inline', 'video', 'fallback'],
		styles: { __typename: 'StoryAttachmentVideoStyleRenderer', attachment: { url: `https://www.facebook.com/osoba.1/videos/${vid}/`, media } },
		media: { __typename: 'Video', id: vid, __isNode: 'Video' },
	}];
}

function photo(id, w = 2048, h = 1536) {
	return {
		__typename: 'Photo',
		id,
		accessibility_caption: `Může jít o obrázek 3D tiskárny (${id})`,
		image: { uri: cdn(`/v/t39.30808-6/SMALL_${id}_n.jpg`), width: 526, height: 394 },
		photo_image: { uri: cdn(`/v/t39.30808-6/FULL_${id}_n.jpg`), width: w, height: h },
		viewer_image: { uri: cdn(`/v/t39.30808-6/VIEW_${id}_n.jpg`), width: 1440, height: 1080 },
	};
}

function albumAttachment(ids) {
	return [{
		__typename: 'StoryAttachment',
		style_list: ['album', 'fallback'],
		styles: {
			__typename: 'StoryAttachmentAlbumStyleRenderer',
			attachment: { url: 'https://www.facebook.com/media/set/?set=pcb.111', all_subattachments: { count: ids.length, nodes: ids.map((id) => ({ media: photo(id), url: `https://www.facebook.com/photo/?fbid=${id}` })) } },
		},
	}];
}

function linkAttachment() {
	return [{
		__typename: 'StoryAttachment',
		style_list: ['share', 'fallback'],
		styles: {
			__typename: 'StoryAttachmentShareStyleRenderer',
			attachment: {
				url: 'https://l.facebook.com/l.php?u=https%3A%2F%2Fwiki.bambulab.com%2Fcs%2Fsoftware%2Fbambu-studio%2Fprime-tower&h=AT0anon&s=1',
				title_with_entities: { text: 'Prime tower – Bambu Lab Wiki' },
				media: { __typename: 'GenericAttachmentMedia', image: { uri: cdn('/v/t39.30808-6/LINKIMG_n.jpg'), width: 1200, height: 630 } },
			},
		},
	}];
}

function page(stories, { userId = VIEWER, meta = '', ext = {} } = {}) {
	const blocks = stories.map((s) => wrap({ node_v2: s }, ext));
	const scripts = blocks.map((b) => `<script type="application/json" data-sjs>${JSON.stringify(b)}</script>`).join('\n');
	return `<!DOCTYPE html><html lang="cs"><head><meta charset="utf-8" /><title>Bambu Lab CZ/SK | Facebook</title>${meta}</head><body>
<script type="application/json" data-sjs>{"require":[["ServerJS","handle",null,[{"define":[["CurrentUserInitialData",[],{"ACCOUNT_ID":"${userId}","USER_ID":"${userId}","NAME":"Anon"},270]]}]]]}</script>
${scripts}
</body></html>`;
}

function esc(s) {
	return Array.from(s).map((ch) => (ch === '&' ? '&amp;' : ch === '"' ? '&quot;' : ch.codePointAt(0) > 127 ? `&#x${ch.codePointAt(0).toString(16)};` : ch)).join('');
}

const VID_PID = '1819897855848074';
const TXT_PID = '1819812229189970';

const files = {
	// real structure
	'post-group-video.html': page([
		story(VID_PID, {
			text: VIDEO_TEXT,
			attachments: videoAttachment('2084751125578123'),
			permalinkKind: 'permalink',
			stats: {
				reactions: 26, shares: 0, comments: 17, views: 0,
				edges: [
					comment(VID_PID, '1819956962508830', 'Osoba 3', 'Taky se to dozvídám až teď. Na dvoubarevné modely použiju druhou trysku, ale tohle se hodí od tří barev.', 0),
					comment(VID_PID, '1819956962508831', 'Osoba 4', 'Super tip, díky! 👍', 2),
					comment(VID_PID, '1819956962508832', 'Osoba 5', 'Odpověď ve vlákně', 0, 1),
				],
			},
		}),
	]),
	'post-group-text.html': page([
		story(TXT_PID, { text: TEXT_ONLY, textOnly: true, stats: { reactions: 0, shares: 0, comments: 2, edges: [comment(TXT_PID, '1819963352508191', 'Osoba 6', 'Napiš do zpráv.', 1)] } }),
	]),
	'post-group-anonymous.html': page([], {
		userId: '0',
		meta: [
			`<meta property="og:type" content="video.other" />`,
			`<meta property="og:title" content="${esc('Bambu Lab CZ/SK | Už jste zkoušeli tu novou funkci v Bambu Studio na vynechání zbytečných vrstev v čistící věži | Facebook')}" />`,
			`<meta property="og:description" content="${esc(VIDEO_TEXT.slice(0, 190) + '...')}" />`,
			`<meta property="og:url" content="https://www.facebook.com/groups/bambulabczsk/posts/${VID_PID}/" />`,
			`<meta property="og:image" content="${cdn('/v/t15.5256-10/OGTHUMB_n.jpg').replace(/&/g, '&amp;')}" />`,
		].join('\n'),
	}),
	// SYNTHETIC
	'post-album.html': page([story('1820000000000001', { text: 'Moje první tisky 😊\nPLA + PETG', attachments: albumAttachment(['901', '902', '903']), stats: { reactions: 12, shares: 1, comments: 3, edges: [] } })]),
	'post-link.html': page([story('1820000000000002', { text: 'Návod na prime tower:', attachments: linkAttachment(), stats: { reactions: null, shares: null, comments: null, edges: [] } })]),
	'post-shared.html': page([
		story('1820000000000003', {
			text: 'Sdílím zajímavý příspěvek',
			attachments: [],
			attached_story: { __typename: 'Story', post_id: '555555555555555', message: { text: 'PŮVODNÍ PŘÍSPĚVEK – nesmí být v popisu' }, attachments: albumAttachment(['999']) },
			stats: { reactions: 5, shares: 0, comments: 0, edges: [] },
		}),
	]),
};
for (const [name, html] of Object.entries(files)) fs.writeFileSync(path.join(__dirname, name), html);
console.log('written', Object.keys(files).join(', '));
