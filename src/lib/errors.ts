/**
 * Typed errors so the node can show a precise, actionable message and so
 * callers (and tests) can branch on `code` instead of parsing strings.
 */
export type FacebookErrorCode =
	| 'INVALID_URL'
	| 'CONTENT_UNAVAILABLE'
	| 'SESSION_EXPIRED'
	| 'LOGIN_REQUIRED'
	| 'VERIFICATION_REQUIRED'
	| 'RATE_LIMITED'
	| 'PAGE_STRUCTURE_CHANGED'
	| 'NETWORK_ERROR'
	| 'HTTP_ERROR';

const HINTS: Record<FacebookErrorCode, string> = {
	INVALID_URL: 'Use a link like https://www.facebook.com/reel/<id> or https://www.facebook.com/share/r/<code>/.',
	CONTENT_UNAVAILABLE: 'The Reel/post was deleted, is private (e.g. closed group you are not a member of), or is not visible to this account.',
	SESSION_EXPIRED:
		'The Facebook cookies in the credential are no longer valid. Log in again in a browser and paste fresh cookies (c_user, xs, datr).',
	LOGIN_REQUIRED:
		'This content is not public. Use Authentication "Auto" or "Facebook Session" with valid cookies.',
	VERIFICATION_REQUIRED:
		'Facebook wants the account to pass a security check (checkpoint). Open facebook.com in the browser the cookies came from, complete the check, then retry.',
	RATE_LIMITED: 'Facebook is throttling this session/IP. Increase "Delay Between Items" and retry later.',
	PAGE_STRUCTURE_CHANGED:
		'Facebook returned a page, but the requested Reel/post could not be located in it. The page structure may have changed; enable "Include Debug Info" and report the issue.',
	NETWORK_ERROR: 'Could not reach facebook.com (DNS, proxy or connectivity problem).',
	HTTP_ERROR: 'Facebook returned an unexpected HTTP status.',
};

export class FacebookScraperError extends Error {
	readonly code: FacebookErrorCode;
	readonly hint: string;
	readonly httpStatus?: number;

	constructor(code: FacebookErrorCode, message?: string, httpStatus?: number) {
		super(`[${code}] ${message ?? HINTS[code]}`);
		this.name = 'FacebookScraperError';
		this.code = code;
		this.hint = HINTS[code];
		this.httpStatus = httpStatus;
	}
}

export function isFacebookError(e: unknown, code?: FacebookErrorCode): e is FacebookScraperError {
	return e instanceof FacebookScraperError && (code === undefined || e.code === code);
}
