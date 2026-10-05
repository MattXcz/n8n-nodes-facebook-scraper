import { ICredentialType, INodeProperties } from 'n8n-workflow';

export class FacebookSessionApi implements ICredentialType {
	name = 'facebookSessionApi';
	displayName = 'Facebook Session (Cookies)';
	documentationUrl = 'https://github.com/MattXcz/n8n-nodes-facebook-scraper#authentication';
	properties: INodeProperties[] = [
		{
			displayName:
				'Use cookies from a browser where a (preferably dedicated) Facebook account is logged in. Required: <b>c_user</b> and <b>xs</b>; recommended: <b>datr</b>, <b>fr</b>, <b>sb</b>. Do not log out in that browser - it invalidates the session.',
			name: 'notice',
			type: 'notice',
			default: '',
		},
		{
			displayName: 'Cookies',
			name: 'cookies',
			type: 'string',
			typeOptions: { password: true, rows: 3 },
			default: '',
			required: true,
			placeholder: 'c_user=1000...; xs=12%3AAbC...; datr=...; fr=...; sb=...',
			description:
				'Either a Cookie header string ("name=value; name2=value2") or a JSON export from a cookie extension (array of {name, value, domain}). Stored encrypted by n8n and never written to logs or output.',
		},
		{
			displayName: 'User Agent',
			name: 'userAgent',
			type: 'string',
			default: '',
			placeholder: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ...',
			description:
				'Optional. Ideally the exact User-Agent of the browser the cookies came from (reduces security checks). Leave empty for a recent desktop Chrome UA.',
		},
		{
			displayName: 'Accept-Language',
			name: 'acceptLanguage',
			type: 'string',
			default: 'cs-CZ,cs;q=0.9,en;q=0.8',
			description: 'Language of Facebook pages. Affects localized texts only, not captions.',
		},
		{
			displayName: 'Proxy URL',
			name: 'proxyUrl',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			placeholder: 'http://user:pass@proxy.example.com:8080',
			description: 'Optional HTTP(S) proxy for all Facebook requests',
		},
	];
}
