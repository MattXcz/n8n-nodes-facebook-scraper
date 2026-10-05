import {
	ICredentialsDecrypted,
	ICredentialTestFunctions,
	IExecuteFunctions,
	INodeCredentialTestResult,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeConnectionType,
	NodeOperationError,
} from 'n8n-workflow';

import { FacebookClient, ClientOptions } from '../../lib/client';
import { FacebookScraperError } from '../../lib/errors';
import { AuthMode, runWithAuth } from '../../lib/strategy';
import { IFacebookCredentials } from '../../lib/types';
import { randomDelay } from '../../lib/utils';

interface NodeOptions {
	delayBetweenItems?: number;
	videoPreference?: 'progressive' | 'highest';
	timeoutSeconds?: number;
	maxRetries?: number;
	includeDebug?: boolean;
}

/**
 * Node type name stays `facebookReels` so workflows built with 0.1.x keep working.
 */
export class FacebookReels implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Facebook Scraper',
		name: 'facebookReels',
		icon: 'file:facebook.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Get metadata of Facebook Reels and posts (incl. group posts) from a link',
		defaults: { name: 'Facebook Scraper' },
		inputs: [NodeConnectionType.Main],
		outputs: [NodeConnectionType.Main],
		credentials: [
			{
				name: 'facebookSessionApi',
				required: true,
				testedBy: 'facebookSessionTest',
				displayOptions: { show: { authentication: ['auto', 'session'] } },
			},
		],
		properties: [
			{
				displayName: 'Authentication',
				name: 'authentication',
				type: 'options',
				options: [
					{
						name: 'Auto (Public First, Session if Needed)',
						value: 'auto',
						description:
							'Tries the public page without cookies first; uses the session only if public data is incomplete. Output shows authUsed / credentialsRequired.',
					},
					{ name: 'Facebook Session (Cookies)', value: 'session', description: 'Always use the logged-in session' },
					{ name: 'None (Public Only)', value: 'none', description: 'Never send cookies; returns whatever is public' },
				],
				default: 'auto',
			},
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Reel', value: 'reel' },
					{ name: 'Post', value: 'post', description: 'Group, page or profile post (text, photos, link, video)' },
					{ name: 'Detect From URL', value: 'detect', description: 'Reel for /reel/, /share/r/, /videos/, /watch links; Post otherwise' },
				],
				default: 'reel',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['reel'] } },
				options: [
					{
						name: 'Get Info by URL',
						value: 'getInfoByUrl',
						description: 'Get caption, thumbnail, video URL, author, date and stats of a Reel',
						action: 'Get info for a reel by URL',
					},
				],
				default: 'getInfoByUrl',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['post', 'detect'] } },
				options: [
					{
						name: 'Get Info by URL',
						value: 'getInfoByUrl',
						description: 'Get text, images, author, group, date, stats and top comment of a post',
						action: 'Get info for a post by URL',
					},
				],
				default: 'getInfoByUrl',
			},
			{
				displayName: 'Reel URL',
				name: 'url',
				type: 'string',
				displayOptions: { show: { resource: ['reel'], operation: ['getInfoByUrl'] } },
				default: '',
				placeholder: 'https://www.facebook.com/reel/1397612515779779',
				description: 'facebook.com/reel/&lt;id&gt; or a share link facebook.com/share/r/&lt;code&gt;/',
				required: true,
			},
			{
				displayName: 'Post URL',
				name: 'url',
				type: 'string',
				displayOptions: { show: { resource: ['post', 'detect'], operation: ['getInfoByUrl'] } },
				default: '',
				placeholder: 'https://www.facebook.com/groups/bambulabczsk/permalink/1819897855848074/',
				description:
					'/groups/&lt;group&gt;/posts|permalink/&lt;id&gt;/, /&lt;page&gt;/posts/&lt;id&gt;/, permalink.php?story_fbid=… or share link /share/p/&lt;code&gt;/',
				required: true,
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Delay Between Items (Ms)',
						name: 'delayBetweenItems',
						type: 'number',
						typeOptions: { minValue: 0 },
						default: 3000,
						description: 'Random pause between this value and 2× this value before item 2, 3, …. 0 disables it.',
					},
					{
						displayName: 'Video Preference',
						name: 'videoPreference',
						type: 'options',
						options: [
							{ name: 'Single MP4 With Audio (Progressive)', value: 'progressive', description: 'HD if available, else SD. Ready to download/play.' },
							{ name: 'Highest Resolution (May Be Video-Only)', value: 'highest', description: 'Best DASH video track; audio is then in audioUrl and must be muxed (e.g. ffmpeg)' },
						],
						default: 'progressive',
					},
					{
						displayName: 'Timeout (Seconds)',
						name: 'timeoutSeconds',
						type: 'number',
						typeOptions: { minValue: 5 },
						default: 30,
					},
					{
						displayName: 'Max Retries',
						name: 'maxRetries',
						type: 'number',
						typeOptions: { minValue: 0, maxValue: 5 },
						default: 2,
						description: 'Retries for network errors, HTTP 5xx and rate limits (with backoff)',
					},
					{
						displayName: 'Include Debug Info',
						name: 'includeDebug',
						type: 'boolean',
						default: false,
						description: 'Whether to add a _debug object (session state without secrets) to the output',
					},
				],
			},
			{
				displayName:
					'Direct media URLs (fbcdn.net) are signed and expire (see videoUrlExpiresAt). Download files soon after this node runs.',
				name: 'expiryNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName:
					'Facebook keeps changing its page structure, so this node needs regular upkeep to keep working. If it saves you time, you can support that at <a href="https://buymeacoffee.com/mattxcz" target="_blank">buymeacoffee.com/mattxcz</a>.',
				name: 'supportNotice',
				type: 'notice',
				default: '',
			},
		],
	};

	methods = {
		credentialTest: {
			async facebookSessionTest(
				this: ICredentialTestFunctions,
				credential: ICredentialsDecrypted,
			): Promise<INodeCredentialTestResult> {
				try {
					const client = new FacebookClient((credential.data ?? {}) as IFacebookCredentials, { maxRetries: 0 });
					const r = await client.verifySession();
					return { status: r.ok ? 'OK' : 'Error', message: r.message };
				} catch (e) {
					return { status: 'Error', message: e instanceof Error ? e.message : 'Unknown error' };
				}
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const mode = this.getNodeParameter('authentication', 0, 'auto') as AuthMode;
		const options0 = this.getNodeParameter('options', 0, {}) as NodeOptions;

		const toErrorItem = (nodeError: NodeOperationError, original: unknown, i: number): INodeExecutionData => {
			const code = original instanceof FacebookScraperError ? original.code : undefined;
			const item: INodeExecutionData = {
				json: { error: nodeError.message, errorCode: code ?? null, url: safeParam(this, i) },
				pairedItem: { item: i },
			};
			if (this.getNode().onError === 'continueErrorOutput') item.error = nodeError;
			return item;
		};

		let clients: { anon: FacebookClient; session?: FacebookClient };
		try {
			const clientOpts: ClientOptions = {
				videoPreference: options0.videoPreference ?? 'progressive',
				timeoutMs: (options0.timeoutSeconds ?? 30) * 1000,
				maxRetries: options0.maxRetries ?? 2,
			};
			const creds =
				mode === 'none' ? ({} as IFacebookCredentials) : ((await this.getCredentials('facebookSessionApi')) as IFacebookCredentials);
			clients = {
				// The public client still uses proxy / UA / language from the credential, never its cookies.
				anon: new FacebookClient(creds, { ...clientOpts, anonymous: true }),
				session: mode === 'none' ? undefined : new FacebookClient(creds, { ...clientOpts, anonymous: false }),
			};
		} catch (error) {
			// Setup errors affect every item: honor "On Error" for all of them.
			const err = new NodeOperationError(this.getNode(), error as Error, {
				description: error instanceof FacebookScraperError ? error.hint : undefined,
			});
			if (this.continueOnFail()) return [items.map((_, i) => toErrorItem(err, error, i))];
			throw err;
		}

		for (let i = 0; i < items.length; i++) {
			const options = this.getNodeParameter('options', i, {}) as NodeOptions;
			if (i > 0) {
				const d = options.delayBetweenItems ?? 3000;
				if (d > 0) await randomDelay(d, d * 2);
			}
			try {
				const url = this.getNodeParameter('url', i) as string;
				let resource = this.getNodeParameter('resource', i, 'reel') as string;
				if (resource === 'detect') resource = isReelLikeUrl(url) ? 'reel' : 'post';
				const result: Record<string, unknown> = {
					resource,
					...(
					resource === 'post'
						? { ...(await runWithAuth('post', mode, clients, (c) => c.getPostByUrl(url))) }
						: { ...(await runWithAuth('reel', mode, clients, (c) => c.getReelByUrl(url))) }),
				};
				if (options.includeDebug) result._debug = { session: clients.session?.describeSession() ?? null, mode };
				returnData.push(
					...this.helpers.constructExecutionMetaData(this.helpers.returnJsonArray(result as any), {
						itemData: { item: i },
					}),
				);
			} catch (error) {
				const err = new NodeOperationError(this.getNode(), error as Error, {
					itemIndex: i,
					description: error instanceof FacebookScraperError ? error.hint : undefined,
				});
				if (this.continueOnFail()) {
					returnData.push(toErrorItem(err, error, i));
					continue;
				}
				throw err;
			}
		}
		return [returnData];
	}
}

function isReelLikeUrl(url: string): boolean {
	return /facebook\.com\/(?:reels?\/|share\/[rv]\/|watch\b|[^/]+\/videos\/)|fb\.watch\//i.test(url || '');
}

function safeParam(ctx: IExecuteFunctions, i: number): string | null {
	try {
		return ctx.getNodeParameter('url', i) as string;
	} catch {
		return null;
	}
}
