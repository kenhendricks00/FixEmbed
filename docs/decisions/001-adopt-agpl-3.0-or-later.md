# ADR-001: Adopt AGPL-3.0-or-later

## Status

Accepted

## Date

2026-07-13

## Context

FixEmbed was previously licensed under MIT. That license required preservation of its copyright and permission notice, but it allowed modified copies to be distributed under closed terms. FixEmbed is both self-hostable software and a network service composed of a Discord bot and a Cloudflare Worker. The project owner wants FixEmbed to remain useful to the public while ensuring that downstream alterations retain legal attribution and remain available as source code.

Ordinary GPL-3.0 copyleft is triggered when covered software is conveyed. It does not require an operator to publish modifications that are used only to provide a network service. AGPL-3.0 adds that network-interaction requirement, which matches FixEmbed's deployment model.

## Decision

License FixEmbed releases beginning with this change under the GNU Affero General Public License version 3 or, at the recipient's option, any later version (`AGPL-3.0-or-later`).

Keep the canonical license text in the repository root. Identify Kenneth Hendricks as FixEmbed's creator in project documentation and user-facing source links. Modified versions remain subject to the license's preservation-of-notices, change-notification, corresponding-source, and network-interaction requirements.

Third-party components retain their own licenses and notices. Dependency license metadata must not be rewritten to AGPL merely because FixEmbed uses those dependencies.

## Alternatives Considered

### MIT

- Maximizes reuse and permits proprietary forks.
- Rejected because it does not require altered forks to publish their source.

### GPL-3.0-or-later

- Requires distributed derivative works to remain under GPL-compatible copyleft terms.
- Rejected because a modified FixEmbed service could be operated over a network without conveying the software or offering its source.

### AGPL-3.0-only

- Provides the desired network copyleft at a fixed license version.
- Rejected in favor of `or later` so recipients may adopt a future GNU AGPL version without another relicensing effort.

## Consequences

- Modified public network deployments must offer their users the corresponding source code.
- Distributed modified versions must retain applicable legal notices, identify changes, and remain under compatible copyleft terms.
- Commercial use remains permitted; the license protects source availability rather than prohibiting competition.
- Releases already received under MIT remain available under their original terms. The change applies to this version and later contributions accepted under the new repository license.
- Contributors and reviewers must preserve third-party notices and verify license compatibility when adding code or assets.
