# Implementation Plan: Product-Led Acquisition Surfaces

## Phase 1: Install contract

- [ ] Add bot install-link helpers and command-card button coverage.
- [ ] Add validated Worker redirect helpers and route coverage.

### Checkpoint

- [ ] Focused Python and Worker tests pass.

## Phase 2: Discovery surfaces

- [ ] Add `/invite` and install controls to `/help` and `/about`.
- [ ] Replace ambiguous homepage CTAs with account/server choices.
- [ ] Add shared `/twitter`, `/instagram`, and `/reddit` landing pages.

### Checkpoint

- [ ] Commands render valid Components V2 layouts.
- [ ] Website tests and TypeScript checks pass.

## Phase 3: Launch support

- [ ] Document privacy-safe attribution semantics.
- [ ] Add launch copy, demo storyboard, and testimonial intake guidance.
- [ ] Update README and changelog.

### Complete

- [ ] Full Python and Worker release matrix passes.
- [ ] Changes are reviewed, committed, pushed, deployed, and browser-verified.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| OAuth context is ambiguous | Failed activation | Separate tested user/server destinations |
| Attribution becomes tracking | Trust loss | Fixed labels only; no cookies or identity |
| New pages drift visually | Lower credibility | One shared landing-page renderer |
| Growth UI becomes spam | Bot removals | No CTA in normal social-card footers |
