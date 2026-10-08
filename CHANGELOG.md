## Unreleased

#### **Reddit comment cards from the old.reddit fallback show when the comment was posted (#91)**
- When Reddit's API blocks the Worker, comment cards are built from old.reddit's page, and those cards had no timestamp. old.reddit's comment markup has no timestamp attribute, unlike posts.
- The time now comes from the comment's own header on old.reddit, the same time old.reddit shows as "8 months ago". If the comment was edited, the original posting time is used, not the edit time.
- Cards built from Reddit's API are unchanged.
- Ships with a Worker deploy. No bot restart needed.

#### **Premium shows active right after purchase (#101)**
- A server that just subscribed could still show as free for up to 10 minutes. A Premium check that started before the purchase could finish after it and replace the new "active" status with its older "not active" answer.
- Subscribing, renewing, or cancelling now always wins over a Premium check that was already running. The older answer is dropped instead of saved, so /premium and the settings screens show the new status right away.
- This works both ways: a cancellation is not undone by an older check that still saw the subscription.
- A Premium check that times out or fails still changes nothing in the cache, and the error log now names the server it was checking.
- Ships with a bot restart only. No Worker deploy needed.

#### **Deleted Reddit comments show as gone (#106)**
- A link to a Reddit comment that was deleted or removed and has no replies now shows the "Comment unavailable" card. Before, FixEmbed posted nothing, as with comments paut4ly (r/discordapp) and pauldso (r/learnpython).
- For these comments old.reddit answers 200 with the post but an empty thread, so the page itself never says the comment is gone. When the page names the comment as its target and the thread is empty, the Worker now looks the comment up once on old.reddit's `api/info.json`.
- A comment counts as gone only when its text is exactly `[deleted]` or `[removed]` and its author is gone too, or old.reddit marks it deleted. Someone who really typed `[deleted]` or `[removed]` keeps a normal comment card. This rule now applies to Reddit's API, the old.reddit page and the new lookup.
- The lookup uses only what is left of the 8 second comment budget, capped at 3 seconds, and is never retried. A timeout, error, 403, 429, 5xx, a comment on another post or a live author still means "Reddit is temporarily unavailable" and Discord keeps Reddit's own preview.
- The lookup logs a `reddit_fetch` line with the stage `old_reddit_info`.
- Deleted comments still get the "Comment unavailable" card, not the post card with a deleted line. The existing cards and tests for deleted comments expect that card, and the post card would need its own bot rendering, so it is left for a follow-up.
- Ships with a Worker deploy. No bot restart needed.

#### **Faster Reddit comment cards when Reddit is slow (#98)**
- A Reddit comment card can no longer wait about 10 seconds on one slow Reddit call. Before, every Reddit call for a comment could take up to 10 seconds, and one comment card took 9.6 seconds in a test.
- Each Reddit call for a comment link now has its own limit: 3 seconds for the link check and for Reddit's API, 4 seconds for the old.reddit page and 4 seconds to read it, and 2 seconds for each subreddit icon lookup.
- The whole comment request now has 8 seconds in total, well inside the bot's 15 second wait. Later calls only get the time that is left, and the icon lookups are skipped when less than a quarter second remains, so the card keeps Reddit's default icon.
- If the old.reddit page times out or Reddit answers with a server error (5xx), it is tried once more, but only when at least 1 second is left. A 403, 404, 429 or any other answer is never retried.
- old.reddit is now retried at most once per comment, even when a timeout is followed by a server error.
- Timeouts and errors still mean "Reddit is temporarily unavailable" and Discord keeps Reddit's own preview. Only Reddit saying the comment is gone shows "Comment unavailable", the same as before.
- The `reddit_fetch` log line for the old.reddit page now has an `attempt` field (1, or 2 for the retry), so Workers Logs show how often the retry fires.
- Reddit posts, share links before they resolve, and every other platform keep their current timeouts. The embed cache and the other log lines are unchanged.
- Ships with a Worker deploy. No bot restart needed.

#### **More mentions in link text show as plain text (#103)**
- A mention inside backticks in a title or author name, like ``Why `@everyone` fails``, is now broken too. Code formatting in link text does not stop Discord from refusing the link, so the card could still show raw markdown. Code in comment and post text keeps its exact text as before.
- `@everyone` and `@here` are now broken wherever they appear, including `@everyones`, `@everyone_x`, `@hereby` and `foo@here`, because Discord still reads those as mentions. Other `@` text such as email addresses or `@heroes` is unchanged.
- Ships with a bot restart. No Worker deploy needed.

#### **Reddit titles with mentions keep their link (#103)**
- A Reddit post title that contains `@everyone` or `@here` now shows as a clickable title again. Discord refuses a masked link whose text holds a mention, so the card showed the raw `[title](https://www.reddit.com/...)` markdown instead, as on the comment cards for r/discordapp post 1ib8uq6.
- Mentions in link text now get a zero-width space after the `@` or `#`, so they read the same but Discord no longer sees a mention. `[`, `]`, `)` and backslashes in link text are escaped so a title can't end its own link early.
- This covers Reddit post titles, parent post titles on comment cards, linked section titles and author names, plus title and author link text on Twitter, Bluesky, Threads, Instagram, YouTube, Pixiv, Pinterest, Bilibili, DeviantArt, TikTok, Tumblr and Twitch cards. Text that was already escaped once (DeviantArt, Pixiv author names) is not escaped again.
- Mentions in Reddit comment and post text now show as plain text too, so a comment's `<@&1234567>` no longer renders as an @unknown-role pill (part of #96). Code, code blocks and URLs keep their exact text, and no Reddit body markdown is escaped a second time.
- Ordinary titles without mentions, brackets, closing parentheses or backslashes render byte-for-byte as before.
- Ships with a bot restart. No Worker deploy needed.

#### **Faster premium checks (#99)**
- Servers without saved FixEmbed settings, which is most free servers, no longer ask Discord for their Premium status on every message. The answer is now cached for 10 minutes for every server, Premium or not, the same as servers with saved settings.
- Subscribing, renewing, or cancelling still updates the cached status right away, now for every server.
- The Premium check now gives up after 2.5 seconds, so a slow or rate limited Discord response can no longer hold up a card. If the check fails, FixEmbed uses the last known status for up to an hour after it expires. With no recent status, that one message is handled as free and the next message checks again, so a paying server is never stuck on free.
- A failed check never changes saved settings. Premium settings like card colors, footer branding and exclusions stay as they are and come back on the next successful check.
- The status cache holds up to 10,000 servers and drops the least recently used first.
- Ships with a bot restart. No Worker deploy needed.

#### **Reddit timing logs (#98)**
- The Worker now turns on Workers Logs, so its console output is kept for 7 days and can be searched in the Cloudflare dashboard.
- Each Reddit comment request now logs one `reddit_fetch` line per Reddit call: the subreddit check, the JSON API, the old.reddit page, the old.reddit body read, and the subreddit icon lookups. Each line has the stage, the HTTP status, the time in milliseconds, and whether it timed out.
- One `reddit_comment_timing` summary line follows with the total time, the slowest stage, the outcome (card, gone, or temporary), and whether the answer came from the embed cache. Cache hits log only the summary.
- The new lines carry only the subreddit, post id, and comment id. No URLs, cookies, or comment text.
- Logging only. Timeouts, fallbacks, and the deleted versus temporarily unavailable results are unchanged, and a logging failure cannot change a card.
- This explains slow cards but does not speed them up. Discord timestamps from a test showed one slow comment card took 9.6s end to end, and the Worker spent 9.3s of that, so the next step is to find which Reddit call was slow.
- Ships with a Worker deploy. No bot restart needed.

#### **Reddit text keeps underscores and inline code (#87)**
- When Reddit's API is blocked and a comment or post body comes from Reddit's HTML page instead, the Worker now turns that HTML back into Discord markdown instead of stripping the tags. Literal `_`, `*`, `~`, `|` and backslashes in the text are escaped once, so `how_are_reddit_urls_constructed` keeps its underscores and the rest of the paragraph no longer turns italic.
- Inline code keeps its content ("you'll often see `_` used" no longer renders as "see  used"), code blocks keep their indentation, and Reddit's own bold, italics, strikethrough, spoilers and links carry over as Discord formatting.
- Lines that start with `#`, `>`, `-`, `+` or `1.` in the text are escaped so they stay text, and URLs are left untouched so their underscores keep working.
- The result matches what Reddit's JSON API returns for the same comment, so the bot shows both paths the same way. The bot's quote block, bold subreddit label and links are not escaped a second time.

#### **Block mentions from embedded content (#93)**
- FixEmbed can no longer ping anyone through text it copies from other sites or users. An `@everyone`, `@here`, `<@user>` or `<@&role>` inside a Reddit comment, a post title, a caption, an author name, or a link's text now shows as plain text and notifies nobody.
- The bot client now defaults to no mentions, so every message it posts is silent unless a send opts in.
- Cards and link text in reply, suppress, and delete modes, plus `/fix` and the Fix Embed message command, now send with no mentions, including the plain-link fallback.
- In delete mode, the "Sent by" line can still ping the person who posted the link when Mention Users is on, as before. Tagged users stay listed without being pinged, and the card itself never pings, even the poster.
- Ships with a bot restart. No Worker deploy needed.

#### **No "Translated from" footer on untranslated text (#88)**
- Reddit comment cards no longer send the generated "Parent post" label to the translator. Language detection read it as French, the model echoed back "Parent Post", and the card claimed "Translated from English" on an English comment.
- Translation output that only differs from the original in case, spacing or punctuation is no longer counted as a translation.
- The footer now names the language that was actually translated. A translated quote under an untranslated post shows the quote's language, not the post's.
- No translation metadata is sent when the source and target language match. Language codes are compared without case or region, so `en`, `EN`, `en-US` and `en_GB` are all English.
- The bot also hides the footer when the source and target language match, and the canary no longer counts a same-language result as a translation. Real translations still show "Translated from …".

#### **Reddit deleted accounts and deleted comments (#84)**
- A comment whose author deleted their Reddit account but whose text is still there now renders the full comment card with the author shown as `[deleted]`, instead of a false "Comment unavailable". This applies to both the JSON path and the old.reddit fallback.
- `[deleted]` authors no longer get a `u/[deleted]` label or a broken reddit.com/user link, for the comment author and for a deleted parent post author.
- Only a `[deleted]` or `[removed]` body, an empty JSON body, or old.reddit's own `deleted comment` marker now counts as gone. A missing or `[deleted]` author on its own does not.
- The old.reddit fallback now finds real deleted comments, which have no `thing_t1_` id and only a `deleted comment` class plus a permalink. It matches the exact comment id from the permalink, so another deleted comment on the same page never turns the target into a tombstone.
- The fallback reads the comment body only from the comment itself, never from a reply below it.
- The fallback decodes HTML entities in comment text exactly once, including numeric ones like `&#8217;` and `&#x200B;`. A comment that says `&lt;b&gt;` shows `<b>` as text, and a double-escaped `&amp;gt;` shows the literal `&gt;` instead of `>`.
- Outages are unchanged: 429, 5xx, 403, timeouts, and parse errors still fall back and then fail as temporary, with no tombstone.
- Ships with a Worker deploy. No bot restart needed.

#### **DeviantArt fallback stats (#77)**
- When DeviantArt blocks the Worker and the card falls back to Cardyb, a `www.deviantart.com` lookup that comes back as a generic card ("Deviantart.com image by ...", no Published date, likes, or views) is retried once with the bare `deviantart.com` URL, which Cardyb has been answering with the full description.
- The retry shares the existing 5 second Cardyb timeout, so the slowest case is no slower than before, and it is skipped when Cardyb rate limits (429), when under 1 second is left, or for Sta.sh links.
- The richer card wins, and any timestamp, stats, or image the winner lacks is filled from the other lookup, so the card is never worse than before. The card link stays the `www.deviantart.com` URL.

#### **Keep Reddit links in multi-link messages during outages (#85)**
- When a Reddit comment link is skipped because Reddit is temporarily unavailable, and another link in the same message still gets a card, FixEmbed now keeps the original message and replies with that card. It no longer deletes the message (which dropped the Reddit link) or suppresses its embeds (which hid Discord's own Reddit preview).
- This applies to both delete and suppress modes for that one message only. Messages without a skipped Reddit link behave as before.
- A Reddit comment link that hit a temporary failure is no longer marked as handled, so posting it again within the 10 second duplicate window retries the card.

#### **Premium checklist path wrapping (#73)**
- Active-subscriber `/premium` checklist rows now put each `/settings → ...` target on its own line inside one inline code span.
- Spaces inside that path use non-breaking spaces so Discord cannot wrap mid-path (after `/`, or so page names like Embed Color / Card Style stay intact) on desktop or mobile.
- Checklist meaning is unchanged: same configured-vs-available perks, same deep-links, non-premium `/premium` untouched.

#### **Reddit comment outages vs deletions (#71)**
- Reddit comment cards only show "Comment unavailable" when Reddit says the comment is gone: a 404, a `[deleted]` or `[removed]` body, or the comment missing from a normal listing (a `[deleted]` author alone no longer counts, see #84).
- When Reddit is rate limited, down, blocking the request, timing out, or sending a broken response, the Worker no longer guesses. It returns a temporary failure that redirects to Reddit, so Discord keeps Reddit's own preview instead of a wrong "deleted" card.
- The old.reddit fallback now tells a live comment, a deleted comment, and an unclear page apart, and only the deleted case turns into the unavailable card.
- The bot no longer builds its own "Comment unavailable" card when a Reddit comment card fails. Automatic fixes skip the link and leave the original message alone, and the slash command sends the plain link like other services.

#### **Twitter canary contract update (#72)**
- The production canary's translation check now reads the Worker's `translation` metadata (target language matches the requested `lang`, translated description present) and looks for the bot's "Translated from …" footer, instead of the retired `Translation (XX):` description text.
- The `twitter-tombstone` canary now uses a post whose quoted post really is unavailable. The old fixture's quoted post is live again, so the Worker correctly rendered a normal quote there; the parser was not at fault.

#### **TikTok avatar and Bilibili author canary fixes (#75)**
- TikTok cards that fall back to the FxTikTok relay avatar now check that the relay's signed CDN redirect really ends in an image before using it. A stale or broken avatar is swapped for the first-party profile avatar when TikTok serves it, or left off instead of rendering a broken thumbnail.
- Bilibili emergency fallback cards retry the BiliFix oEmbed once on a timeout, 429, or 5xx, so one slow answer no longer drops the uploader name from the card.

#### **Premium activation checklist**
- Active-subscriber `/premium` now shows a configured-vs-available checklist for card color, footer branding, card style, exclusions, analytics, and bot/webhook auto-fix.
- Each configurable checklist row deep-links into the matching `/settings` page (or Embed Color modal) via a select control; bot/webhook auto-fix is called out as automatic with no toggle.
- Adds clear Discord manage/cancel/billing instructions (User Settings → Subscriptions for Premium App Subscriptions; Server Settings → Integrations → FixEmbed → Store) with no in-bot billing portal.
- Non-premium `/premium` stays the SKU subscribe flow and accurate perk list from #62.

#### **Reddit comment quote-block layout (#68)**
- Comment permalink cards now match Embedded: header is `r/{sub}` with `Posted by u/{parent author}`, the title is the parent post title (not "Comment on …"), and the comment body is a Components V2 quote block labeled "Comment by {author}:".
- Footer stats use the comment score and, when already available, the parent post comment count; the footer link stays the comment permalink.
- Parent post thumbnails still render when the Worker already supplies one. Plain post cards are unchanged.
- NSFW and spoiler parent posts mark that comment-card image sensitive the same way post cards do (`over_18` → `nsfw`, `spoiler` → `spoiler`), so Discord spoilers the media instead of showing it unspoilered.

#### **Reddit comment AMA clean-fail / Discord OG suppress (#66)**
- Unavailable or deleted Reddit **comment** permalinks now return a FixEmbed-owned tombstone card (no Reddit `redirect`, no community image/score) so Discord scrapers cannot fall through to Reddit OG (desk: AMA `…/damfr71/` → `[deleted by user] : r/shrimptank`).
- The Discord bot renders that tombstone as a clear "Comment unavailable" Components V2 failure card and still suppresses the original message embeds in suppress/delete delivery mode.
- Residual Worker error HTML for comment failures uses a non-redirect "Comment unavailable" Open Graph page instead of a generic FixEmbed Error page.

#### **Reddit comment embed hotfix (#66)**
- Recover comment score from archived old.reddit crawler HTML when `data-score` is omitted (use the visible `score unvoted` title), so live comment cards keep the score row.
- Follow Reddit's canonical 301 for mismatched `/r/{sub}/comments/{postId}/…` permalinks before fetching, so wrong-subreddit comment URLs resolve to the real community.
- Stop attaching a Reddit `redirect` on unavailable comment failures so Discord bots no longer scrape a misleading community OG card (e.g. deleted `r/shrimptank` post) when comment embeds fail.

#### **Reddit comment embeds**
- Detect Reddit comment permalinks that include a comment id (`/comments/{postId}/…/{commentId}/`, `/comment/{commentId}/`, or `?comment=`).
- Embed the linked comment (author, body, score, comment permalink) with parent-post title context instead of rendering only the parent post card.
- Degrade cleanly when a comment is deleted or unavailable, without falling back to a parent-post-only card for comment URLs.
- Keep plain post permalinks on the existing post card path; automatic conversion, `/fix`, and message-context use the same Worker metadata.
- Align Reddit marketing copy with comment embed support.

#### **Premium entitlement cache**
- Added a 10-minute TTL to the in-memory guild Premium cache so missed Discord entitlement events cannot leave paid servers stuck on free (or cancelled servers stuck on Premium) until restart.
- Update the cached Premium status from entitlement create, update, and delete handlers with a fresh timestamp so True↔False flips apply immediately.
- Treat deleted entitlements like expired ones when resolving guild Premium, matching Supporters-role `entitlement_is_active` semantics.

#### **Premium perk copy**
- Aligned `/premium` perk strings in all locales with the real paid feature set: card color, card style, branded footers, bot/webhook auto-fix, member/role exclusions, private 30-day analytics, no "Sent by", and Supporters role.
- Removed default translation from Premium perk copy so free translation is no longer sold as a paid feature.
- Updated the website `#premium` section (and Premium features teaser) to match the same paid list and to state that translation stays free.

## v1.6.0 (10/02/2026)

#### **DeviantArt stats labels**
- Removed literal `views`, `favorites`, `comments`, and `downloads` text from DeviantArt embed stats so cards show icon + number only, matching other platforms.

#### **DeviantArt Worker recovery**
- Fixed production DeviantArt Worker canaries after PR #57: DeviantArt returns HTTP 403 from Cloudflare Worker egress for both oEmbed and the public HTML page, so the page-scrape fallback never recovered.
- When oEmbed is blocked, try the public page first, then recover title, artist, signed wixmp media, publication time, and engagement stats through Bluesky Cardyb as an emergency fallback.
- Unwrap Cardyb image proxies back to trusted DeviantArt media hosts and allow the DeviantArt production canary to use fallback provenance.

#### **Threads share links**
- Restored automatic conversion for current `threads.com/share/...` links by resolving them to canonical Threads posts before rendering.
- Preserved signed Threads profile-picture URLs so Discord can retrieve creator avatars reliably.
- Rejected malformed share URLs and redirects outside Threads before any post metadata is fetched.

#### **Content visibility controls**
- Added independent server-wide **Show NSFW** and **Show Spoilers** controls for rich cards.
- Added per-channel overrides that can inherit, show, or hide each content type independently.
- Made Discord NSFW channels show both content types by default while allowing explicit channel overrides to take precedence.
- Preserved separate NSFW and spoiler classifications from Reddit and TikTok source metadata.

#### **Reddit link cards**
- Expanded Reddit link posts with their linked article, preview image, subreddit identity, publication time, upvotes, and comments.
- Restored complete Reddit self-post bodies when the JSON API is blocked, including text after apostrophes and the source paragraph and heading structure.
- Stopped text-only Reddit posts from rendering Reddit's generic fallback logo as if it were attached post media.
- Corrected subreddit avatars to use Reddit's community icon instead of unrelated legacy header artwork.
- Restored image posts by preferring Reddit's direct media files over crawler thumbnails that Discord cannot load.
- Restored playable Reddit videos with audio when the JSON API is blocked by preferring Reddit's signed, muxed packaged media and falling back to bounded DASH recovery instead of rendering only the poster image.

#### **Free all-platform translation**
- Made the default translation setting free and applied it to every supported social platform.
- Matched Embedded-style cards by replacing primary and quoted-post text when translation succeeds and adding `Translated from [language]` to the footer.
- Preserved X translation fidelity by using the platform-provided Grok translation for primary and quoted posts, including emojis, links, line breaks, and surrounding context.
- Improved source-language detection for short Hindi captions mixed with Latin names and hashtags.
- Preserved emojis, creator names, hashtags, links, and spacing around translated Hindi prose.
- Kept emoji variation selectors out of Hindi translation jobs so valid translations are not discarded.
- Restored Instagram profile pictures from owner-bound reel metadata when the legacy avatar markup is absent.
- Preserved original-language cards whenever language detection or Workers AI translation is unavailable.
- Migrated existing default X translation preferences automatically.

#### **Instagram Reel diagnostics**
- Added correlated, privacy-safe relay telemetry for Instagram Reel streams, upstream response degradation, and fetch failures without recording source URLs or shortcodes.

#### **DeviantArt deviations**
- Added public DeviantArt deviation and Sta.sh cards across automatic conversion, `/fix`, settings, reliability status, and production conformance.
- Preserved artwork titles, artist attribution, signed full-size images, publication times, views, favorites, comments, downloads, copyright context, and the dedicated DeviantArt application emoji.
- Rendered mature artwork behind Discord spoilers and kept public video deviations on a safe official preview until a reliable direct playback source is proven.
- Moved official DeviantArt oEmbed retrieval into the bot runtime after DeviantArt blocked Cloudflare Worker requests, preventing public deviations from degrading to legacy link embeds.
- Used the uploaded download application emoji for DeviantArt download counts.
- Documented and ticketed Facebook support as a gated follow-up because current first-party parity requires Meta Page Public Content Access, App Review, and business verification.

#### **TikTok, Tumblr, Twitch, and safer media**
- Restored current `vt.tiktok.com` short links that redirect through TikTok's mobile video route and split paginated photo posts across multiple Discord galleries so every source image is included.
- Added first-party TikTok video, Tumblr post, and Twitch clip, VOD, and channel cards across automatic conversion, `/fix`, context commands, settings, status probes, and production conformance.
- Matched TikTok and Tumblr cards to the creator-first Embedded layout with right-side avatars, direct TikTok video or slideshow media, engagement details, and Tumblr tags below galleries.
- Restored complete Tumblr post bodies, inline links and emphasis, and high-resolution themed-blog media instead of shortened Open Graph summaries.
- Simplified Tumblr creator headers to one linked, correctly cased blog name instead of repeating the username as a separate handle.
- Restored Tumblr hashtags from themed-blog tag metadata so the tag row appears beneath post media.
- Replaced Tumblr's generic notes symbol with the dedicated application emoji.
- Added the dedicated TikTok share application emoji to the engagement row.
- Simplified Twitch creator headers to one linked profile name and replaced the generic footer dot with the Twitch application emoji.
- Moved Twitch clip game, clipper, and duration metadata beside the view count beneath the video.
- Added FxTikTok as a bounded emergency fallback when TikTok blocks both its public page data and official oEmbed response.
- Recovered missing TikTok avatars from the creator's public profile, used FxTikTok relay URLs for stable Discord-fetchable media, and signed Twitch clip media URLs with CloudFront-aware production probes.
- Added platform-aware creator, context, gallery, mixed-media, timestamp, and engagement fields when each source exposes them.
- Restored complete Instagram carousels by reading escaped first-party sidecar data, preserving every distinct source image, and splitting galleries at Discord's 10-item component limit.
- Restored Instagram like and comment counts from the current escaped first-party sidecar fields, with bounded public-page enrichment when anonymous embed data omits them.
- Routed Instagram carousel images through a restricted FixEmbed relay, downloaded them concurrently, and attached them to the Components V2 message so Discord receives all ten images in source order without remote-media stalls.
- Restored the 15-second rich-card delivery deadline now that large Instagram galleries no longer depend on Discord fetching ten remote image URLs.
- Source-marked sensitive media now renders behind Discord spoilers across all Components V2 cards.

## v1.5.0 (07/17/2026)

#### **Release highlights**
- Completed FixEmbed's modern Discord Components V2 overhaul across every supported social platform, settings, and informational commands.
- Brought first-party X cards to feature parity with rich quote posts, playable videos, looping GIFs, complete carousels, verification badges, translations, polls, articles, Community Notes, link cards, and original publication times.
- Added Pinterest support and expanded first-party recovery for Instagram, Reddit, Threads, Pixiv, Bluesky, Bilibili, and YouTube Community Posts.
- Introduced server-customizable Premium controls, private content-free analytics, server branding, automatic X translations, and bot/webhook conversion while keeping media quality and reliability improvements free.
- Added privacy-safe conversion and delivery diagnostics, live platform health, production conformance canaries, latency budgets, permission-aware delivery recovery, and complete SparkedHost deployment bundles.
- Added product-led personal/server installation surfaces, refreshed App Discovery marketing assets, and an onboarding DM for new server owners.
- Relicensed FixEmbed under AGPL-3.0-or-later with visible source and creator attribution across public surfaces.

#### **Server install repair**
- Fixed account/server install controls so server installation requests the required bot and application-command scopes instead of failing with "No scopes were provided."
- Requests the minimum channel, media, history, emoji, message-management, and thread permissions used by automatic Components V2 delivery.

#### **Product-led installation and discovery**
- Added distinct personal and server install paths across `/invite`, `/help`, `/about`, and the public website.
- Made personal installation the primary homepage action while preserving server installation for automatic conversion and settings.
- Added focused, indexable X/Twitter, Instagram, and Reddit landing pages plus a responsive product-proof section.
- Added allowlisted, privacy-safe install redirect attribution that records only the placement label and install context.
- Added launch copy, a demonstration storyboard, measurement guidance, and a consent-first testimonial process without adding promotional copy to social-card footers.

#### **Confirmed Discord delivery**
- Waits for queued Discord sends to finish before deleting or suppressing source messages, preserving the original whenever any replacement fails.
- Bounds every component and fallback send attempt to 15 seconds so a stalled Discord request cannot freeze the delivery queue.
- Uses a representative Instagram reel for public health checks so status reflects the format users actually depend on.

#### **Resilient live status refreshes**
- Bounded every public platform-health probe to seven seconds so one stalled upstream cannot hold the entire status report open.
- Coalesced concurrent status refreshes, reused verified reports for 60 seconds, and preserved a clearly marked recent report when an unexpected refresh fails.

#### **SparkedHost deployment integrity**
- Added a deterministic SparkedHost archive containing every root Python module and required runtime metadata, with per-file sizes and SHA-256 checksums in an embedded manifest.
- Made CI build, self-verify, and retain the complete deployment artifact so missing modules cannot hide behind partial manual uploads.

#### **Pixiv first-party reliability**
- Added a cached bot-local Pixiv metadata path so cards keep the real title, creator, profile link, high-resolution avatar, full gallery, publication time, and stats when Pixiv blocks Worker traffic.
- Added a restricted, signed FixEmbed relay contract for future Worker recovery without exposing a general-purpose URL proxy; relay startup remains explicitly opt-in until a reachable allocation is configured.
- Restored creator profile links and higher-resolution creator avatars in Phixiv recovery, validated fallback identity against the requested artwork, and restricted every media URL to trusted HTTPS proxy paths.

#### **Production latency budgets**
- Added reviewed per-card cold latency budgets to the production Components V2 canaries, with bounded over-budget degradation codes and the expected budget included in privacy-safe reports.
- Kept a single slow provider sample nonfatal so transient upstream variance stays visible without turning scheduled checks into alert noise.

#### **Bilibili cold-path latency**
- Overlapped official mobile-page recovery with the emergency BiliFix request after the direct Bilibili API is unavailable.
- Preserved first-party mobile metadata priority while allowing the fallback card to make progress during blocked official requests.

#### **Repeated-link edge caching**
- Added privacy-safe Cloudflare edge caching for successful public embed API responses, cutting repeated-link latency without caching failures.
- Isolated translations and gallery/mosaic layouts in separate hashed cache entries, kept source URLs out of cache keys, and limited freshness to five minutes.

#### **CI supply-chain hardening**
- Upgraded repository workflows to the official Node 24 action releases and pinned every third-party action to an immutable commit.
- Added a regression test that rejects floating action tags and deprecated release majors while keeping Dependabot responsible for reviewed updates.

#### **Provider recovery hardening**
- Added bounded official Pixiv oEmbed and Bilibili mobile-page recovery paths before external fallbacks when platform APIs reject Worker requests.
- Added privacy-safe first-party failure diagnostics without post identifiers or source URLs.
- Restricted the Pixiv media proxy to trusted HTTPS image hosts, validated every redirect, rejected non-image responses, and closed public access to internal diagnostic routes.

#### **Continuous embed conformance**
- Added an offline-tested semantic canary runner and reviewed production manifest covering all nine Worker platforms.
- Scheduled six-hour production checks for author, original timestamp, stats, media type, and structured-section contracts, with bounded privacy-safe reports retained for 14 days.
- Added first-party/fallback provenance to the public JSON embed API and corrected YouTube health checks to exercise community posts instead of ordinary videos.

#### **Permission-aware delivery recovery**
- Automatically falls back from delete/suppress to reply mode when Manage Messages is unavailable, preserving the fixed card instead of aborting conversion.
- Handles permission changes between preflight and Discord API calls without losing queued cards.
- Shows configured versus effective delivery behavior in Delivery settings and Debug, with privacy-safe aggregate recovery counts in Reliability.

#### **Discord delivery observability**
- Added bounded, process-local direct-delivery, link-rescue, complete-failure, pending-depth, and recent p95 delivery diagnostics.
- Replaced free-form queue exception logs with structured, privacy-safe events using fixed categories and random correlation IDs.
- Split Reliability into three explicit stages—live platform health, local card quality, and Discord delivery—and removed the ambiguous legacy process counter.

#### **Privacy-safe conversion observability**
- Added bounded, process-local rich-card quality telemetry with per-service success, link-fallback, recent p95 latency, and fixed failure categories.
- Replaced URL-bearing component-build warnings with structured fallback events containing only a random correlation ID, service, category, exception type, and duration.
- Added an actionable local card-quality section to Reliability while keeping live Worker provider health visually distinct.

#### **Live reliability diagnostics**
- Connected `/settings` Reliability and `/status` to the Worker's live per-platform first-party, fallback, outage, and latency probes.
- Added a refresh control, public dashboard shortcut, 30-second report cache, five-minute verified stale-data window, and retry cooldown after failed refreshes.
- Kept local bot delivery counters visible when live Worker health is temporarily unavailable without misreporting the platform as operational.
- Allowed up to 30 seconds for the Worker's multi-platform live probe and removed unused prefix-command parsing that logged `CommandNotFound` for manually typed slash text.

#### **Original post times**
- Standardized every social card footer to use the platform's original publication time instead of the time FixEmbed converted the link.
- Omit the time when upstream metadata does not provide a valid publication timestamp rather than displaying a misleading conversion time.

#### **Premium discovery**
- Added a restrained native Premium purchase button to `/settings` for non-subscribers while keeping social embed footers promotion-free.
- Added Premium custom footer branding with the server's live name and an optional server emoji across every Components V2 social card.
- Preserved a subtle `via FixEmbed` attribution and safely degraded to the standard footer when Premium is inactive.
- Added global social-card controls for custom accents, engagement stats, hashtags, and compact captions across every Components V2 renderer.
- Added a default X translation language with explicit per-link overrides taking priority.
- Added member and role exclusions for automatic processing, rechecking Premium entitlement on every settings mutation.
- Added private 30-day analytics backed by content-free daily aggregates with 90-day retention.

#### **Server onboarding**
- Added a one-time Components V2 welcome DM to the server owner when FixEmbed joins a guild.
- The private card confirms immediate readiness and points owners to `/settings`, `/help`, Debug, and the support server without a sales prompt.

#### **Pinterest and acknowledgements**
- Added first-party Pinterest Pin metadata, full-size image and playable video cards, and safe `pin.it` short-link resolution.
- Added Pinterest Components V2 rendering, settings migration, public docs, status checks, commands, and localized service lists.
- Documented every current emergency fallback in `/about` and the README with its purpose and non-affiliation disclaimer.

#### **Licensing**
- Relicensed FixEmbed from MIT to the GNU Affero General Public License v3.0 or later.
- Added visible author attribution and source links to the hosted service and Discord `/about` surface.

#### **🚀 New Features**
- **`Components V2 Command Cards`**
  - Migrate `/about` and `/help` to the same branded Components V2 system as `/settings` and the remaining configuration commands.
  - Keep every localized help surface aligned with the complete supported-service list, including YouTube community posts.
- **`Richer First-Party X Embeds`**
  - Preserve every photo in X/Twitter carousel posts.
  - Render quoted posts as distinct nested cards with their author, avatar, linked handle, text, and media.
  - Render animated GIF posts as real `image/gif` media in Components V2 so Discord autoplays and loops them when the viewer's client settings allow it.
  - Preserve mixed photo/video media in Components V2 cards while keeping ordinary videos under playback controls.
  - Keep polls, quotes, translations, GIFs, and external video metadata when the fxTwitter recovery path is used.
  - Support opt-in translated posts by appending a two-letter language code to the status URL.
  - Render polls, quotes, Community Notes, long-form notes, X Articles, and website cards inline.
  - Add gallery and native multi-image mosaic URL modifiers.

#### **🔧 Backend Changes**
- **`Consistent Branded Discord Cards`**
  - Render every supported platform with the same creator, engagement, content, media, and branded footer hierarchy used by FixEmbed's X cards.
  - Condense card footers into linked FixEmbed and platform labels followed by the post time.
  - Use creator avatars when available and route non-X embeds through Discord's Mastodon-compatible status discovery.
- **`Discord X Text Rendering`**
  - Preserve paragraphs and numbered lists in ActivityPub-backed X embeds.
  - Carry the complete Discord-sized post description instead of truncating it at 1,000 characters.
  - Use an author-first ActivityPub layout for X videos, with post text before engagement and the original post timestamp in the footer.
- **`Automatic X Provider Switch`**
  - Allow automatic server conversions to use FxTwitter temporarily while `/fix` and direct FixEmbed links continue exercising the first-party renderer.
- **`Workers AI Translation`**
  - Translate requested X posts with Cloudflare's M2M100 binding while retaining the original text.
  - Keep the original first-party embed when translation is unavailable instead of failing the post.
- **`Direct X GraphQL Enrichment`**
  - Use X's guest GraphQL response as the primary rich-data source, with public syndication and FxTwitter retained as successive fallbacks.
  - Advertise all media through the existing first-party ActivityPub route for Discord multi-image support.

#### **🧪 Testing**
- Added regression coverage for multi-photo carousels, translations, polls, quotes, notes/articles, Community Notes, link cards, gallery mode, and native multi-image metadata.

## v1.4.8 (07/11/2026)

#### **🔧 Enhancements**
- **`Application Emoji Integration`**
  - Added the new YouTube application emoji to service settings and status views.
  - YouTube embed branding now follows the same icon-first layout as other supported platforms.

#### **🔧 Backend Changes**
- **`Consistent Platform Branding`**
  - Routed every YouTube metadata path through the shared branded-name formatter so first-party and fallback cards stay consistent.

#### **🧪 Testing**
- Added regression coverage for the YouTube application emoji ID and branded embed header.

#### **📝 Documentation**
- Updated the website, website documentation, metadata, and README to advertise YouTube Community Post support consistently.

## v1.4.7 (07/11/2026)

#### **🚀 New Features**
- **`YouTube Community Posts`**
  - Added first-party embeds for YouTube community post links.
  - Community cards include the creator, post text, engagement stats, avatar, and the largest available image.

#### **🔧 Enhancements**
- **`Instagram Share Links`**
  - Added support for Instagram `/share/p/` and `/share/reel/` URLs.
  - Share links are resolved directly through Instagram before entering FixEmbed's existing post and reel pipeline.
- **`Tagged User Context`**
  - Messages replaced in delete mode now preserve the users tagged in the original message.
  - Preserved tags are displayed without sending duplicate mention notifications.

#### **🔧 Backend Changes**
- **`First-Party Community Post Parser`**
  - Added resilient parsing for YouTube post data and Open Graph metadata with native-link fallback behavior.
- **`Safe Mention Delivery`**
  - Extended the Discord send queue to carry explicit allowed-mention policies.
- **`Existing Server Migration`**
  - Added a one-time migration that enables YouTube community posts for existing guilds while preserving later administrator opt-outs.

#### **🧪 Testing**
- Added regression coverage for YouTube community layouts, Instagram share resolution, and tagged-user preservation.

## v1.4.6 (07/11/2026)

#### **🚀 New Features**
- **`Premium Supporters Role`**
  - Active Premium purchasers now automatically receive the `Supporters` role in the FixEmbed Support Server.
  - Subscribers who join the support server after purchasing Premium receive the role when they arrive.

#### **🔧 Enhancements**
- **`Subscription Lifecycle Sync`**
  - Existing entitlements are reconciled when the bot starts so current subscribers are recognized immediately.
  - Entitlement creation and renewal preserve the role, while expiration, deletion, and refunds remove it.

#### **🧪 Testing**
- Added regression coverage for role grants, expirations, unrelated SKUs, and subscribers outside the support server.

## v1.4.5 (07/11/2026)

#### **🚀 New Features**
- **`Top.gg Voter Role Rewards`**
  - Added a first-party Top.gg vote webhook that automatically grants the existing `Voter` role in the FixEmbed Support Server.
  - Real `vote.create` events grant the role idempotently; Top.gg test events validate the endpoint without granting rewards.

#### **🔧 Backend Changes**
- **`Secure Webhook Verification`**
  - Added raw-body HMAC SHA-256 signature verification, timestamp replay protection, payload limits, and strict FixEmbed project validation.
  - Added an authenticated Discord REST role assignment with safe handling for voters who have not joined the support server.

#### **🧪 Testing**
- Added regression coverage for rejected signatures, valid vote rewards, and non-rewarding test events.

## v1.4.4 (07/11/2026)

#### **🔧 Enhancements**
- **`Reliable Reddit Post Cards`**
  - Added a first-party recovery path through Reddit's official embed page when its legacy JSON endpoint denies access.
  - Reddit cards now preserve the actual post title, author, image, score, and comment count instead of falling back to Reddit's generic community embed.

#### **🧪 Testing**
- Added regression coverage for Reddit JSON `403` responses and official embed recovery.

## v1.4.3 (07/11/2026)

#### **🔧 Enhancements**
- **`Classic X Card Layout`**
  - Restored the familiar X presentation with engagement stats, the linked `@handle`, tweet text, and media in that order.
  - Kept the standardized duplicate-content cleanup for Instagram and other platforms while treating X as an intentional layout exception.

#### **🧪 Testing**
- Added regression coverage to preserve X handles as titles and tweet text as body copy.

## v1.4.2 (07/11/2026)

#### **🔧 Enhancements**
- **`Consistent Platform Card Layout`**
  - Standardized every platform on the same creator, content, optional description, engagement, and media hierarchy.
  - Removed creator names from the content-title position when the handle or person is already displayed above it.
  - Prevented identical titles and descriptions from rendering twice.
- **`Instagram Engagement Context`**
  - Added likes and comment counts when Instagram includes them in its first-party embed data.

#### **🔧 Backend Changes**
- **`Shared Layout Normalization`**
  - Added one renderer-level normalization policy so first-party and fallback handlers remain visually consistent.
  - Updated Instagram recovery paths to preserve creator attribution without replacing the post caption.

#### **🧪 Testing**
- Added regression coverage for duplicate creator titles, distinct descriptions, and Instagram engagement stats.

## v1.4.1 (07/11/2026)

#### **🔧 Fixes**
- **`Instagram Media Rendering`**
  - Restored media for Instagram image posts when Instagram's embed document contains captions but omits media URLs.
  - Restored playable reel video embeds through FixEmbed's media proxy when the direct Instagram response is incomplete.
  - Added separate media recovery paths for VxInstagram and KKInstagram before the existing Snapsave fallback.
  - Normalized Instagram's HTML-escaped CDN query strings so Discord receives valid media URLs instead of double-escaped links.
  - Added an embed revision parameter so Discord recrawls corrected media instead of retaining stale caption-only cards.
  - Simplified Instagram cards to show attribution and the caption once instead of repeating the same text in the title and body.

#### **🔧 Backend Changes**
- **`Instagram Regression Coverage`**
  - Added post and reel tests that prevent caption-only Instagram embeds from returning unnoticed.

## v1.4.0 (07/11/2026)

#### **🚀 New Features**
- **`Direct-First Embed Pipeline`**
  - Every supported platform now attempts an original-platform data source before any external embed service.
  - FixEmbed owns URL handling, metadata parsing, branded rendering, media proxying, error handling, and fallback selection on its Cloudflare Worker.

#### **🔧 Enhancements**
- **`Instagram and YouTube Ownership`**
  - Instagram now uses its native embed document before VxInstagram or Snapsave.
  - YouTube now uses its official oEmbed endpoint before Invidious.
- **`Pixiv and Bilibili Ownership`**
  - Pixiv and Bilibili now query their original-platform metadata endpoints before Phixiv or VxBilibili.
- **`Honest Source Reporting`**
  - Handler responses identify direct rendering as first-party and external recovery paths as fallbacks.

#### **🔧 Backend Changes**
- **`Emergency Fallback Policy`**
  - FxTwitter, VxInstagram, Snapsave, Phixiv, VxBilibili, and Invidious remain available only when their respective direct path fails.
- **`Direct-Path Regression Coverage`**
  - Added tests that verify Instagram, YouTube, Pixiv, and Bilibili contact their original platforms before external services.

## v1.3.1 (07/11/2026)

#### **🔧 Fixes**
- **`Multi-Link Automatic Conversion`**
  - Removed a deprecated `TextChannel.trigger_typing()` call that caused automatic conversion to fail when a message contained multiple supported links.
- **`Runtime Compatibility Check`**
  - Added a regression check so the unsupported discord.py API cannot return unnoticed.

## v1.3.0 (07/11/2026)

#### **🚀 New Features**
- **`First-Party X/Twitter Embeds`**
  - FixEmbed now fetches and renders X/Twitter post text, authors, media, and engagement data through its own Cloudflare Worker.
  - FxTwitter remains available only as an emergency fallback when first-party rendering cannot complete.
- **`Multi-Link /fix`**
  - `/fix` now converts every supported link in one invocation while preserving the original order.
  - Already-fixed FixEmbed, FxTwitter, and Bluesky proxy links normalize back to canonical source URLs.

#### **🔧 Enhancements**
- **`One Canonical Link Engine`**
  - Slash commands, the message context command, and automatic conversion now share the same host-safe parser, labels, suppression rules, and FixEmbed URL builder.
  - Multi-link automatic conversion sends and deletes or suppresses once per message instead of repeating those actions for each link.
- **`Honest Reliability Dashboard`**
  - Replaced synthetic uptime percentages with live first-party/fallback state, current latency, check time, and incident notices.
  - Escaped live status content before rendering it in the dashboard.
- **`Release Metadata Guard`**
  - Added an automated release check so the bot version, manifests, service package, and changelog cannot silently drift apart.

#### **🔧 Fixes**
- **`Instagram Reels`**
  - Fixed Instagram `/reels/` links across the bot and embed service.
- **`Bluesky Link Recognition`**
  - Fixed Bluesky handles ending in `x.com` being misclassified as Twitter.
  - Added support for already-fixed `bskyx.app` links.
- **`Bluesky Post Text`**
  - Preserved the full text of Bluesky posts in embeds.
- **`Discord Sharding`**
  - Enabled Discord automatic sharding so large-scale gateway startup succeeds reliably.

## v1.2.7 (03/28/2026)

#### **🚀 New Features**
- **`New Status Page`**
  - Added a public status dashboard for the embed service with per-platform uptime, latency, and incident notices.
- **`Power User Commands`**
  - Added `/delivery`, `/quality`, `/rule`, and `/status` commands for faster advanced configuration and diagnostics.

#### **🔧 Enhancements**
- **`Icons for All Services`**
  - Added or completed branded icons for every supported service.
- **`Default Conversion Behavior`**
  - Set the default delivery behavior to suppress the original embed instead of deleting the original message.
- **`Language Selection UX`**
  - Added country flags to the language selector to make multilingual settings easier to scan.
- **`Threads.com Support`**
  - Added support for `threads.com` links alongside the existing `threads.net` URLs.
- **`Opt-Out Link Handling`**
  - Respect links wrapped in angle brackets (`< >`) so users can intentionally prevent automatic conversion.
- **`Embed Service Test Coverage`**
  - Added a lightweight TypeScript test harness for service URL parsing and handler routing.
  - Added coverage for supported platform routing and Twitter redirect behavior.
- **`Node-Compatible Service Imports`**
  - Updated the Cloudflare Worker TypeScript imports to run cleanly under direct local Node-based test execution.

#### **📝 Documentation**
- **`README Updates`**
  - Updated user-facing supported service strings across all translations.

## v1.2.6 (03/15/2026)

#### **🚀 New Features**
- **`Server Subscriptions (Premium Tier)`**
  - Integrated Discord Server Subscriptions via Entitlements API.
  - New `/premium` command to view perks, status, and subscribe for $1.99/month.
  - **`Custom Embed Colors`**: Premium guilds can now set a custom branding color for bot responses via `/settings`.

#### **🔧 Enhancements**
- **`Premium Perk: Bot Compatibility`**
  - Premium servers now process and fix links sent by other bots.
- **`Premium Perk: Clean Embeds`**
  - Removed "Sent by @user" label for premium servers to provide a cleaner look.
- **`Link Suppression Logic`**
  - Improved link suppression handling—wrapping a single link in `< >` no longer suppresses other non-wrapped links in the same message.
- **`Discoverability`**
  - Added a "💎 Premium" section to the `/help` command to showcase benefits.
  - Custom branding colors now apply to all bot command embeds (`/help`, `/about`, `/settings`, debug info).

#### **🔧 Backend Changes**
- **`Database Schema Update`**
  - Added `embed_color` column to `guild_settings` to persist custom colors.
- **`Subscription Lifecycle Handling`**
  - Implemented event handlers for subscription creation, update, and expiration.
  - Added in-memory caching for guild premium status to minimize API calls.

#### **📝 Documentation**
- **`Updated translations.py`**
  - Added 24 new translation keys for premium features across all 8 supported languages.
- **`Updated README.md`**
  - Added comprehensive Premium section detailing perks and setup.
  - Documented new link suppression behavior.
