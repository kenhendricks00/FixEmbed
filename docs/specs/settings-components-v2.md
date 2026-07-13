# Spec: Settings Components V2

## Objective

Modernize FixEmbed's private configuration experience with Discord Components V2 while preserving every existing setting, permission check, database write, and navigation path.

## Tech Stack

- Python 3.12
- discord.py 2.7 `LayoutView`, `Container`, `TextDisplay`, `Separator`, and `ActionRow`
- Existing SQLite-backed settings state and translation catalog

## Commands

- Compile: `python -m py_compile main.py settings_components.py`
- Test: `python -m unittest discover -s tests -v`

## Project Structure

- `main.py`: interactive settings controls and callbacks
- `settings_components.py`: reusable Components V2 layout composition
- `tests/`: layout and runtime regression coverage

## Code Style

```python
render_settings_layout(
    view,
    title="Service Settings",
    description="Choose which links FixEmbed should process.",
    controls=((service_select,), (navigation_select,)),
)
```

Settings pages render one branded container, keep controls in explicit action rows, and update through the same layout helper.

## Testing Strategy

- Unit-test the reusable layout helper and its component structure.
- Add static runtime guards proving settings use `LayoutView` and no longer send legacy embeds.
- Run the full Python suite and compile all touched modules.
- Verify the deployed bot reconnects every shard and syncs commands.

## Boundaries

- Always: keep responses ephemeral; preserve persistence and permissions; retain all current settings choices.
- Ask first: schema changes, new dependencies, or changes to premium entitlements.
- Never: expose configuration publicly, upload media, or mix legacy embeds with Components V2 layouts.

## Success Criteria

- `/settings` returns a branded Components V2 container.
- Every page opened from the settings navigation uses Components V2.
- Toggle, select, channel-rule, language, quality, delivery, status, debug, and premium-gate states remain functional.
- Existing modals remain functional.
- All tests and compilation checks pass.

## Open Questions

None. The migration intentionally preserves the existing workflow and wording.
