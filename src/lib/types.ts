export interface IFacebookCredentials {
	/** Cookie header string ("c_user=..; xs=..; datr=..") or a JSON cookie export (array of {name,value}). */
	cookies?: string;
	userAgent?: string;
	acceptLanguage?: string;
	proxyUrl?: string;
}

export interface ITopComment {
	text: string;
	author: string;
	likeCount: number | null;
}

export type VideoDeliveryType = 'progressive' | 'dash' | null;

/**
 * Normalized output of "Reel -> Get Info by URL".
 * Shared fields use exactly the same names, types and meaning as the
 * Instagram scraper node (@mattxcz/n8n-nodes-instagram-scraper).
 * Unknown values are `null`; `0` only means Facebook actually reported zero.
 */
export interface IReelSummary {
	platform: 'facebook';
	id: string;
	url: string;
	title: string | null;
	description: string | null;
	thumbnail: string | null;
	videoUrl: string | null;
	likeCount: number | null;
	commentCount: number | null;
	viewCount: number | null;
	topComment: ITopComment | null;
	author: string | null;
	authorFullName: string | null;
	takenAt: string | null;
	takenAtTimestamp: number | null;
	mediaType: 'video' | 'unknown';
	isVideo: boolean;
	/** Always [] for Reels (the cover frame is in thumbnail); kept for the same shape as posts / Instagram. */
	images: IPostImage[];

	// Facebook-specific extras
	inputUrl: string;
	postId: string | null;
	shareCount: number | null;
	authorId: string | null;
	authorUrl: string | null;
	authorIsVerified: boolean | null;
	durationSeconds: number | null;
	width: number | null;
	height: number | null;
	/** 'HD' | 'SD' for progressive files, or e.g. '1080p' for DASH video tracks. */
	videoQuality: string | null;
	/** 'progressive' = one standalone MP4 file. 'dash' = a single DASH track (video-only). */
	videoDeliveryType: VideoDeliveryType;
	/** Whether the file at videoUrl itself contains audio (read from the MP4 track list). null = unknown / no video. */
	videoHasAudio: boolean | null;
	/** true = videoUrl has no audio and the sound is in audioUrl -> merge them (ffmpeg). */
	hasSeparateAudio: boolean | null;
	/** Best audio-only track (DASH), whenever available - also when videoUrl already has audio. */
	audioUrl: string | null;
	videoUrlHd: string | null;
	videoUrlSd: string | null;
	dashManifestUrl: string | null;
	/** fbcdn URLs are signed and expire; parsed from the `oe` query parameter. */
	videoUrlExpiresAt: string | null;
	/** Which page data the stats came from: 'relay' (exact) or 'og' (rounded, e.g. "22 tis."). */
	statsSource: 'relay' | 'og' | null;
	/** Which source produced the core fields. */
	dataSource: 'relay' | 'og' | 'relay+og';
	authenticated: boolean;
	fetchedAt: string;
}

export interface IPostImage {
	id: string | null;
	url: string;
	width: number | null;
	height: number | null;
	alt: string | null;
}

export type PostMediaType = 'text' | 'photo' | 'carousel' | 'video' | 'link' | 'unknown';

/** Normalized output of "Post -> Get Info by URL" (same core names as Reels / Instagram). */
export interface IPostSummary {
	platform: 'facebook';
	id: string;
	url: string;
	title: string | null;
	description: string | null;
	thumbnail: string | null;
	videoUrl: string | null;
	likeCount: number | null;
	commentCount: number | null;
	viewCount: number | null;
	topComment: ITopComment | null;
	author: string | null;
	authorFullName: string | null;
	takenAt: string | null;
	takenAtTimestamp: number | null;
	mediaType: PostMediaType;
	isVideo: boolean;

	inputUrl: string;
	shareCount: number | null;
	images: IPostImage[];
	authorId: string | null;
	authorUrl: string | null;
	authorIsVerified: boolean | null;
	durationSeconds: number | null;
	width: number | null;
	height: number | null;
	videoQuality: string | null;
	videoDeliveryType: VideoDeliveryType;
	videoHasAudio: boolean | null;
	hasSeparateAudio: boolean | null;
	audioUrl: string | null;
	groupId: string | null;
	groupName: string | null;
	groupUrl: string | null;
	linkUrl: string | null;
	linkTitle: string | null;
	/** True when only a shortened text was available (anonymous og:description ending with "..."). */
	descriptionTruncated: boolean;
	videoUrlExpiresAt: string | null;
	statsSource: 'relay' | 'og' | null;
	dataSource: 'relay' | 'og' | 'relay+og';
	authenticated: boolean;
	fetchedAt: string;
}

/**
 * Added to every result: tells whether the public (anonymous) page was enough
 * or the Facebook session from the credential had to be used.
 */
export interface IAccessInfo {
	/** What produced this result. */
	authUsed: 'public' | 'session';
	/** true = public page was not enough; false = public was enough; null = not tested (mode "Session" only). */
	credentialsRequired: boolean | null;
	/** Outcome of the public attempt (null if it wasn't tried). */
	publicAttempt: { complete: boolean; missing: string[]; error: string | null } | null;
}

export interface IFetchResult {
	finalUrl: string;
	status: number;
	html: string;
	redirects: string[];
}
