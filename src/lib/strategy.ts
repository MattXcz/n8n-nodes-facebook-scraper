import { FacebookClient } from './client';
import { FacebookScraperError, isFacebookError } from './errors';
import { IAccessInfo, IPostSummary, IReelSummary } from './types';
import { errorMessage } from './utils';

export type AuthMode = 'auto' | 'session' | 'none';

/** Which fields must be present for a public (anonymous) result to count as complete. */
export function missingFields(kind: 'reel' | 'post', r: IReelSummary | IPostSummary): string[] {
	const miss: string[] = [];
	if (!r.description && !(kind === 'post' && r.mediaType !== 'text')) miss.push('description');
	if (kind === 'post' && (r as IPostSummary).descriptionTruncated) miss.push('description (truncated)');
	if (!r.takenAt) miss.push('takenAt');
	if (!r.authorFullName) miss.push('authorFullName');
	if (r.likeCount === null && r.commentCount === null) miss.push('stats');
	if (kind === 'reel' && !r.videoUrl) miss.push('videoUrl');
	if (kind === 'post' && r.isVideo && !r.videoUrl) miss.push('videoUrl');
	return miss;
}

/** Errors after which trying the logged-in session makes sense. */
function sessionMayHelp(e: unknown): boolean {
	return (
		isFacebookError(e, 'LOGIN_REQUIRED') ||
		isFacebookError(e, 'CONTENT_UNAVAILABLE') ||
		isFacebookError(e, 'PAGE_STRUCTURE_CHANGED') ||
		isFacebookError(e, 'HTTP_ERROR')
	);
}

/**
 * Runs one lookup according to the auth mode and annotates the result with
 * `authUsed`, `credentialsRequired` and `publicAttempt`.
 *  - none:    public only (credentialsRequired: false if complete, true if not / failed)
 *  - session: session only (credentialsRequired: null - not tested)
 *  - auto:    public first; session only if the public result failed or was incomplete
 */
export async function runWithAuth<T extends IReelSummary | IPostSummary>(
	kind: 'reel' | 'post',
	mode: AuthMode,
	clients: { anon: FacebookClient; session?: FacebookClient },
	op: (c: FacebookClient) => Promise<T>,
): Promise<T & IAccessInfo> {
	if (mode === 'session') {
		if (!clients.session) throw new FacebookScraperError('SESSION_EXPIRED', 'No Facebook session credential configured.');
		const r = await op(clients.session);
		return { ...r, authUsed: 'session', credentialsRequired: null, publicAttempt: null };
	}

	let publicResult: T | null = null;
	let publicError: unknown = null;
	try {
		publicResult = await op(clients.anon);
	} catch (e) {
		publicError = e;
		if (!sessionMayHelp(e) || mode === 'none' || !clients.session) throw e;
	}
	const missing = publicResult ? missingFields(kind, publicResult) : [];
	const attempt = {
		complete: !!publicResult && missing.length === 0,
		missing,
		error: publicError ? errorMessage(publicError) : null,
	};

	if (publicResult && (attempt.complete || mode === 'none' || !clients.session)) {
		return { ...publicResult, authUsed: 'public', credentialsRequired: !attempt.complete, publicAttempt: attempt };
	}
	const r = await op(clients.session as FacebookClient);
	return { ...r, authUsed: 'session', credentialsRequired: true, publicAttempt: attempt };
}
