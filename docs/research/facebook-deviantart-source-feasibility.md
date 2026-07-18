# Facebook and DeviantArt source feasibility

Research date: 2026-07-18  
Target: FixEmbed's Cloudflare Worker metadata service and Discord Components V2 cards

## Decision

| Platform | First-party source | Feasible now? | Recommended scope |
| --- | --- | --- | --- |
| DeviantArt | DeviantArt oEmbed | Yes, without OAuth in the live probes | Ship public deviation and `sta.sh` links. Render photos/GIFs directly; render hosted videos as thumbnail + source link unless a safe player path is proven. |
| Facebook content published by public Pages | Meta Graph API with Page Public Content Access | Technically yes, but externally blocked | Implement behind a disabled feature flag only after Meta App Review and business verification. Start with canonical Page post URLs whose numeric Page/post IDs can be resolved reliably. |
| Facebook via Meta oEmbed alone | Meta oEmbed Read | No for FixEmbed-quality cards | The current response is embed HTML plus provider/size metadata. It no longer supplies normalized author or thumbnail fields, and Discord Components V2 cannot execute the returned HTML/JavaScript. |
| Facebook via anonymous HTML scraping | Facebook web pages/plugins | Not a production-quality first-party contract | Do not make this the primary implementation. Anonymous fetches returned HTTP 400 in this environment, and the HTML is undocumented and session/anti-bot dependent. |

The efficient delivery order is therefore:

1. Complete and ship the DeviantArt vertical slice.
2. Create the Meta app, complete business verification, request Page Public Content Access, and run a credentialed tracer-bullet query.
3. Only then finish Facebook Page cards. Keep Facebook disabled if approval or required fields are unavailable.

## DeviantArt

### Supported public URL shapes

DeviantArt's oEmbed documentation explicitly accepts:

```text
https://www.deviantart.com/USERNAME/art/*
https://sta.sh/*
```

The JSON endpoint is:

```text
GET https://backend.deviantart.com/oembed?url={percent-encoded-url}
```

Source: [DeviantArt oEmbed](https://deviantart.readme.io/docs/oembed).

For FixEmbed, accept `www.deviantart.com/{username}/art/{slug}` and `sta.sh/{id}` over HTTPS. Do not send arbitrary URLs to the endpoint; validate the host and path first. The official scheme does not list profile, gallery, favourites, search, or journal URLs, so those should remain unsupported unless separately proven.

### Authentication and review

The documented oEmbed call has no OAuth parameter, and both public deviation probes below returned HTTP 200 without credentials. This is distinct from DeviantArt's OAuth API, which requires registered application credentials for its richer endpoints. The oEmbed path is therefore Cloudflare Worker-compatible without adding a secret.

DeviantArt says API clients must send a User-Agent and use HTTP compression; use a stable FixEmbed User-Agent and `Accept-Encoding` supported by the Worker runtime. Source: [DeviantArt getting started](https://deviantart.readme.io/docs/getting-started).

### Live response behavior

The official example photo was probed through the documented endpoint:

- Input: [Fella Celebrates 100k](https://www.deviantart.com/team/art/Fella-Celebrates-100k-971957229)
- Result: HTTP 200, `application/json`, `Cache-Control: max-age=180`
- Normalized fields observed: `version`, `type`, `title`, `url`, `author_name`, `author_url`, `provider_name`, `provider_url`, `safety`, `pubdate`, `width`, `height`, `thumbnail_url`, `thumbnail_width`, `thumbnail_height`
- DeviantArt extensions observed: `community.statistics._attributes` with `views`, `favorites`, `comments`, and `downloads`; and `copyright._attributes`

A public hosted video was also probed:

- Input: [Alien Space Engineer - 4k Animation+Music](https://www.deviantart.com/era7/art/Alien-Space-Engineer-4k-Animation-Music-1242208528)
- Result: HTTP 200 with `type: "video"`, a thumbnail, dimensions, publication time, safety, and the same statistics object
- The `html` field was an iframe pointing to `https://backend.deviantart.com/embed/film/...`; the `url` field was the deviation page, not a raw video file

A GIF deviation returned `type: "photo"` with a signed `wixmp.com` GIF URL and a JPEG thumbnail. Therefore dispatch on returned content, not on title/category text:

- `type=photo`: use `url` as the primary image/GIF and preserve dimensions.
- `type=video`: use `thumbnail_url` for the card and link to the deviation. Treat iframe playback as a separate capability; do not mislabel the deviation-page URL as a direct video.
- Any other type: render text/author/stats plus a safe thumbnail if present.

The image and thumbnail URLs returned for the photo probe were fetched with `HEAD` and both returned HTTP 200, `Access-Control-Allow-Origin: *`, and `Cache-Control: public, max-age=2592000, immutable`. They contained signed query parameters. Store and serve the complete returned URL, never reconstruct or strip its token. Refresh oEmbed after FixEmbed's cache TTL instead of assuming a signed rendition URL is permanent.

The endpoint honored `maxwidth`, but selected available renditions rather than an exact requested size: the sample returned 300×400 for `maxwidth=300` and `600`, and 774×1032 for `maxwidth=1200`. Treat the returned `width`/`height` as authoritative. Source and endpoint contract: [DeviantArt oEmbed](https://deviantart.readme.io/docs/oembed).

### Rate and safety constraints

DeviantArt documents adaptive rather than fixed rate limiting. A throttled or overloaded client receives HTTP 429 and should use exponential backoff. Source: [DeviantArt errors and rate limits](https://deviantart.readme.io/docs/errors).

Implementation requirements:

- Cache successful oEmbed JSON and negative/not-found results.
- On 429, back off; do not immediately retry per Discord interaction.
- Respect `safety`. Sensitive/adult content must flow into FixEmbed's spoiler/sensitive behavior.
- Sanitize all strings and validate all returned media URLs before placing them in Open Graph or Discord component payloads.
- Do not proxy originals merely to remove the signed query string.

### DeviantArt card mapping

| FixEmbed field | oEmbed source |
| --- | --- |
| Title | `title` |
| Author name/link | `author_name`, `author_url` |
| Timestamp | `pubdate` |
| Image/GIF | `url` when `type=photo` |
| Video preview | `thumbnail_url` when `type=video` |
| Dimensions | returned `width`, `height` |
| Sensitive flag | `safety` |
| Stats | views, favorites, comments, downloads from `community.statistics._attributes` |
| Footer/context | provider name plus copyright attributes where useful |

## Facebook

### What “Embedded” publicly promises

The directly observable public product page for the Embedded Discord bot claims:

- full-resolution photo posts and captions;
- videos and Reels with preview thumbnails and playback;
- Facebook names and profile pictures;
- post text/captions and reaction counts;
- text posts, single-photo posts, multi-image posts, videos, and Reels.

Source: [Embedded's Facebook feature page](https://embedded.gallery/platforms/facebook/).

That page does not disclose its Facebook data source, authentication method, accepted URL grammar, exact Discord field layout, or rate-limit strategy. No public API/source repository for this specific bot was identified. Therefore it is valid as a behavioral parity target, but not as evidence that an undocumented Facebook route is safe or available to FixEmbed. In particular, it is not evidence that anonymous scraping is stable.

There is no direct public evidence on that page for comment/share counts, a timestamp, or a footer. Those are FixEmbed additions:

- stats row: reactions, comments, shares when the API returns them;
- footer/context: `Facebook` and FixEmbed branding according to existing card conventions;
- timestamp: the post's `created_time`.

### Meta oEmbed: current capabilities and regression

Meta oEmbed Read allows front-end views of public Facebook/Instagram pages, posts, and videos, but requires App Review and is only available with business verification; Meta notes that additional contracts may also be required. Source: [Meta oEmbed Read](https://developers.facebook.com/docs/features-reference/meta-oembed-read).

Meta's current Graph API v25 references expose:

```text
GET /v25.0/oembed_post?url={post-url}
GET /v25.0/oembed_video?url={video-url}
GET /v25.0/oembed_page?url={page-url}
```

The post/video endpoints accept `maxwidth`, `omitscript`, `sdklocale`, `url`, and `useiframe`. Their current default fields are only `height`, `html`, `provider_name`, `provider_url`, `type`, `version`, and `width`. Sources: [Oembed Post](https://developers.facebook.com/docs/graph-api/reference/oembed-post/), [Oembed Video](https://developers.facebook.com/docs/graph-api/reference/oembed-video/), and [Oembed Page](https://developers.facebook.com/docs/graph-api/reference/oembed-page/).

Since November 3, 2025, Facebook post/video oEmbed responses no longer return:

- `author_name`
- `author_url`
- `thumbnail_height`
- `thumbnail_url`
- `thumbnail_width`

Source: [Meta's oEmbed update](https://developers.facebook.com/blog/post/2025/04/08/oembed-updates/) and the current post/video references above.

Two read-only v25 probes of public Page content returned HTTP 200 without a token:

- a canonical NASA Page post returned provider metadata, `type: "rich"`, width, and a small `fb-post` HTML wrapper;
- Meta for Developers' documented video returned provider metadata, `type: "video"`, width, and Facebook embed HTML.

These anonymous successes do not provide FixEmbed-ready live data: the post response had no post text, author, timestamp, stats, image, or thumbnail as normalized fields, and the video response had no raw video URL. Discord Components V2 will not execute Facebook's returned script/iframe. Meta oEmbed can validate a URL and supply web embed HTML, but it cannot by itself meet the requested card parity.

### Page Public Content Access: the viable first-party data route

Meta's Page Public Content Access feature permits an app to read public data for Pages where it lacks `pages_read_engagement` and `pages_read_user_content`. Meta explicitly includes business metadata, public posts, and public comments, and allows displaying Page posts and engagement. It requires successful App Review and business verification. Before approval, testing is limited to a Page whose admin is also an admin, developer, or tester of the app; a live app cannot read arbitrary Page public content without the approved feature. Source: [Page Public Content Access](https://developers.facebook.com/docs/features-reference/page-public-content-access/).

This route can supply the requested FixEmbed card fields:

| FixEmbed field | Graph API source |
| --- | --- |
| Page name/link | Page `name`, `link`, and optionally `username` |
| Page avatar | Page `picture` edge |
| Post text | PagePost `message` |
| Timestamp | PagePost `created_time` |
| Canonical source link | PagePost `permalink_url` |
| Primary image | PagePost `full_picture` |
| Multi-image/link/video metadata | PagePost `attachments` and StoryAttachment `subattachments`, `media`, `media_type`, `target`, `type`, `url` |
| Reaction count | `reactions.summary(total_count)` |
| Comment count | `comments` summary `total_count` |
| Share count | PagePost `shares.count` |

Sources: [Page](https://developers.facebook.com/docs/graph-api/reference/page/), [Page picture](https://developers.facebook.com/docs/graph-api/reference/page/picture/), [PagePost](https://developers.facebook.com/docs/graph-api/reference/page-post/), [StoryAttachment](https://developers.facebook.com/docs/graph-api/reference/story-attachment/), [Object reactions](https://developers.facebook.com/docs/graph-api/reference/object/reactions/), and [Page post comments](https://developers.facebook.com/docs/graph-api/reference/page-post/comments/).

One batched field selection should be proven in the credentialed tracer bullet, conceptually:

```text
message,created_time,from,permalink_url,full_picture,shares,
reactions.limit(0).summary(total_count),
comments.limit(0).summary(total_count),
attachments{type,media_type,url,unshimmed_url,media,target,subattachments}
```

The exact selection must be tested against Graph API v25 with the approved feature; Meta deprecates fields over time, and nested attachment availability varies by post type.

### Facebook media limitations

Page `full_picture` is documented as a full-sized post/link picture, but Facebook resizes it to a largest dimension of 720 pixels when the original exceeds that size. Source: [Page feed](https://developers.facebook.com/docs/graph-api/reference/page/feed/).

The StoryAttachment model provides photo/link/video attachment metadata and subattachments, making text, single-image, and multi-image cards feasible. It does not guarantee a raw playable video.

For Page feeds/posts, Meta states that the `source` field is returned only for Page-owned videos when the querying user is an administrator of the owning Page. Source: [Page published posts](https://developers.facebook.com/docs/graph-api/reference/page/published_posts/). The Video reference likewise requires a valid Page or User access token even for public videos. Source: [Video](https://developers.facebook.com/docs/graph-api/reference/video/).

Consequences:

- First-party public-Page parity for text, image previews, author, timestamp, and engagement counts is feasible after approval.
- Direct inline playback of arbitrary public Page videos/Reels is not proven feasible through Page Public Content Access alone.
- A Facebook video/reel MVP should render the API-provided preview plus a source button. Do not promise inline playback until a credentialed probe returns a permitted playable URL for a Page FixEmbed does not administer.

### Facebook URL shapes and ID resolution

Meta's current first-party examples document these canonical forms:

```text
https://www.facebook.com/{page-name-or-id}/posts/{post-id}
https://www.facebook.com/{page-name-or-id}/videos/{video-id}
https://www.facebook.com/video.php?v={video-id}
https://www.facebook.com/permalink.php?story_fbid={post-id}&id={page-id}
```

Sources: [Embedded Posts](https://developers.facebook.com/docs/plugins/embedded-posts/), [Embedded Videos](https://developers.facebook.com/docs/plugins/embedded-video-player/), and [PagePost](https://developers.facebook.com/docs/graph-api/reference/page-post/).

A direct PagePost Graph read uses:

```text
GET /v25.0/{page-id}_{post-id}
```

Source: [PagePost](https://developers.facebook.com/docs/graph-api/reference/page-post/).

For the first implementation, accept only Page URLs that can be canonicalized to a Page identifier plus a numeric post/video identifier, and validate the returned `from`/`permalink_url`. Modern `pfbid...`, `/share/...`, `/watch`, `/reel`, photo, group, story, and shortened forms are not all mapped by the current first-party documentation to a PagePost Graph ID. Embedded claims Reels behavior, but it does not publish its URL grammar or resolver. Supporting those forms without a proven resolver would be speculation.

If broad modern-link parity is required, make URL resolution its own tracer-bullet acceptance test. Do not solve it by unboundedly paging through a Page feed to match `permalink_url`; that is slow, rate-expensive, and fails for old posts.

### Facebook rate limits

Meta says Graph API application-token calls are counted against an application-level rolling one-hour window:

```text
Calls within one hour = 200 * Number of Users
```

Responses that receive enough traffic expose `X-App-Usage` percentages for `call_count`, `total_cputime`, and `total_time`; calls may be throttled when the relevant usage reaches 100. Source: [Graph API rate limits](https://developers.facebook.com/docs/graph-api/overview/rate-limiting/).

FixEmbed should:

- cache Page and PagePost results by canonical Graph ID;
- coalesce concurrent misses;
- monitor `X-App-Usage`;
- degrade to the original Facebook URL when throttled;
- never log access tokens or include them in generated media/source URLs.

### Facebook approval tracer bullet

Do not build the full handler before this passes:

1. Create a Meta app for the Facebook embed use case.
2. Complete business verification.
3. Add a test Page whose administrator has an app role.
4. Query one text post, one single-photo post, one multi-photo post, and one video/reel post using Graph API v25.
5. Record which of the proposed fields are actually returned.
6. Confirm reaction/comment/share summary counts.
7. Confirm Page name/avatar, `created_time`, `permalink_url`, and attachment URLs.
8. Test one arbitrary public Page after Page Public Content Access approval.
9. Verify media URLs from a Cloudflare Worker request, not only Graph API Explorer.
10. Proceed with the Facebook handler only if the required fields survive steps 4–9.

## Implementation recommendation

### DeviantArt vertical slice

Implement immediately:

- strict URL detection/canonicalization;
- oEmbed fetch with timeout, stable User-Agent, cache, and 429 backoff;
- `photo`, GIF-as-photo, and video-thumbnail handling;
- safety/spoiler mapping;
- views/favorites/comments/downloads stats;
- author, timestamp, copyright/footer context;
- tests using sanitized response fixtures plus one optional live canary.

### Facebook vertical slice

Prepare code seams and tests, but keep the production platform disabled until approval:

- a secret binding for the Meta token, never bot config or client-side code;
- canonical numeric Page post/video URL parsing;
- a Graph PagePost client isolated behind one interface;
- fixtures for text, photo, gallery, and video-preview cards;
- graceful unsupported handling for unresolved modern links;
- explicit fallback behavior for missing stats/media;
- a health probe that distinguishes credentials, permission/app-review, rate limit, not-found/private, and upstream errors.

Do not use Meta oEmbed HTML as if it were normalized metadata, do not scrape Facebook login HTML as the default source, and do not claim Embedded-level Reel/video playback until the credentialed probe proves it.
