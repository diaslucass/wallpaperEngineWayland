# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A GNOME Shell extension (UUID `wallpaperengine@waylandwe`) that renders animated
wallpapers (MP4/WebM/MKV/GIF via `mpv`) and Steam Wallpaper Engine Workshop scenes
(via `linux-wallpaperengine`) as true desktop wallpapers on GNOME Wayland — where
Mutter has no `wlr-layer-shell` support and no public API for background surfaces.
The trick: spawn the renderer as a normal window, then have the extension (running
inside GNOME Shell, with shell-level privileges) reparent its compositor actor into
GNOME's own background layer.

Full docs live in `docs/` — `docs/architecture.md` and `docs/development.md` are the
most load-bearing for engineering work; read them before making non-trivial changes.
Some parts of `docs/architecture.md` describe an earlier implementation (e.g. it
still mentions `window.stick()` and plain PID-based matching) — where it disagrees
with `extension.js`, the code is current; treat `docs/architecture.md` as due for a
refresh alongside any change that touches window adoption.

## Commands

```bash
# Syntax check (no build step — files ship as-is)
node --check extension.js prefs.js

# Install a working copy without touching system deps / rebuilding linux-wallpaperengine
./scripts/install-fedora.sh --no-deps --no-engine

# Full install (RPM Fusion, mpv, builds linux-wallpaperengine, installs extension + schema)
./scripts/install-fedora.sh

# Compile the GSettings schema after editing schemas/*.gschema.xml
glib-compile-schemas ~/.local/share/gnome-shell/extensions/wallpaperengine@waylandwe/schemas/

# Enable / open prefs
gnome-extensions enable wallpaperengine@waylandwe
gnome-extensions prefs wallpaperengine@waylandwe

# Live logs
journalctl -f -o cat /usr/bin/gnome-shell | grep -i wallpaperengine   # extension.js
journalctl -f -o cat /usr/bin/gjs                                      # prefs.js
```

There is no test suite — `npm test` is a stub. Verification is the manual checklist
in `docs/development.md#testing-checklist`, run by hand against a real session.

### The Wayland reload constraint (read this before debugging "my change didn't do anything")

**GNOME Shell never re-imports an extension's ES module within a session.**
`gnome-extensions disable && enable` just re-runs the *already-imported* code —
edits to `extension.js` are invisible until the *whole session* restarts. `prefs.js`
is exempt (it's a separate short-lived GTK process; just relaunch
`gnome-extensions prefs wallpaperengine@waylandwe` after copying it).

To pick up an `extension.js` change:
```bash
./scripts/install-fedora.sh --no-deps --no-engine   # or: cp extension.js ~/.local/share/gnome-shell/extensions/wallpaperengine@waylandwe/
# then log out and log back in — nothing else reloads it
```
For faster iteration without logging out, run a nested shell instead (it has its own
dconf, so re-apply test settings inside it):
```bash
dbus-run-session -- gnome-shell --nested --wayland
```
When verifying a fix after a real logout, add a temporary `console.warn()` with a
revision marker at the top of `enable()` and grep the journal for it — this is the
only reliable way to confirm the running shell actually loaded your new code instead
of a stale import.

## Architecture

Three independent processes, connected only through GSettings and Wayland/X11
window management — never direct IPC:

- **`extension.js`** — runs inside `gnome-shell`. Orchestrates spawn → window
  adoption → embed → power management → crash recovery → teardown.
- **Renderer subprocess** — `linux-wallpaperengine --window WxH` or `mpv
  --wayland-app-id=gwe-mpv-renderer`. Knows nothing about the extension; it's just a
  windowed video/scene player.
- **`prefs.js`** — separate GTK4/Libadwaita process (`Adw.PreferencesWindow`).
  Talks to the extension *only* by writing GSettings keys; the extension's blanket
  `changed` handler picks up any key change and restarts the engine (debounced).

### Window adoption — the core mechanism

1. Renderer is spawned via `Meta.WaylandClient.new_subprocess()` (compositor-native
   client, so Mutter tracks ownership authoritatively) with a `Gio.Subprocess`
   fallback for environments where that API is unavailable.
2. `global.display::window-created` fires; `_onWindowCreated()` polls the new
   window every 100ms (up to 20 times — Wayland app-ids/titles often aren't set
   at creation time) until `_windowMatchesRenderer()` confirms it.
3. Identity is resolved in priority order: already-adopted-window identity →
   `WaylandClient.owns_window()` (authoritative) → PID match against the spawned
   subprocess → wm_class/title fallback (`RENDERER_WM_CLASSES`,
   `MPV_APP_ID = 'gwe-mpv-renderer'`). Callers pass inconsistent types here — GNOME's
   own `Workspace._isOverviewWindow` hands a `MetaWindow`,
   `WorkspaceThumbnail._isOverviewWindow` hands a `MetaWindowActor` — so this method
   unwraps `get_meta_window()` when present and guards on `get_pid` being a function.
4. `_tryAdoptWindow()` sizes/positions the window to the target monitor, lowers it,
   and reparents its compositor actor (`window.get_compositor_private()`) into
   `Main.layoutManager._backgroundGroup` — the same persistent, cross-workspace layer
   GNOME's static wallpaper lives in, sitting at the bottom of `global.window_group`
   (below every window actor, including desktop-icon windows). It does **not** call
   `window.stick()`: marking the window itself sticky while its actor lives outside
   the normal per-workspace stacking makes `workspaceAnimation.js`'s `_syncStacking`
   crash looking up a stacking record that no longer exists — reparenting into the
   background group already makes it visible on every workspace.
5. Because GNOME can recreate its static background actors after the video was
   adopted (most notably right after login), the actor is re-pinned to the top of
   `_backgroundGroup` on every `child-added` on that group, so a fresh static
   background can never end up drawn over the video.
6. A wallpaper must never behave like an app: `_installOverviewHiding()` installs
   seven `InjectionManager` method overrides (Overview, workspace thumbnails,
   Alt-Tab/`get_tab_list`, `get_window_actors`, `WindowTracker.get_window_app`,
   `Shell.App.get_windows`/`get_n_windows`, `AppSystem.get_running`) so the renderer
   window never appears as a running app anywhere in the shell. Every override closure
   is wrapped in try/catch — GNOME's internal method signatures are private API and
   have changed across versions, so a mismatch must degrade to "assume not the
   renderer" rather than crash the shell.
7. The renderer window must also never steal focus or get raised: `raised` is
   connected (`connect_after`) to immediately `lower()` it back, and `focus` is
   connected to `_refocusNormalWindow()`, which re-activates the most-recently-used
   normal window from `global.display.get_tab_list()`. Without this, a click landing
   on "the desktop" (i.e. on the wallpaper's own surface) visibly yanks focus away
   from whatever app was active.
8. `_forgetWindow()` disconnects everything (`unmanaged`/`raised`/`focus`/
   `child-added`) and clears references; `_releaseWindow()` hands the actor back to
   `global.window_group` *before* the process is killed, so Mutter destroys the
   window actor from the parent it expects.

### Async safety invariant

Every timer/signal callback checks `this._destroyed` and/or compares against the
current `this._proc`/`this._rendererWindow`, so callbacks firing after `disable()`
(which runs on every screen lock, since `metadata.json` declares
`"session-modes": ["user"]`) or after a restart replaced the process are harmless
no-ops. **Preserve this invariant in any change** — it's what makes lock/unlock
cycles safe.

### Process lifecycle

`_startEngine()` → running → `_setPaused()` sends `SIGSTOP`/`SIGCONT` on
screensaver activate/deactivate (via `org.gnome.ScreenSaver` D-Bus
`ActiveChanged`) → crash triggers `_onEngineExited()` → `_scheduleRestart()`
(a single 700ms-debounced timer, also triggered by any GSettings change or
`monitors-changed`) retries up to `MAX_CRASH_RETRIES = 3`, with the counter reset
after `STABLE_RUNTIME_US` (30s) of stable uptime; past that, a desktop notification
fires and no more retries happen until the user acts.

### Settings → argv

`_resolveEngine()` implements "Automatic": `wallpaperengine` iff `wallpaper-id` is
set **and** the configured binary is found, else `mpv`. `_buildWallpaperEngineArgv()`
/ `_buildMpvArgv()` map GSettings keys to CLI flags — see
`docs/configuration.md#setting--engine-flag-mapping` for the exact table before
adding or changing a setting. `linux-wallpaperengine` always uses `--window
0x0xWIDTHxHEIGHT` (not `--screen-root`); mpv always gets
`--wayland-app-id=gwe-mpv-renderer` plus `--no-config` so user mpv configs can't
interfere with the flags this extension depends on for matching/behavior.

## Extending

- **New setting**: add the key to `schemas/*.gschema.xml`, consume it in the
  relevant `_buildXxxArgv()` (or elsewhere), add a row in the matching `prefs.js`
  group with `settings.bind()`. No extra wiring needed for live-apply — the blanket
  `changed` handler already restarts the engine on any key change.
- **New backend**: extend the `engine` key's `<choices>` and the
  `ENGINE_VALUES`/`ENGINE_LABELS` arrays in `prefs.js`, write a `_buildXxxArgv()`
  (return `null` + call `_notifyError()` when prerequisites are missing —
  `_startEngine()` treats `null` as "don't spawn"), branch on the engine name in
  `_startEngine()`/`_resolveEngine()`, and give the renderer a fixed app-id/title you
  control so `_windowMatchesRenderer()`'s fallback can find it
  (`RENDERER_WM_CLASSES`).
- **Porting to a new GNOME major version**: add it to `shell-version` in
  `metadata.json`, then re-verify against that version's `js/ui/` source (extractable
  from `/usr/lib64/gnome-shell/libshell-<N>.so` via `gresource extract`, or the Meta
  typelib at `/usr/lib64/mutter-<N>/Meta-<N>.typelib` for `Meta.WaylandClient`'s
  actual method surface — it has changed between Mutter releases):
  `Main.layoutManager._backgroundGroup` still exists at the bottom of
  `global.window_group`; `Meta.Window` methods used here (`get_pid`, `lower`,
  `move_resize_frame`, `connect('raised'/'focus')`) are unchanged; and the argument
  types the shell's own `_isOverviewWindow` implementations pass (`MetaWindow` vs.
  `MetaWindowActor`) haven't shifted again. Then run the full manual checklist in
  `docs/development.md#testing-checklist`, paying particular attention to
  lock/unlock, monitor hotplug, and Overview/Alt-Tab/workspace-thumbnail behavior.

## Constraints carried over from prior sessions

- Never add a `Co-Authored-By` trailer to commits in this repo.
- Always confirm the target branch before pushing.
