/**
 * Facebook Reel page parser.
 *
 * Designed against real www.facebook.com/reel/<id> responses (Oct 2026):
 *
 * 1. Logged-in page: the Reel data is NOT in Open Graph tags. It is embedded in
 *    ~100 `<script type="application/json" data-sjs>` blocks as Relay
 *    "RelayPrefetchedStreamCache" payloads: `...__bbox.result.data`. The page
 *    contains the requested Reel AND the next recommended Reels in the same
 *    structures, so every object is matched by the Reel id:
 *      - Video node (`__typename: "Video"`, `id: <reelId>`) holds
 *        videoDeliveryResponseFragment.videoDeliveryResponseResult
 *        { progressive_urls[{progressive_url, metadata.quality: HD|SD}],
 *          dash_manifests[{manifest_xml}], dash_manifest_urls, hls_playlist_urls },
 *        preferred_thumbnail.image.uri, width, height, length_in_second, owner.
 *      - Story node whose attachments[].media.id === reelId holds
 *        message.text, creation_time, post_id, actors, feedback{...}.
 *      - fb_reel_react_button.story.feedback.unified_reactors.count = reactions.
 *      - extensions.all_video_dash_prefetch_representations[{video_id, representations}]
 *        holds DASH tracks (video-only + audio-only, separate files).
 * 2. Anonymous page: no Relay video data, but og:title has
 *    "<views> · <reactions> | <full caption> | <author name>" (localized, rounded),
 *    og:image = thumbnail, og:description = truncated caption.
 */
import { IReelSummary, ITopComment } from './types';
import {
	canonicalReelUrl,
	cdnUrlExpiry,
	decodeHtmlEntities,
	parseCompactNumber,
	titleFromCaption,
	unixToIso,
	usernameFromProfileUrl,
} from './utils';
import { FacebookScraperError } from './errors';

type Obj = Record<string, any>;

export interface ParseOptions {
	reelId: string;
	inputUrl: string;
	authenticated: boolean;
	/** 'progressive' (default): MP4 with audio. 'highest': best resolution, possibly video-only DASH. */
	videoPreference?: 'progressive' | 'highest';
	now?: Date;
}

export interface PageSignals {
	loginWall: boolean;
	checkpoint: boolean;
	rateLimited: boolean;
	unavailable: boolean;
	pageUserId: string | null;
}

// ---------------------------------------------------------------- extraction

export function extractJsonScripts(html: string): unknown[] {
	const out: unknown[] = [];
	const re = /<script\b[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/gi;
	let m: RegExpExecArray | null;
	while ((m = re.exec(html))) {
		const body = m[1].trim();
		if (!body || (body[0] !== '{' && body[0] !== '[')) continue;
		try {
			out.push(JSON.parse(body));
		} catch {
			/* ignore malformed block */
		}
	}
	return out;
}

export function extractMeta(html: string): Record<string, string> {
	const meta: Record<string, string> = {};
	const re = /<meta\b([^>]*)>/gi;
	let m: RegExpExecArray | null;
	while ((m = re.exec(html))) {
		const attrs = m[1];
		const key = (attrs.match(/\b(?:property|name)="([^"]+)"/i) || [])[1];
		const content = (attrs.match(/\bcontent="([^"]*)"/i) || [])[1];
		if (key && content !== undefined && !(key in meta)) meta[key] = decodeHtmlEntities(content);
	}
	return meta;
}

export function walk(node: unknown, visit: (o: Obj) => void, depth = 0): void {
	if (!node || typeof node !== 'object' || depth > 200) return;
	if (Array.isArray(node)) {
		for (const v of node) walk(v, visit, depth + 1);
		return;
	}
	visit(node as Obj);
	for (const k in node as Obj) walk((node as Obj)[k], visit, depth + 1);
}

function mediaIdsOf(story: Obj): string[] {
	const ids: string[] = [];
	if (Array.isArray(story.attachments)) {
		for (const a of story.attachments) {
			const id = a?.media?.id ?? a?.styles?.attachment?.media?.id;
			if (id) ids.push(String(id));
		}
	}
	if (story.video?.id) ids.push(String(story.video.id));
	return ids;
}

/** Story ids look like base64("S:_I<owner>:VK:<videoId>") - decode as an extra ownership check. */
function storyIdMentions(storyId: unknown, reelId: string): boolean {
	if (typeof storyId !== 'string' || storyId.length < 8) return false;
	try {
		return Buffer.from(storyId, 'base64').toString('utf8').includes(`:${reelId}`);
	} catch {
		return false;
	}
}

interface Collected {
	videos: Obj[];
	stories: Obj[];
	dashReps: Obj[];
	totalVideoNodes: number;
	otherVideoIds: Set<string>;
}

export function collectReelObjects(blocks: unknown[], reelId: string): Collected {
	const c: Collected = { videos: [], stories: [], dashReps: [], totalVideoNodes: 0, otherVideoIds: new Set() };
	for (const block of blocks) {
		walk(block, (o) => {
			if (o.__typename === 'Video' && o.id !== undefined) {
				c.totalVideoNodes++;
				if (String(o.id) === reelId) c.videos.push(o);
				else c.otherVideoIds.add(String(o.id));
			}
			if (Array.isArray(o.all_video_dash_prefetch_representations)) {
				for (const r of o.all_video_dash_prefetch_representations) {
					if (r && String(r.video_id) === reelId && Array.isArray(r.representations)) {
						c.dashReps.push(...r.representations);
					}
				}
			}
			const looksLikeStory =
				o.creation_time !== undefined || o.message !== undefined || o.feedback !== undefined || o.fb_reel_react_button !== undefined;
			if (looksLikeStory) {
				const ids = mediaIdsOf(o);
				const mine = ids.length > 0 ? ids.every((id) => id === reelId) : storyIdMentions(o.id, reelId);
				if (mine) c.stories.push(o);
			}
			if (o.creation_story && o.id !== undefined && String(o.id) === reelId) {
				c.stories.push(o.creation_story);
			}
		});
	}
	return c;
}

function first<T>(values: Array<T | null | undefined>): T | null {
	for (const v of values) if (v !== null && v !== undefined && (v as unknown) !== '') return v;
	return null;
}

export function num(v: unknown): number | null {
	if (typeof v === 'number' && Number.isFinite(v)) return v;
	if (typeof v === 'string' && v.trim() !== '') return parseCompactNumber(v);
	return null;
}

// ---------------------------------------------------------------- video selection

interface VideoChoice {
	videoUrl: string | null;
	quality: string | null;
	type: 'progressive' | 'dash' | null;
	hasSeparateAudio: boolean | null;
	audioUrl: string | null;
	hd: string | null;
	sd: string | null;
	dashManifestUrl: string | null;
}

interface DashTrack {
	url: string;
	mime: string;
	bandwidth: number;
	width: number;
	height: number;
	label: string | null;
}

export function parseDashManifest(xml: string): DashTrack[] {
	const tracks: DashTrack[] = [];
	const re = /<Representation\b([^>]*)>([\s\S]*?)<\/Representation>/gi;
	let m: RegExpExecArray | null;
	while ((m = re.exec(xml))) {
		const attr = (n: string) => (m![1].match(new RegExp(`\\b${n}="([^"]*)"`, 'i')) || [])[1];
		const base = (m[2].match(/<BaseURL>([^<]+)<\/BaseURL>/i) || [])[1];
		if (!base) continue;
		tracks.push({
			url: decodeHtmlEntities(base.trim()),
			mime: attr('mimeType') || '',
			bandwidth: Number(attr('bandwidth')) || 0,
			width: Number(attr('width')) || 0,
			height: Number(attr('height')) || 0,
			label: attr('FBQualityLabel') || null,
		});
	}
	return tracks;
}

function repsToTracks(reps: Obj[]): DashTrack[] {
	return reps
		.filter((r) => typeof r.base_url === 'string' && /^https?:\/\//.test(r.base_url) && r.base_url.includes('?'))
		.map((r) => ({
			url: r.base_url,
			mime: String(r.mime_type || ''),
			bandwidth: Number(r.bandwidth) || 0,
			width: Number(r.width) || 0,
			height: Number(r.height) || 0,
			label: r.height ? `${Math.min(Number(r.width) || 0, Number(r.height))}p` : null,
		}));
}

function bestTrack(tracks: DashTrack[], kind: 'video' | 'audio'): DashTrack | null {
	const list = tracks.filter((t) => t.mime.startsWith(kind));
	if (!list.length) return null;
	return list.reduce((a, b) => (b.width * b.height > a.width * a.height || (b.width * b.height === a.width * a.height && b.bandwidth > a.bandwidth) ? b : a));
}

export function chooseVideo(videos: Obj[], dashReps: Obj[], preference: 'progressive' | 'highest'): VideoChoice {
	let hd: string | null = null;
	let sd: string | null = null;
	let manifestXml: string | null = null;
	let manifestUrl: string | null = null;

	for (const v of videos) {
		const res = v.videoDeliveryResponseFragment?.videoDeliveryResponseResult ?? v.videoDeliveryResponseResult;
		for (const p of res?.progressive_urls ?? []) {
			if (!p?.progressive_url || p.failure_reason) continue;
			const q = String(p.metadata?.quality ?? '').toUpperCase();
			if (q === 'HD') hd = hd ?? p.progressive_url;
			else sd = sd ?? p.progressive_url;
		}
		for (const d of res?.dash_manifests ?? []) if (d?.manifest_xml && !manifestXml) manifestXml = d.manifest_xml;
		for (const d of res?.dash_manifest_urls ?? []) if (d?.manifest_url && !manifestUrl) manifestUrl = d.manifest_url;
		// Legacy field names (older Comet builds / other surfaces)
		const legacy = v.videoDeliveryLegacyFields ?? v;
		hd = hd ?? legacy.browser_native_hd_url ?? legacy.playable_url_quality_hd ?? null;
		sd = sd ?? legacy.browser_native_sd_url ?? legacy.playable_url ?? null;
		manifestXml = manifestXml ?? legacy.dash_manifest ?? legacy.dash_manifest_xml_string ?? null;
		manifestUrl = manifestUrl ?? legacy.dash_manifest_url ?? null;
	}

	let tracks = manifestXml ? parseDashManifest(manifestXml) : [];
	if (!tracks.length) tracks = repsToTracks(dashReps);
	const bv = bestTrack(tracks, 'video');
	const ba = bestTrack(tracks, 'audio');

	const base = { hd, sd, dashManifestUrl: manifestUrl };
	const progressive = hd ?? sd;
	const dashBetter = bv && preference === 'highest';

	if (progressive && !dashBetter) {
		return { ...base, videoUrl: progressive, quality: hd ? 'HD' : 'SD', type: 'progressive', hasSeparateAudio: false, audioUrl: ba?.url ?? null };
	}
	if (bv) {
		return {
			...base,
			videoUrl: bv.url,
			quality: bv.label ?? (bv.height ? `${Math.min(bv.width, bv.height)}p` : null),
			type: 'dash',
			hasSeparateAudio: !!ba,
			audioUrl: ba?.url ?? null,
		};
	}
	return { ...base, videoUrl: null, quality: null, type: null, hasSeparateAudio: null, audioUrl: null };
}

// ---------------------------------------------------------------- og fallback

const VIEW_WORDS = /(zhlédnutí|zhlédnutí|zobrazení|views?|plays?|aufrufe|wyświetle\S*|vues?|visualizaciones|reproducciones|visualizzazioni)/i;
const REACT_WORDS = /(reakc\S*|reactions?|reaktionen|reakcj\S*|réactions?|reacciones|reazioni|likes?)/i;
const COMMENT_WORDS = /(komentář\S*|komentar\S*|comments?|kommentare|commentaires?|comentarios)/i;

export interface OgStats {
	views: number | null;
	reactions: number | null;
	comments: number | null;
	caption: string | null;
	author: string | null;
}

/** Parses "22 tis. zhlédnutí · 1,4 tis. reakcí | <caption> | <author>". */
export function parseOgTitle(title: string | undefined): OgStats {
	const res: OgStats = { views: null, reactions: null, comments: null, caption: null, author: null };
	if (!title) return res;
	const parts = title.split(' | ');
	let rest = parts;
	if (parts.length >= 2 && /\d/.test(parts[0]) && (VIEW_WORDS.test(parts[0]) || REACT_WORDS.test(parts[0]))) {
		for (const seg of parts[0].split(/\s*·\s*/)) {
			const m = seg.match(/^([\d\s .,]+(?:\s*(?:tis\.|mil\.|mld\.|[kmb]))?)\s*(.+)$/i);
			if (!m) continue;
			const n = parseCompactNumber(m[1]);
			if (VIEW_WORDS.test(m[2])) res.views = n;
			else if (REACT_WORDS.test(m[2])) res.reactions = n;
			else if (COMMENT_WORDS.test(m[2])) res.comments = n;
		}
		rest = parts.slice(1);
	}
	if (rest.length >= 2) {
		res.author = rest[rest.length - 1].trim() || null;
		res.caption = rest.slice(0, -1).join(' | ');
	} else if (rest.length === 1 && rest !== parts) {
		res.caption = rest[0];
	}
	return res;
}

// ---------------------------------------------------------------- page signals

export function detectPageSignals(html: string, finalUrl: string): PageSignals {
	const url = finalUrl.toLowerCase();
	const pageUserId = (html.match(/"USER_ID":"(\d+)"/) || [])[1] ?? null;
	return {
		checkpoint: /\/checkpoint\//.test(url) || /"checkpoint_?(?:required|url)"|id="checkpointSubmitButton"/i.test(html),
		loginWall:
			/\/login(?:\.php|\/)?/.test(url) ||
			(/id="login_form"|name="login_source"/i.test(html) && !/<meta property="og:(?:title|description)"/i.test(html) && !/"post_id":"\d+"/.test(html)),
		rateLimited:
			/You(?:’|'|&#x2019;)re Temporarily Blocked|Dočasně (?:jste )?zablokován|It looks like you were misusing this feature|You can't use this feature right now/i.test(
				html,
			),
		unavailable:
			/This content isn(?:’|'|&#x2019;)t available|Tento obsah (?:teď )?není dostupný|this page isn(?:’|'|&#x2019;)t available|Obsah není dostupný|Video unavailable/i.test(
				html,
			),
		pageUserId: pageUserId && pageUserId !== '0' ? pageUserId : null,
	};
}

// ---------------------------------------------------------------- main

function findTopComment(stories: Obj[]): ITopComment | null {
	let found: ITopComment | null = null;
	for (const s of stories) {
		walk(s, (o) => {
			if (found) return;
			if (o.__typename === 'Comment' && (o.body?.text || o.preferred_body?.text)) {
				found = {
					text: o.body?.text ?? o.preferred_body?.text,
					author: o.author?.name ?? '',
					likeCount: num(o.feedback?.reactors?.count ?? o.feedback?.unified_reactors?.count),
				};
			}
		});
	}
	return found;
}

export function parseReelPage(html: string, opts: ParseOptions): IReelSummary {
	const { reelId } = opts;
	const blocks = extractJsonScripts(html);
	const meta = extractMeta(html);
	const c = collectReelObjects(blocks, reelId);

	const video = chooseVideo(c.videos, c.dashReps, opts.videoPreference ?? 'progressive');

	// ----- story level (caption, date, stats)
	let caption: string | null = null;
	let creation: number | null = null;
	let postId: string | null = null;
	let commentCount: number | null = null;
	let reactions: number | null = null;
	let shares: number | null = null;
	let views: number | null = null;
	let actor: Obj | null = null;

	for (const s of c.stories) {
		if (caption === null && typeof s.message?.text === 'string') caption = s.message.text;
		if (creation === null) creation = num(s.creation_time) ?? num(s.publish_time);
		if (postId === null && s.post_id) postId = String(s.post_id);
		if (!actor && Array.isArray(s.actors) && s.actors[0]?.name) actor = s.actors[0];
		const fbs = [s.feedback, s.fb_reel_react_button?.story?.feedback, s.feedback_context?.feedback_target_with_context].filter(Boolean);
		for (const f of fbs) {
			commentCount = commentCount ?? num(f.total_comment_count) ?? num(f.comment_count?.total_count) ?? num(f.comments?.total_count);
			reactions = reactions ?? num(f.unified_reactors?.count) ?? num(f.reaction_count?.count) ?? num(f.reactors?.count);
			shares = shares ?? num(f.share_count?.count) ?? num(f.share_count_reduced);
			views = views ?? num(f.video_view_count) ?? num(f.play_count);
		}
	}
	for (const v of c.videos) {
		views = views ?? num(v.play_count) ?? num(v.video_view_count) ?? num(v.view_count) ?? num(v.post_view_count);
		creation = creation ?? num(v.publish_time) ?? num(v.created_time);
	}

	// ----- owner
	let owner: Obj | null = null;
	for (const v of c.videos) if (v.owner?.name) { owner = v.owner; break; }
	owner = owner ?? actor ?? c.videos.find((v) => v.owner)?.owner ?? null;

	const thumbnail = first<string>([
		...c.videos.map((v) => v.preferred_thumbnail?.image?.uri),
		...c.videos.map((v) => v.first_frame_thumbnail),
		...c.videos.map((v) => v.thumbnailImage?.uri),
	]);
	const width = first<number>(c.videos.map((v) => num(v.width)));
	const height = first<number>(c.videos.map((v) => num(v.height)));
	const duration = first<number>([
		...c.videos.map((v) => num(v.length_in_second)),
		...c.videos.map((v) => (num(v.playable_duration_in_ms) !== null ? (num(v.playable_duration_in_ms) as number) / 1000 : null)),
	]);

	// ----- og fallback (only if og:url points to this Reel or carries no other video id)
	const ogUrl = meta['og:url'] ?? '';
	const ogIds: string[] = ogUrl.match(/\d{8,}/g) ?? [];
	const ogBelongs = !!meta['og:title'] && (ogIds.length === 0 || ogIds.includes(reelId) || !ogIds.some((id) => c.otherVideoIds.has(id)));
	const og = ogBelongs ? parseOgTitle(meta['og:title']) : parseOgTitle(undefined);
	const hasRelay = c.videos.length > 0 || c.stories.length > 0;

	let statsSource: IReelSummary['statsSource'] = null;
	if (reactions !== null || commentCount !== null || views !== null) statsSource = 'relay';
	if (views === null && og.views !== null) { views = og.views; statsSource = statsSource ?? 'og'; }
	if (reactions === null && og.reactions !== null) { reactions = og.reactions; statsSource = statsSource ?? 'og'; }
	if (commentCount === null && og.comments !== null) { commentCount = og.comments; statsSource = statsSource ?? 'og'; }

	if (caption === null && ogBelongs) caption = og.caption ?? meta['og:description'] ?? null;
	const thumb = thumbnail ?? (ogBelongs ? meta['og:image'] ?? null : null);
	const ogVideo = ogBelongs ? meta['og:video:secure_url'] ?? meta['og:video:url'] ?? meta['og:video'] ?? null : null;
	if (!video.videoUrl && ogVideo) {
		video.videoUrl = ogVideo;
		video.type = 'progressive';
		video.hasSeparateAudio = false;
	}

	const usedOg = ogBelongs && (!hasRelay || statsSource === 'og' || (!thumbnail && !!thumb));
	if (!hasRelay && !ogBelongs) {
		throw new FacebookScraperError(
			'PAGE_STRUCTURE_CHANGED',
			`No data for Reel ${reelId} found in the page (${blocks.length} JSON blocks, ${c.totalVideoNodes} other video nodes).`,
		);
	}

	const authorFullName = (owner?.name as string | undefined) ?? (ogBelongs ? og.author : null) ?? null;
	const authorUrl = (owner?.url as string | undefined) ?? null;

	return {
		platform: 'facebook',
		id: reelId,
		url: canonicalReelUrl(reelId),
		title: titleFromCaption(caption),
		description: caption,
		thumbnail: thumb,
		videoUrl: video.videoUrl,
		likeCount: reactions,
		commentCount,
		viewCount: views,
		topComment: findTopComment(c.stories),
		author: usernameFromProfileUrl(authorUrl) ?? (owner?.id ? String(owner.id) : null),
		authorFullName,
		takenAt: unixToIso(creation),
		takenAtTimestamp: creation,
		mediaType: hasRelay || ogBelongs ? 'video' : 'unknown',
		isVideo: hasRelay || ogBelongs,
		images: [],

		inputUrl: opts.inputUrl,
		postId,
		shareCount: shares,
		authorId: owner?.id ? String(owner.id) : null,
		authorUrl,
		authorIsVerified: typeof owner?.is_verified === 'boolean' ? owner.is_verified : null,
		durationSeconds: duration,
		width,
		height,
		videoQuality: video.quality,
		videoDeliveryType: video.type,
		// DASH video tracks never carry audio; progressive files are verified by the client (MP4 probe).
		videoHasAudio: video.type === 'dash' ? false : null,
		hasSeparateAudio: video.hasSeparateAudio,
		audioUrl: video.audioUrl,
		videoUrlHd: video.hd,
		videoUrlSd: video.sd,
		dashManifestUrl: video.dashManifestUrl,
		videoUrlExpiresAt: cdnUrlExpiry(video.videoUrl),
		statsSource,
		dataSource: hasRelay ? (usedOg ? 'relay+og' : 'relay') : 'og',
		authenticated: opts.authenticated,
		fetchedAt: (opts.now ?? new Date()).toISOString(),
	};
}
