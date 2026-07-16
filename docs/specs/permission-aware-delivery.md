# Spec: Permission-Aware Delivery

## Objective

Keep fixed cards deliverable when a server selects a mode that requires Manage
Messages but FixEmbed does not currently have that permission.

## Product Decisions

- `delete` and `suppress` remain the configured behavior when Manage Messages
  is available.
- Without Manage Messages, both modes automatically become `reply` for that
  message. The original remains visible and the fixed card is still sent.
- A permission race at the Discord API boundary is also non-fatal: failed
  suppression does not block the send, and failed deletion does not invalidate
  already queued cards.
- `reply` never requires Manage Messages and is never downgraded.
- Delivery settings and Debug explain configured versus effective behavior.
- Reliability counts process-local automatic recoveries without storing where
  they occurred.

## Tech Stack and Structure

- `delivery_policy.py`: pure normalization, capability policy, and operator text.
- `delivery_telemetry.py`: bounded aggregate downgrade counter and Reliability
  rendering.
- `main.py`: Discord permission preflight, race-safe source-message actions,
  settings guidance, and Debug guidance.
- `tests/test_delivery_policy.py`: mode matrix and operator-text unit tests.

## Authoritative Discord Contracts

- [Permissions reference](https://discord.com/developers/docs/topics/permissions#permissions-bitwise-permission-flags):
  `MANAGE_MESSAGES` permits deleting other users' messages.
- [Edit Message](https://discord.com/developers/docs/resources/message#edit-message):
  another user may edit message flags only with `MANAGE_MESSAGES`; this includes
  the `SUPPRESS_EMBEDS` flag.
- [Delete Message](https://discord.com/developers/docs/resources/message#delete-message):
  deleting another user's guild-channel message requires `MANAGE_MESSAGES`.

## Privacy Boundary

- Recovery diagnostics retain only a fixed downgrade reason and aggregate count.
- Never retain or log guild, channel, message, member, post, or URL identity.
- Counters are process-scoped and reset whenever the bot restarts.

## Success Criteria

- Suppress/delete plus Manage Messages preserves the configured behavior.
- Suppress/delete without Manage Messages sends through the reply path.
- A Forbidden response during suppression still proceeds to queued delivery.
- A Forbidden response during deletion is handled after cards are queued.
- Delivery settings and Debug tell administrators when reply recovery is active.
- Reliability reports how often automatic permission recovery occurred.
- Existing rate limiting, fallback links, and delivery telemetry remain intact.

## Not Doing in This Slice

- Automatically modifying Discord roles or channel permission overwrites.
- Persisting permission incidents or server/channel identifiers.
- Changing a server's saved delivery preference without an administrator action.
