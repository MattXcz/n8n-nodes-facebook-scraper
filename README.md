# @mattxcz/n8n-nodes-facebook-scraper

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20me%20a%20coffee-%E2%98%95-FFDD00?style=flat-square)](https://buymeacoffee.com/mattxcz)

n8n community node: paste a Facebook **Reel** or **post** URL (including posts in groups), get metadata, images and direct video URLs as JSON.
Self-hosted, no paid scraping services. Sibling of [n8n-nodes-instagram-scraper](https://github.com/MattXcz/n8n-nodes-instagram-scraper).

> **Status: 0.2.0 – test version.** See [Verification status](#verification-status) for what has and hasn't been verified yet.

## Install

**n8n UI:** Settings → Community Nodes → Install → `@mattxcz/n8n-nodes-facebook-scraper`

**Manually / Docker:**
```bash
cd ~/.n8n/nodes            # or /home/node/.n8n/nodes inside the container
npm install @mattxcz/n8n-nodes-facebook-scraper
# restart n8n
```

**From source:**
```bash
npm install && npm run build && npm test
npm publish                # prepublishOnly runs build + tests
```

## Resources

| Resource | Operation | Input |
|---|---|---|
| **Reel** | Get Info by URL | `/reel/<id>`, `/share/r/…`, `/videos/<id>`, `watch/?v=` |
| **Post** | Get Info by URL | `/groups/<g>/posts/<id>/`, `/groups/<g>/permalink/<id>/`, `/groups/<g>/?multi_permalinks=<id>`, `/<page>/posts/<id or pfbid>/`, `permalink.php?story_fbid=…`, `/share/p/…` |
| **Detect From URL** | Get Info by URL | Reel-like links → Reel, everything else → Post (good for mixed lists) |

Every result also contains `resource` and the [access fields](#authentication-modes) `authUsed`, `credentialsRequired` and `publicAttempt`.

## Post → Get Info by URL

Same core field names as Reels: `id` (numeric post_id), `url`, `title`, `description` (full text with diacritics, emoji and line breaks), `thumbnail`, `videoUrl`, `likeCount` (all reactions), `commentCount`, `viewCount`, `topComment`, `author`, `authorFullName`, `takenAt`, `mediaType`, `isVideo`.

Extras: `images[]` (`{id, url, width, height, alt}`, full resolution), `shareCount`, `groupId`, `groupName`, `groupUrl`, `authorId`, `authorUrl`, `linkUrl`, `linkTitle` (for shared links, `l.facebook.com` unwrapped), `descriptionTruncated`, `videoUrlExpiresAt`.

`mediaType`: `text` | `photo` | `album` | `video` | `link` | `unknown`.

Notes:
- Group members usually have a privacy id (`pfbid…`) and no public profile URL, so `author` is `null` and `authorFullName` carries the name.
- `topComment` is the first comment Facebook ranks as "most relevant" (replies are skipped).
- For a shared post, only the sharing post is returned; the original (`attached_story`) is never mixed in.
- Facebook reports `video_view_count: 0` on group videos where views aren't shown. Treated as unknown → `viewCount: null`.

## Reel → Get Info by URL

Supported input:
- `https://www.facebook.com/reel/<id>` (also `m.`, `web.`, trailing `/?s=…`)
- `https://www.facebook.com/share/r/<code>/`, `/share/v/<code>/`, `fb.watch/<code>` (redirect is followed)
- `https://www.facebook.com/<page>/videos/<id>/`, `https://www.facebook.com/watch/?v=<id>`

### Output

Field names follow the Instagram node where possible. Missing values are `null`; `0` means Facebook really reported zero. Dates are ISO 8601.

| Field | Notes |
|---|---|
| `id`, `url` | Reel id, canonical `facebook.com/reel/<id>` |
| `title` | First line of the caption (max 120 chars) |
| `description` | Full caption – diacritics, emoji and line breaks preserved |
| `thumbnail` | Preferred thumbnail (fbcdn, expires) |
| `videoUrl` | Direct URL (see *Video* below) |
| `likeCount` | Total reactions (all reaction types) |
| `commentCount`, `viewCount` | `viewCount` is usually only available from the anonymous page (rounded) |
| `topComment` | `{text, author, likeCount}` or `null` (not in the initial page – usually `null`) |
| `author` | Vanity username if the profile has one, otherwise the numeric profile id |
| `authorFullName` | Display name of the page/profile |
| `takenAt` | Publish time, ISO 8601 |
| `mediaType`, `isVideo` | `"video"`, `true` |

Extras: `inputUrl, postId, shareCount, authorId, authorUrl, authorIsVerified, durationSeconds, width, height, videoQuality, videoDeliveryType, hasSeparateAudio, audioUrl, videoUrlHd, videoUrlSd, dashManifestUrl, videoUrlExpiresAt, statsSource, dataSource, authenticated, fetchedAt`.

### Video

Facebook serves two kinds of files:

| `videoDeliveryType` | What it is | `hasSeparateAudio` |
|---|---|---|
| `progressive` | Single MP4 with audio (HD ≈ 720p, SD ≈ 360p). Download and play as-is. | `false` |
| `dash` | Video-only track, usually up to 1080p. Audio is in `audioUrl` and must be muxed, e.g. `ffmpeg -i v.mp4 -i a.mp4 -c copy out.mp4` | `true` |

Option **Video Preference**: *Single MP4 With Audio* (default) or *Highest Resolution (may be video-only)*.

**fbcdn URLs are signed and expire** – `videoUrlExpiresAt` comes from the `oe` parameter (typically a few days). Download right away; don't store the URL.

## Authentication

Facebook's web login uses encrypted password payloads, device fingerprinting and frequent 2FA/checkpoints, so the Instagram node's automatic login is **not** carried over. Instead the node reuses a browser session:

1. Log into Facebook in a browser (ideally a dedicated account).
2. DevTools → Application → Cookies → `https://www.facebook.com`, copy `c_user`, `xs` (required), `datr`, `fr`, `sb` (recommended).
   Or export cookies as JSON with a cookie extension.
3. n8n → Credentials → **Facebook Session (Cookies)** → paste as `c_user=…; xs=…; datr=…; fr=…; sb=…` or the JSON.
4. Optionally paste the browser's User-Agent. **Don't log out** in that browser – that invalidates `xs`.

The credential test opens `facebook.com/settings/` and checks that the page belongs to `c_user`.

Cookies are stored only in n8n's encrypted credentials. They are never written to output, logs or error messages (values are redacted; `_debug` shows only cookie names and a masked user id). Cookie rotations sent by Facebook (`Set-Cookie`) are applied in-memory for the current run; they aren't written to workflow static data, which is not encrypted.

### Authentication modes

| Mode | What it does | `authUsed` | `credentialsRequired` |
|---|---|---|---|
| **Auto** (default) | Tries the public page **without cookies** first. Uses the session only if the public result failed or is incomplete. | `public` or `session` | `false` = public was enough, `true` = cookies were needed |
| **Facebook Session** | Always sends cookies | `session` | `null` (not tested publicly) |
| **None (Public Only)** | Never sends cookies | `public` | `true` if the public data was incomplete |

`publicAttempt` explains the decision, e.g.
```json
"authUsed": "session",
"credentialsRequired": true,
"publicAttempt": { "complete": false, "missing": ["description (truncated)", "takenAt", "stats"], "error": null }
```
A public result counts as complete when it has the full text (not truncated), date, author name, stats and, for Reels/video posts, the video URL. Auto mode costs one extra request when the public page isn't enough.

**Anonymous / public access**: no cookies. For public Reels this gives the full caption, author name, thumbnail and rounded stats (`22 tis.` → 22000, `statsSource: "og"`), but **no video URL and no date**.

## Errors

Every error has an `errorCode` and works with n8n's *On Error* setting (Stop / Continue / Continue using error output). Each failed item keeps `pairedItem`, so other items still go through.

| `errorCode` | Meaning |
|---|---|
| `INVALID_URL` | Not a supported Facebook Reel URL |
| `CONTENT_UNAVAILABLE` | Deleted/private/not visible, or the share link didn't resolve |
| `SESSION_EXPIRED` | Redirected to login, logged-out page served, or `xs` deleted by Facebook |
| `LOGIN_REQUIRED` | Anonymous mode and Facebook wants a login |
| `VERIFICATION_REQUIRED` | Redirect to `/checkpoint/` – resolve in the browser |
| `RATE_LIMITED` | HTTP 429 / "Temporarily blocked" – retried with backoff, then fails |
| `PAGE_STRUCTURE_CHANGED` | Page loaded, but no data for this Reel id found |
| `NETWORK_ERROR`, `HTTP_ERROR` | Connectivity / unexpected status (5xx retried) |

Options: *Delay Between Items* (default 3000 ms, random 1–2×), *Timeout*, *Max Retries*, *Include Debug Info*.

## How it works

```
src/nodes/FacebookReels/FacebookReels.node.ts   n8n node (params, items loop, delay, error routing)
src/credentials/FacebookSessionApi.credentials.ts
src/lib/session.ts   cookie parsing (header/JSON), Set-Cookie rotation, redaction
src/lib/client.ts    HTTP (undici, proxy), manual redirects, share-link resolving, error classification, retries
src/lib/parser.ts    Reel HTML → IReelSummary (pure function, unit-tested)
src/lib/postParser.ts  Post HTML → IPostSummary (pure function, unit-tested)
src/lib/strategy.ts  Auto / Session / Public modes, authUsed + credentialsRequired
src/probe.ts         CLI prototype for one Reel
```

The parser doesn't rely on Open Graph. A logged-in Reel page has **no og tags**. The data sits in ~100 `<script type="application/json" data-sjs>` Relay payloads (`RelayPrefetchedStreamCache → __bbox.result.data`), and those payloads also hold the **next recommended Reels**. Every object is therefore matched by Reel id:
- `Video` node with `id == reelId` → `videoDeliveryResponseResult.progressive_urls` (HD/SD), `dash_manifests[].manifest_xml`, thumbnail, size, duration, owner
- Story whose `attachments[].media.id == reelId` → `message.text`, `creation_time`, `post_id`, `feedback.total_comment_count`, `share_count_reduced`, `fb_reel_react_button.story.feedback.unified_reactors.count`
- `extensions.all_video_dash_prefetch_representations[video_id == reelId]` → DASH fallback

og tags (`og:title` = `"<views> · <reactions> | <caption> | <author>"`) are used only as a fallback, and only when `og:url` doesn't point to a different video.

No headless browser is needed: the data is in the HTML of a normal top-level navigation. The client sends `Sec-Fetch-Mode: navigate` etc. on purpose. A real browser showed that the same URL requested as XHR (`Sec-Fetch-Mode: cors`) returns a shell without the Relay data.

### CLI prototype

```bash
npm run build
FB_COOKIES='c_user=…; xs=…; datr=…' node dist/probe.js https://www.facebook.com/reel/1397612515779779
node dist/probe.js https://www.facebook.com/reel/1397612515779779 --anon
node dist/probe.js <url> --save      # saves raw HTML to .probe/ (contains session data – don't share unredacted)
```

## Verification status – Posts (0.2.0)

**Verified on live Facebook (2026-10-05, logged-in browser):**
- Group post `groups/bambulabczsk/permalink/1819897855848074` (with video). Running `postParser.ts` on the live page gives the full 363-char text, author name, group id/name, date, 26 reactions, 17 comments, 0 shares, top comment and an HD video URL.
- Same post anonymously: og tags only, text cut off at about 190 chars with "...", so `descriptionTruncated: true`; Auto falls back to the session.
- Group text-only post `…/posts/1819812229189970`: structure checked live (`is_text_only_story`, 0 reactions, 2 comments, text with newlines, feedback/comment id matching).

**Not yet verified (synthetic fixtures):** photo and album posts (the `Photo` node shape `image`/`photo_image` was only seen on a photo page, not inside a post), link posts, shared posts, page/profile posts, `pfbid` URLs, `/share/p/` links, private groups the account isn't a member of.

## Verification status – Reels (0.1.0)

**Verified on live Facebook (2026-10-05, logged-in desktop browser, Reel 1397612515779779):**
- Page structure described above (key names, nesting, recommended Reels present on the same page)
- Running `parser.ts` on the live logged-in page: correct caption (Czech diacritics + emoji + newlines, 967 chars), reactions 1461, comments 12, shares 352, author, date, HD/SD URLs, DASH audio. Passing a foreign id → `PAGE_STRUCTURE_CHANGED` (no leakage of recommended Reels).
- Running `parser.ts` on the live anonymous response: full caption identical to the logged-in one, views 22000 / reactions 1400 (rounded), author name, thumbnail; no video URL
- The URLs play: progressive HD = 720×1280 with audio, SD = 360×640, DASH = 1080×1920 video-only
- Fetch-style (XHR) requests don't contain the data; navigation does

**Not yet verified (assumptions – test in n8n):**
- That a **server-side Node request** with the copied cookies + navigation headers gets the same HTML as the browser (Facebook may treat a different IP / TLS fingerprint differently). Run `probe.js` on the n8n server first.
- `share/r/…` resolution: implemented as an HTTP redirect + `og:url`/canonical fallback; not tested on a real share link
- Exact HTML of login wall, checkpoint, rate-limit and "content unavailable" pages. Detection uses URL patterns and known texts (EN/CS); the fixtures for these cases are **synthetic**
- DASH-only Reels (no progressive URL) – synthetic fixture
- `viewCount` and `topComment` while logged in – not found in the initial page, so `null`; getting them would need extra GraphQL calls (not implemented)
- Vanity `author` – the test Reel's owner has only `profile.php?id=`
- Longevity of the `xs` cookie when used from the server's IP

## Tests

`npm test` runs 91 tests over anonymized fixtures (`test/fixtures/generate.js` and `generate-posts.js` document which ones copy real responses and which are synthetic). They cover: direct + share link, Czech caption, missing stats (`null` vs `0`), invalid/expired session (3 variants), checkpoint/rate-limit/unavailable, recommended-Reel isolation, DASH vs progressive, cookie redaction, and several items with one failing in all 3 *On Error* modes.

## Support

Facebook changes its page structure without notice, so keeping this node working is ongoing maintenance rather than a one-off. If it saves you time, you can support that here: [buymeacoffee.com/mattxcz](https://buymeacoffee.com/mattxcz) ☕

Bug reports and PRs are just as welcome — [open an issue](https://github.com/MattXcz/n8n-nodes-facebook-scraper/issues).

## License

MIT — see [LICENSE](./LICENSE). Copyright Matouš Bečvář.

## Disclaimer

Scraping may violate Facebook's Terms. Use a dedicated account, keep request volume low and respect content rights.
