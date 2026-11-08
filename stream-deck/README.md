# The Grind Usage for Stream Deck+

Open `dist/com.scattabraingenius.grind.streamDeckPlugin` on your Mac or Windows PC with Stream Deck 7.1 or newer. Stream Deck supplies Node 24; no separate Node installation or provider login is needed.

Drag **The Grind Usage → Usage Panel** onto the four dial slots. Defaults, left to right: Cue session, Cue weekly, misc session, misc weekly. Select provider, quota window and style in the property inspector. Rotate to switch between burn-down and daily history, tap to change quota window, press to reread the shared feed (10-second cooldown). Add **Open Dashboard** to a key for the full page.

Colors match The Grind: dark plum, blue Codex/misc, copper Claude/Cue. Both styles show remaining quota calculated from provider usedPercent. Missing windows are unavailable, not zero. Quota charts end at provider measurement time and mark stale readings after 30 minutes. Cost history comes from local CodexBar logs and is an API price estimate, not billed spending. Unavailable cost scans remain unavailable.

One fetch is shared across all panels every two minutes. It reads only the existing usage Gist, never provider auth endpoints. Last successful feed is cached at `~/.grind-streamdeck/usage.json` for offline display. No credentials are stored by this plugin.

Daily cost/token export is opt-in: set `include_cost_history` to `true` in the existing GrindUsage config only after approving aggregate history in the shared Gist. Quota-only feeds continue to work without this setting.

The collector at `scripts/usage-feed/push_usage.py` exports aggregate daily cost/token totals, dropping paths, project names, account identifiers and model details. Updating the repository alone does not update a Mac collector already installed in Application Support; that installed copy must be replaced separately.

Validation: official Elgato CLI pack/schema checks, shared renderer unit tests and mocked Stream Deck protocol/control tests. Physical Stream Deck display and installation still require hardware verification.

Repackage after source edits: copy `dash/usage-widgets.js` to the plugin folder, then run `npm exec --yes --package=@elgato/cli -- streamdeck pack ./com.scattabraingenius.grind.sdPlugin --output ./dist --force` from this directory.
