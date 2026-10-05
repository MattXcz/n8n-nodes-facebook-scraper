/**
 * Facebook post page parser (group posts, page/profile posts).
 *
 * Designed against a real logged-in response of
 * https://www.facebook.com/groups/bambulabczsk/permalink/1819897855848074/ (Oct 2026):
 *  - The post is a Relay `Story` node at `__bbox.result.data.node_v2` (and again in
 *    `data.node`) with `post_id`, `creation_time`, `actors[]`, `to` (Group),
 *    `attachments[]`, `permalink_url`, `seo_title`, and
 *    `comet_sections.content.story.message.text` (full text).
 *  - Stats live in Feedback objects whose base64 id decodes to `feedback:<post_id>`:
 *    `reaction_count.count`, `share_count.count`, `top_reactions.edges[]`,
 *    `comment_rendering_instance.comments.total_count`, `video_view_count`.
 *  - The first ranked comments are embedded as `Comment` nodes whose id decodes to
 *    `comment:<post_id>_<comment_id>`: `body.text`, `author.name`, `created_time`,
 *    `feedback.reactors.count_reduced`.
 *  - Group member ids are privacy tokens (`pfbid…`) and profile `url` is often null.
 * Anonymous response: no Relay post data, og:title = "<Group> | <text start> | Facebook",
 * og:description = text truncated with "...", og:image, og:url.
 */
import { IPostImage, IPostSummary, ITopComment, PostMediaType } from './types';
import { cdnUrlExpiry, decodeHtmlEntities, titleFromCaption, unixToIso, usernameFromProfileUrl } from './utils';
import { chooseVideo, extractJsonScripts, extractMeta, num, walk } from './parser';
import { FacebookScraperError } from './errors';

type Obj = Record<string, any>;

export interface PostParseOptions {
	/** Numeric post id or `pfbid…` token from the URL. */
	postId: string;
	inputUrl: string;
	authenticated: boolean;
	videoPreference?: 'progressive' | 'highest';
	now?: Date;
}

function b64(s: unknown): string {
	if (typeof s !== 'string' || s.length < 8 || !/^[A-Za-z0-9+/=_-]+$/.test(s)) return '';
	try {
		return Buffer.from(s, 'base64').toString('utf8');
	} catch {
		return '';
	}
}

const URL_KEYS = ['permalink_url', 'url', 'wwwURL', 'comet_permalink_url'];

/** Determines the numeric post_id of the requested post. */
function resolveTargetPostId(blocks: unknown[], requested: string): string | null {
	if (/^\d+$/.test(requested)) return requested;
	const byUrl = new Set<string>();
	const all = new Set<string>();
	for (const b of blocks) {
		walk(b, (o) => {
			if (typeof o.post_id !== 'string' || !/^\d+$/.test(o.post_id)) return;
			if (o.__typename === 'Story' || o.message !== undefined || o.attachments !== undefined) all.add(o.post_id);
			if (URL_KEYS.some((k) => typeof o[k] === 'string' && o[k].includes(requested))) byUrl.add(o.post_id);
		});
	}
	if (byUrl.size === 1) return [...byUrl][0];
	if (all.size === 1) return [...all][0];
	return null;
}

function bestImage(o: Obj): { url: string; width: number | null; height: number | null } | null {
	const cands = ['photo_image', 'full_image', 'viewer_image', 'large_share_image', 'image', 'imageHigh', 'massive_image']
		.map((k) => o[k])
		.filter((v) => v && typeof v.uri === 'string');
	if (!cands.length) return null;
	const best = cands.reduce((a, b) => ((num(b.width) ?? 0) * (num(b.height) ?? 0) > (num(a.width) ?? 0) * (num(a.height) ?? 0) ? b : a));
	return { url: best.uri, width: num(best.width), height: num(best.height) };
}

/** Walks attachments, but never into an `attached_story` (a shared, different post). */
function walkAttachments(story: Obj, visit: (o: Obj) => void): void {
	const visitTree = (node: unknown, depth = 0): void => {
		if (!node || typeof node !== 'object' || depth > 60) return;
		if (Array.isArray(node)) return node.forEach((n) => visitTree(n, depth + 1));
		const o = node as Obj;
		visit(o);
		for (const k in o) if (k !== 'attached_story' && k !== 'feedback' && k !== 'comet_sections') visitTree(o[k], depth + 1);
	};
	visitTree(story.attachments);
}

function unwrapLinkShim(url: string): string {
	try {
		const u = new URL(url);
		if (/^l[m]?\.facebook\.com$/i.test(u.hostname) && u.searchParams.get('u')) return u.searchParams.get('u') as string;
	} catch {
		/* ignore */
	}
	return url;
}

export function parsePostPage(html: string, opts: PostParseOptions): IPostSummary {
	const blocks = extractJsonScripts(html);
	const meta = extractMeta(html);
	const target = resolveTargetPostId(blocks, opts.postId);

	const stories: Obj[] = [];
	const feedbacks: Obj[] = [];
	const comments: Obj[] = [];
	const dashByVideo = new Map<string, Obj[]>();

	for (const b of blocks) {
		walk(b, (o) => {
			if (target && o.post_id === target && (o.__typename === 'Story' || o.message !== undefined || o.attachments !== undefined || o.actors !== undefined)) {
				stories.push(o);
			}
			if (target && o.__typename !== 'Comment' && b64(o.id) === `feedback:${target}`) feedbacks.push(o);
			if (target && o.__typename === 'Comment' && b64(o.id).startsWith(`comment:${target}_`) && (o.depth === undefined || o.depth === 0)) comments.push(o);
			if (Array.isArray(o.all_video_dash_prefetch_representations)) {
				for (const r of o.all_video_dash_prefetch_representations) {
					if (r?.video_id && Array.isArray(r.representations)) {
						dashByVideo.set(String(r.video_id), [...(dashByVideo.get(String(r.video_id)) ?? []), ...r.representations]);
					}
				}
			}
		});
	}

	// ---- text, date, author, group
	let text: string | null = null;
	let created: number | null = null;
	let actor: Obj | null = null;
	let group: Obj | null = null;
	let permalink: string | null = null;
	let seoTitle: string | null = null;
	let textOnly = false;
	for (const s of stories) {
		const t = s.message?.text;
		if (typeof t === 'string' && (text === null || t.length > text.length)) text = t;
		created = created ?? num(s.creation_time);
		if (!actor && Array.isArray(s.actors) && s.actors[0]?.name) actor = s.actors[0];
		if (!group && s.to?.__typename === 'Group') group = s.to;
		if (!group && s.target_group?.id) group = s.target_group;
		permalink = permalink ?? s.permalink_url ?? null;
		seoTitle = seoTitle ?? (typeof s.seo_title === 'string' ? s.seo_title : null);
		if (s.is_text_only_story === true) textOnly = true;
	}
	if (!actor) for (const f of feedbacks) if (f.owning_profile?.name) { actor = f.owning_profile; break; }

	// ---- stats
	let likes: number | null = null;
	let commentsCount: number | null = null;
	let shares: number | null = null;
	let views: number | null = null;
	for (const f of feedbacks) {
		likes = likes ?? num(f.reaction_count?.count) ?? num(f.unified_reactors?.count) ?? num(f.i18n_reaction_count);
		shares = shares ?? num(f.share_count?.count) ?? num(f.i18n_share_count);
		commentsCount =
			commentsCount ??
			num(f.comment_rendering_instance?.comments?.total_count) ??
			num(f.total_comment_count) ??
			num(f.comments_count_summary_renderer?.feedback?.comment_rendering_instance?.comments?.total_count);
		// Facebook reports video_view_count: 0 for group videos where views are not shown -> treat 0 as unknown.
		const v = num(f.video_view_count);
		if (views === null && v !== null && v > 0) views = v;
	}

	// ---- top comment (first ranked top-level comment embedded in the page)
	let topComment: ITopComment | null = null;
	const c0 = comments.find((c) => c.body?.text || c.preferred_body?.text);
	if (c0) {
		topComment = {
			text: c0.body?.text ?? c0.preferred_body?.text,
			author: c0.author?.name ?? '',
			likeCount: num(c0.feedback?.reactors?.count) ?? num(c0.feedback?.reactors?.count_reduced),
		};
	}

	// ---- attachments: photos, video, link
	const images = new Map<string, IPostImage>();
	const videos: Obj[] = [];
	let linkUrl: string | null = null;
	let linkTitle: string | null = null;
	let videoThumb: string | null = null;
	const seenStory = new Set<Obj>();
	for (const s of stories) {
		if (!Array.isArray(s.attachments) || seenStory.has(s)) continue;
		seenStory.add(s);
		walkAttachments(s, (o) => {
			if (o.__typename === 'Photo') {
				const img = bestImage(o);
				if (img) {
					const key = String(o.id ?? img.url);
					const prev = images.get(key);
					if (!prev || (img.width ?? 0) > (prev.width ?? 0)) {
						images.set(key, { id: o.id ? String(o.id) : null, ...img, alt: o.accessibility_caption ?? prev?.alt ?? null });
					}
				}
			}
			if (o.__typename === 'Video' && o.id) {
				videos.push(o);
				videoThumb = videoThumb ?? o.preferred_thumbnail?.image?.uri ?? o.thumbnailImage?.uri ?? o.image?.uri ?? null;
			}
			const att = o.styles?.attachment ?? (o.__typename === 'StoryAttachment' ? o : null);
			if (att && typeof att.url === 'string' && !linkUrl) {
				const real = unwrapLinkShim(att.url);
				if (!/^https?:\/\/(?:[a-z]+\.)?facebook\.com\//i.test(real)) {
					linkUrl = real;
					linkTitle = att.title_with_entities?.text ?? att.title ?? null;
				}
			}
		});
	}
	const videoIds = [...new Set(videos.map((v) => String(v.id)))];
	const video = chooseVideo(videos, videoIds.flatMap((id) => dashByVideo.get(id) ?? []), opts.videoPreference ?? 'progressive');

	// ---- og fallback (only if og:url points to this post)
	const ogUrl = meta['og:url'] ?? '';
	const ogBelongs = !!(meta['og:title'] || meta['og:description']) && (ogUrl.includes(opts.postId) || (!!target && ogUrl.includes(target)));
	const hasRelay = stories.length > 0;
	if (!hasRelay && !ogBelongs) {
		throw new FacebookScraperError(
			'PAGE_STRUCTURE_CHANGED',
			`No data for post ${opts.postId} found in the page (${blocks.length} JSON blocks).`,
		);
	}

	let descriptionTruncated = false;
	let ogGroupName: string | null = null;
	let ogTitleText: string | null = null;
	if (ogBelongs && meta['og:title']) {
		const parts = meta['og:title'].split(' | ');
		if (parts[parts.length - 1] === 'Facebook') parts.pop();
		if (parts.length >= 2 && /\/groups\//.test(ogUrl)) ogGroupName = parts.shift() ?? null;
		ogTitleText = parts.join(' | ') || null;
	}
	if (text === null && ogBelongs) {
		const d = meta['og:description'] ?? null;
		if (d) {
			text = d;
			descriptionTruncated = /(\.\.\.|…)\s*$/.test(d);
		}
	}

	const images_ = [...images.values()];
	let mediaType: PostMediaType = 'unknown';
	if (videos.length) mediaType = 'video';
	else if (images_.length > 1) mediaType = 'album';
	else if (images_.length === 1) mediaType = 'photo';
	else if (linkUrl) mediaType = 'link';
	else if (hasRelay && (textOnly || stories.every((s) => !Array.isArray(s.attachments) || s.attachments.length === 0))) mediaType = 'text';
	else if (!hasRelay && meta['og:type'] === 'video.other') mediaType = 'video';

	const thumbnail = images_[0]?.url ?? videoThumb ?? (ogBelongs ? meta['og:image'] ?? null : null);
	const authorUrl: string | null = actor?.url ?? null;
	const groupUrl: string | null = group?.url ?? (opts.inputUrl.match(/https?:\/\/[^/]+\/groups\/[^/]+\//)?.[0] ?? null);
	const usedOg = ogBelongs && (!hasRelay || (!images_.length && !videoThumb && !!thumbnail));

	return {
		id: target ?? opts.postId,
		url: permalink ?? (ogBelongs && ogUrl ? decodeHtmlEntities(ogUrl) : opts.inputUrl),
		title: seoTitle ?? ogTitleText ?? titleFromCaption(text),
		description: text,
		thumbnail,
		videoUrl: video.videoUrl,
		likeCount: likes,
		commentCount: commentsCount,
		viewCount: views,
		topComment,
		author: usernameFromProfileUrl(authorUrl),
		authorFullName: actor?.name ?? null,
		takenAt: unixToIso(created),
		mediaType,
		isVideo: mediaType === 'video',

		inputUrl: opts.inputUrl,
		shareCount: shares,
		images: images_,
		authorId: actor?.id ? String(actor.id) : null,
		authorUrl,
		groupId: group?.id ? String(group.id) : null,
		groupName: group?.name ?? ogGroupName,
		groupUrl,
		linkUrl,
		linkTitle,
		descriptionTruncated,
		videoUrlExpiresAt: cdnUrlExpiry(video.videoUrl),
		statsSource: likes !== null || commentsCount !== null || shares !== null ? 'relay' : null,
		dataSource: hasRelay ? (usedOg ? 'relay+og' : 'relay') : 'og',
		authenticated: opts.authenticated,
		fetchedAt: (opts.now ?? new Date()).toISOString(),
	};
}
