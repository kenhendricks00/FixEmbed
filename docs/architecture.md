# Code layout

FixEmbed runs a Python Discord bot and a TypeScript Cloudflare Worker. The bot
retrieves metadata, builds Discord rich cards, and applies server delivery
settings. The Worker retrieves supported links and serves HTML, JSON, activity
responses, media, and the public website.

## Discord bot

Run `python main.py` as before. Importing `main` or `fixembed.app` does not load
credentials or connect to Discord. `fixembed.app.run()` loads `.env`, checks
`BOT_TOKEN`, registers commands and events, and starts the client.

The repository root contains the launcher and project files. All Python bot
implementation lives under `fixembed/`:

```text
main.py
fixembed/
  platforms/       # Platform cards, metadata client, and Pixiv relay
  presentation/    # Shared card formatting, preferences, and timestamps
  premium/         # Premium controls and supporter roles
  telemetry/       # Conversion, delivery, and reliability reporting
  conformance/     # Card contracts and live canary runner
  settings/        # Discord settings screens
  app.py           # Launch the bot
  commands.py      # Discord commands
  events.py        # Discord events
  storage.py       # Database access
  ...
service/           # Separate TypeScript Cloudflare Worker
tests/
scripts/
docs/
```

| Module | Responsibility |
| --- | --- |
| `fixembed/config.py` | Release version, supported services, and application emoji IDs |
| `fixembed/runtime.py` | Discord client lifetime, telemetry instances, and guild presentation helpers |
| `fixembed/storage.py` | SQLite schema migration, settings defaults, writes, and cached guild/channel settings |
| `fixembed/cards.py` | Platform dispatch, translation preferences, attachments, and command delivery fallback |
| `fixembed/delivery.py` | Rate-limited send queue, completion results, and cancellation |
| `fixembed/commands.py` | Slash commands and the Fix Embed message command |
| `fixembed/events.py` | Startup, automatic link processing, onboarding, and entitlement events |
| `fixembed/settings/` | Settings navigation and general, visibility, premium, and diagnostic pages |
| `fixembed/platforms/client.py` | Standard Worker metadata requests and response validation |
| `fixembed/platforms/` | Platform-specific rich-card rendering and specialized media recovery |
| `fixembed/presentation/` | Shared card formatting, preferences, emojis, mentions, and timestamps |
| `fixembed/premium/` | Premium settings, exclusions, analytics, and supporter roles |
| `fixembed/telemetry/` | Conversion and delivery metrics and reliability reports |
| `fixembed/conformance/` | Rich-card contracts, media checks, and the canary command |

The settings package separates shared card containers from individual pages.
Navigation imports page classes when a menu selection runs, so pages can use
the shared menu without circular imports.

Settings writes accept a mapping through `save_guild_settings`. SQLite table
and column names, the `fixembed_data.db` filename, and enabled-service list
serialization remain compatible with earlier versions. New columns are added
only when absent. Exhausted database lock retries raise an error to the caller.

All automatic delivery modes share one send loop. The source message is deleted
or suppressed only after every replacement has reached Discord, including any
successful link fallback. Queue timing uses a monotonic clock.

Ready events serialize initialization and skip it after success. Shutdown
cancels background sends and releases the database and optional Pixiv relay.

## Worker

`service/src/index.ts` composes route modules and applies CORS, request logging,
webhook handling, and error responses. It remains the Wrangler entry point.

| Module | Routes or behavior |
| --- | --- |
| `routes/site.ts` | Public pages, static assets, and install redirects |
| `routes/status.ts` | Live probes and cached `/api/status` reports |
| `routes/embeds.ts` | `/embed` and `/api/embed` |
| `routes/activity.ts` | oEmbed, ActivityPub, and Mastodon-compatible responses |
| `routes/media.ts` | Media proxy and relay routes |
| `routes/platforms.ts` | Direct platform URL redirects, registered last |
| `utils/embed_request.ts` | Handler selection, rendering options, and requested translation |
| `handlers/` | Direct sources and platform-specific fallback sources |

Media allowlists, relay validation, cache behavior, route paths, and response
formats remain in their existing modules. Disabled `/debug/*` routes return
404. Their unreachable diagnostic implementations have been removed. The unused
nested copy of the service has been removed from the active source tree.

## Validation and packaging

Run these from the repository root with Python dependencies installed:

```sh
python -m unittest discover -s tests
python -m compileall -q fixembed main.py
python scripts/check_release_metadata.py
python scripts/build_sparkedhost_bundle.py
python scripts/build_sparkedhost_bundle.py --verify dist/fixembed-sparkedhost.zip
```

Run these from `service`:

```sh
npm test
npm run typecheck
```

The SparkedHost bundle includes `main.py`, all Python sources under `fixembed/`,
and the required metadata files. It excludes unrelated root scripts, bytecode,
virtual environments, and secrets. Upload and
extract the whole bundle, preserving its directories. The startup command remains
`python main.py`. Docker copies the same package and excludes local environments
and build artifacts.

Bot orchestration tests exercise command registration, settings navigation,
storage migration, platform dispatch, cancellation, reconnects, and delivery
outcomes. Existing platform tests continue to check rich-card contents. Worker
tests exercise the composed app through HTTP requests without deployment.

Run live canaries with `python -m fixembed.conformance --manifest conformance/production.json`.
The JSON manifest remains in the root `conformance/` data directory. The former
root `conformance.py` command has been replaced by this package command.
