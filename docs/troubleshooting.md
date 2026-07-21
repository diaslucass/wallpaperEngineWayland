# Troubleshooting & FAQ

[← Documentation index](index.md)

## First diagnostic steps

```bash
# 1. Is the extension enabled and error-free?
gnome-extensions info wallpaperengine@waylandwe

# 2. What is the extension logging?
journalctl -f -o cat /usr/bin/gnome-shell | grep -i wallpaperengine

# 3. Is the engine process alive?
pgrep -a mpv
pgrep -a linux-wallpaperengine

# 4. What do the settings actually say?
gsettings list-recursively org.gnome.shell.extensions.wallpaperengine
```

Most problems fall out of one of those four commands. Extension-side errors
are also raised as desktop notifications ("Wallpaper Engine for Wayland: …").

## Problems and fixes

### The extension won't enable / doesn't appear

- **Fresh install on Wayland** → you must log out and log back in before GNOME
  Shell sees the new extension.
- **`gnome-extensions info` shows ERROR** → almost always a missing compiled
  schema. Fix:

  ```bash
  glib-compile-schemas ~/.local/share/gnome-shell/extensions/wallpaperengine@waylandwe/schemas/
  ```

  then log out/in again.
- **Shell version mismatch** → check `gnome-shell --version` against
  `shell-version` in `metadata.json` (45–48 supported).

### Black/no wallpaper, mpv backend

1. Check the notification/log — "No video file configured" and "Video file not
   found" are reported explicitly.
2. Test the file in mpv directly:

   ```bash
   mpv --hwdec=auto-safe ~/Videos/test.mp4
   ```

3. If mpv can't decode it, codecs are missing — Fedora's default
   `ffmpeg-free` lacks H.264/HEVC:

   ```bash
   sudo dnf swap ffmpeg-free ffmpeg --allowerasing   # requires RPM Fusion
   ```

4. If mpv plays it standalone but the wallpaper stays black, check the journal
   for adoption messages and confirm the mpv process exists (`pgrep -a mpv` —
   you should see the `--wayland-app-id=gwe-mpv-renderer` flag in its argv).

### Black/no wallpaper, Wallpaper Engine backend

Run the engine manually to see its real error output (the extension silences
it):

```bash
linux-wallpaperengine --window 0x0x1920x1080 <ITEM_ID>
```

Common causes:

- **Assets not found** — the scene needs Wallpaper Engine's `assets` folder.
  Install Wallpaper Engine once via Steam, or set **Assets Folder** to
  `.../steamapps/common/wallpaper_engine/assets` explicitly.
- **Wrong workshop path** — Steam library on another drive; point **Workshop
  Content Folder** at
  `<library>/steamapps/workshop/content/431960`.
- **Unsupported scene type** — the native engine doesn't support every
  Workshop wallpaper type (some web/video/application wallpapers). Try a
  different scene to isolate; check the
  [upstream issue tracker](https://github.com/Almamu/linux-wallpaperengine/issues).
- **Binary not found** — "Failed to launch" notification; ensure
  `~/.local/bin` is on `PATH` or set an absolute path in
  **linux-wallpaperengine Command**.

### "The wallpaper engine process keeps crashing and has been stopped"

The engine died 3+ times in a row (see
[Architecture → crash recovery](architecture.md#process-lifecycle-and-crash-recovery)).
Run the engine manually (commands above) to see why, fix the cause, then
toggle **Animated Wallpaper** off/on (or change any setting) to reset the
retry counter and relaunch.

### Wallpaper appears *above* windows, or flashes at startup

A brief flash of the renderer window on top at engine start is **expected** —
the extension can only restack the window after Mutter maps it. If the
wallpaper *stays* on top or steals focus permanently, the adoption failed;
check the journal, and verify the renderer process wasn't wrapped by something
that changes its PID and app-id (e.g. a flatpak'd mpv — use the native
package, or a wrapper that keeps the `gwe-mpv-renderer` app-id).

### Wrong monitor / wrong size

- Monitor indices come from GNOME's monitor list; re-pick **Target Monitor**
  in the preferences after changing your arrangement (the dialog labels each
  entry with model + connector).
- If the chosen index no longer exists (monitor unplugged), the extension
  automatically falls back to the primary monitor.
- After hotplug/resolution changes the engine restarts itself; if geometry
  looks stale, toggle any setting to force a restart.

### High GPU/CPU usage

- Set **FPS Cap** to 30 — roughly halves render cost.
- Prefer H.264/VP9/AV1 video over complex 3D Workshop scenes.
- Verify hardware decode is actually in use:

  ```bash
  vainfo                    # Intel/AMD: VA-API profiles present?
  nvidia-smi                # NVIDIA: mpv listed while playing?
  ```

- GIFs are CPU-decoded; convert to WebM
  (see [Usage → Good source material](usage.md#good-source-material)).
- Remember the engine is fully stopped on the lock screen and frozen on screen
  blank — idle overnight cost is zero.

### Audio keeps playing when it shouldn't

**Mute Audio** is on by default; if you enabled sound, note that volume is per
the engine's own output stream — you can also silence it per-app in GNOME
Settings → Sound. On screen blank the process is SIGSTOPped, which also stops
audio.

### Settings changes do nothing

- Confirm the extension is enabled (`gnome-extensions info`).
- Changes are debounced ~0.7 s — wait a moment.
- If you edited settings in a nested-shell dev session, remember it uses its
  own dconf database.

## FAQ

### Can I run wallpapers on multiple monitors at once?

Not with a single instance — the extension intentionally manages **one**
renderer window on one monitor to keep resource use predictable. Options:

- Set **Target Monitor** to your main display and keep static wallpapers on
  the others.
- For a spanning effect, use a video matching your combined resolution with
  **Scaling Mode: Stretch** on the widest monitor.

True multi-instance support is a straightforward extension of the current
architecture (one process + one adopted window per monitor) — see
[Development](development.md) if you want to contribute it.

### Does this work on X11?

The extension runs (Mutter provides the same APIs), and matching/embedding
works via `--x11-name`. But X11 users are better served by simpler tools
(`xwinwrap`, native `linux-wallpaperengine --screen-root`); Wayland is the
target here.

### Why does the lock screen show a static background?

By design. The extension declares only the `user` session mode, so GNOME
disables it on lock — the engine is terminated (zero GPU/battery cost) and
GNOME's own lock-screen styling stays intact. It restarts automatically on
unlock.

### Do I need to buy Wallpaper Engine?

Only for Steam Workshop scenes (the Workshop downloads and the `assets`
folder come with the purchase). The mpv backend needs nothing but a video
file.

### Is my Steam account / the Workshop content touched in any way?

No. The extension only reads files Steam already downloaded to
`~/.local/share/Steam/steamapps/workshop/content/431960` and spawns a local
renderer. Nothing talks to the network.

### Where do crash logs of the renderer go?

Nowhere — the extension silences the renderer's output so it can never stall
GNOME Shell. To see engine output, run the same command manually
([Development → Logs](development.md#logs) shows how to reproduce the exact
argv).

### How do I completely remove everything?

See [Installation → Uninstalling](installation.md#uninstalling).
