# Development Guide

[← Documentation index](index.md)

## Code layout

```
├── extension.js    # Shell-side logic (runs inside gnome-shell, GJS/ESM)
├── prefs.js        # Preferences dialog (separate GTK4 process, GJS/ESM)
├── metadata.json   # Manifest: uuid, shell-version, session-modes, schema id
├── schemas/        # GSettings schema (compile with glib-compile-schemas)
├── scripts/
│   └── install-fedora.sh
└── docs/           # This documentation
```

Both JS files are **ES modules** (GNOME 45+ style): `import Gio from
'gi://Gio'`, `Extension`/`ExtensionPreferences` base classes, no legacy
`imports.*`, no `init()` function.

### `extension.js` map

| Section | Members | Purpose |
|---|---|---|
| Lifecycle | `enable()`, `disable()`, `_clearTimeouts()` | Signal/timer/process setup and guaranteed teardown |
| Geometry | `_targetMonitorIndex()`, `_targetGeometry()` | Resolve `monitor-index` (−1 → primary) to pixel geometry |
| Command line | `_resolveEngine()`, `_resolveScenePath()`, `_buildWallpaperEngineArgv()`, `_buildMpvArgv()` | GSettings → argv |
| Process | `_startEngine()`, `_onEngineExited()`, `_stopEngine()`, `_scheduleRestart()`, `_setPaused()` | Spawn, crash recovery, debounced restart, SIGSTOP/SIGCONT |
| Embedding | `_onWindowCreated()`, `_windowMatchesRenderer()`, `_tryAdoptWindow()`, `_forgetWindow()`, `_releaseWindow()` | Find the renderer window and reparent it into the background |
| Misc | `_notifyError()`, `expandTilde()` | User-visible errors, `~` expansion |

Every asynchronous callback checks `this._destroyed` and/or compares against
the current `this._proc` so callbacks firing after `disable()` (or after a
restart replaced the process) are harmless no-ops. **Keep this invariant when
modifying the code** — it is what makes lock/unlock cycles (which run
`disable()`/`enable()` each time) safe.

### `prefs.js` map

One `Adw.PreferencesPage`, five groups (`_buildGeneralGroup`,
`_buildVideoGroup`, `_buildWallpaperEngineGroup`, `_buildPlaybackGroup`,
`_buildDisplayGroup`). Patterns used:

- Direct `settings.bind()` for switches, entry rows, and the volume spin row
  (including an inverted-boolean bind that greys out Volume while muted).
- `_bindComboToStringSetting()` for string-choice combos (engine, scaling).
- `Gtk.FileDialog` (GTK 4.10+ async API) for file/folder pickers; results are
  written straight to GSettings, subtitles update via `changed::<key>`.
- Monitor list from `Gdk.Display.get_default().get_monitors()` with
  `get_description()`/`get_connector()` labels.

The prefs process never talks to the extension directly — GSettings is the
only channel, and the extension's `changed` handler picks everything up.

## Development workflow

### Editing and reloading

On **Wayland**, a changed extension is only reloaded on session restart:

```bash
# install your working copy (fast, no deps)
./scripts/install-fedora.sh --no-deps --no-engine

# then log out / log in
```

Faster iteration: run a **nested GNOME Shell** so you don't have to log out:

```bash
dbus-run-session -- gnome-shell --nested --wayland
```

The nested shell picks up the installed extension; enable it inside the nested
session. Note the nested session has its own dconf, so set your test settings
inside it.

Prefs iterate much faster — they run in a separate process, so after copying
`prefs.js` just relaunch:

```bash
gnome-extensions prefs wallpaperengine@waylandwe
```

### Logs

```bash
# extension (runs inside gnome-shell)
journalctl -f -o cat /usr/bin/gnome-shell | grep -i wallpaperengine

# preferences dialog
journalctl -f -o cat /usr/bin/gjs
```

All extension errors are logged with the `[wallpaperengine@waylandwe]` prefix
(see `_notifyError()`); adoption/spawn problems show up here first.

To see the renderer's own output (silenced by the extension), run the exact
argv by hand — copy it from `_buildMpvArgv()`/`_buildWallpaperEngineArgv()`:

```bash
mpv --no-config --force-window=yes --wayland-app-id=gwe-mpv-renderer ~/Videos/test.webm
linux-wallpaperengine --window 0x0x1920x1080 --fps 60 --scaling fill 1845706469
```

### Schema changes

After editing the `.gschema.xml`:

```bash
glib-compile-schemas ~/.local/share/gnome-shell/extensions/wallpaperengine@waylandwe/schemas/
```

An uncompiled or stale schema makes `getSettings()` throw and the extension
fail to enable.

### Validation / linting

```bash
# syntax
node --check extension.js prefs.js

# GJS-aware linting (optional)
npm install -D eslint
npx eslint extension.js prefs.js
```

There is no build step — the files are shipped as-is.

## Common modifications

### Adding a new setting

1. Add the key to the `.gschema.xml` (type, default, range/choices, summary).
2. Consume it in `extension.js` where the argv is built (or wherever relevant).
   No extra wiring needed for live-apply — the blanket `changed` handler
   already restarts the engine on any key change.
3. Add a row in the right `prefs.js` group, using `settings.bind()` where the
   widget property maps 1:1.
4. Recompile the schema, reinstall, restart the session.

### Adding a new backend

1. Extend the `engine` key's `<choices>` in the schema and the
   `ENGINE_VALUES`/`ENGINE_LABELS` arrays in `prefs.js`.
2. Write a `_buildXxxArgv()` returning a full argv (return `null` + call
   `_notifyError()` when prerequisites are missing — `_startEngine()` treats
   `null` as "don't spawn").
3. Branch on the new engine name in `_startEngine()` and, if applicable, in
   `_resolveEngine()`'s auto logic.
4. Make the renderer's window identifiable: best is a fixed app-id/title you
   control (add it to `RENDERER_WM_CLASSES`); PID matching already covers
   engines that don't fork.

### Porting to a new GNOME version

1. Add the version to `shell-version` in `metadata.json`.
2. Re-verify the two private touchpoints:
   - `Main.layoutManager._backgroundGroup` still exists and still sits at the
     bottom of `global.window_group`
     (check `js/ui/layout.js` in the gnome-shell source);
   - `Meta.Window.get_pid()`, `stick()`, `lower()`, `move_resize_frame()`
     signatures unchanged (check the Meta API docs / gjs.guide porting notes).
3. Test lock/unlock (runs `disable()`/`enable()`), monitor hotplug, and
   overview/workspace-switch rendering.

## Testing checklist

Manual test matrix before a release:

- [ ] mpv backend: MP4, WebM, GIF each play and loop
- [ ] wallpaperengine backend: numeric ID and absolute scene path
- [ ] Automatic engine selection: with/without scene id, with/without binary
- [ ] Wallpaper is behind desktop icons and app windows; overview/workspace
      thumbnails show it as background
- [ ] Focus returns to the previous window after engine start
- [ ] Mute/volume, FPS 30/60, all three scaling modes apply live
- [ ] Monitor selection on a multi-monitor setup; unplugging the target
      monitor falls back to primary
- [ ] Lock → engine process gone (`pgrep mpv`); unlock → running again
- [ ] Screen blank → process state `T` (stopped) in `ps`; wake → running
- [ ] Kill the engine manually 1–3× → auto-restart; 4× fast → notification,
      no restart loop
- [ ] `enabled=false` → process gone; `enabled=true` → back
- [ ] Disable extension in Extensions app → clean desktop, no leftover
      process, no journal errors
