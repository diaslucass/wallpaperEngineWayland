# Usage

[← Documentation index](index.md)

## Opening the preferences

```bash
gnome-extensions prefs wallpaperengine@waylandwe
```

or open the **Extensions** app, find *Wallpaper Engine for Wayland*, and click
the settings gear. The window is a Libadwaita `Adw.PreferencesWindow` with five
groups: **General**, **Video Wallpaper (mpv)**, **Steam Wallpaper Engine**,
**Playback**, and **Display**.

Every change applies live: the extension watches its GSettings and restarts the
engine automatically about 0.7 s after the last change.

## Video wallpapers (mpv backend)

1. **Video Wallpaper (mpv) → Video File** — click the row (or the folder icon)
   and choose an MP4, WebM, MKV, or GIF. The file dialog filters to those types
   by default; the ✕ button clears the selection.
2. Keep **General → Rendering Engine** on *Automatic*, or force *mpv*.
3. The wallpaper starts within about a second.

Notes:

- mpv runs with `--loop-file=inf`, so any length of clip loops seamlessly.
- Hardware decoding is automatic (`--hwdec=auto-safe`): NVDEC on NVIDIA,
  VA-API on Intel/AMD. No configuration needed.
- `--no-config` is passed, so your personal `~/.config/mpv/mpv.conf` does
  **not** affect the wallpaper. If you need a custom mpv, point
  **mpv Command** at a wrapper script.

### Good source material

- **WebM (VP9/AV1)** and **H.264/H.265 MP4** decode cheaply in hardware.
- Large GIFs are CPU-decoded and inefficient — prefer converting them:

  ```bash
  ffmpeg -i input.gif -c:v libvpx-vp9 -b:v 0 -crf 32 -pix_fmt yuv420p wallpaper.webm
  ```

## Steam Wallpaper Engine scenes

The Wallpaper Engine app itself is Windows-only, but you only need its
**Workshop downloads** and **assets folder**, both of which Steam on Linux can
fetch:

1. In Steam, buy/install **Wallpaper Engine** (right-click → *Properties* →
   under *Compatibility* force a Proton version if Steam refuses to download a
   Windows-only app). Installing it once downloads the `assets` folder.
2. Subscribe to wallpapers in the Steam Workshop. Steam downloads each item to:

   ```
   ~/.local/share/Steam/steamapps/workshop/content/431960/<ITEM_ID>/
   ```

3. In the preferences, **Steam Wallpaper Engine → Workshop Item ID or Scene
   Path**: enter the numeric ID (e.g. `1845706469`) — it's the number in the
   wallpaper's Workshop URL and the folder name above. A full absolute path to
   a scene directory or `.pkg` file also works.
4. **Workshop Content Folder** — only change this if your Steam library lives
   somewhere non-default (e.g. a second drive:
   `/run/media/you/disk/SteamLibrary/steamapps/workshop/content/431960`).
5. **Assets Folder** — leave empty; `linux-wallpaperengine` auto-detects the
   assets from your Steam install. Set it only if detection fails
   (point it at `.../steamapps/common/wallpaper_engine/assets`).
6. Set **Rendering Engine** to *Automatic* or *linux-wallpaperengine*.

### How Automatic engine selection works

*Automatic* picks `linux-wallpaperengine` when **both** are true:

- a Workshop Item ID / scene path is set, and
- the `linux-wallpaperengine` binary is found (on `PATH`, or at the configured
  absolute path).

Otherwise it falls back to `mpv` with your configured video file.

### How a numeric ID is resolved

If the ID is all digits, the extension first looks for
`<Workshop Content Folder>/<ID>` and passes that full path to the engine when
it exists; otherwise it passes the bare ID and lets `linux-wallpaperengine`
locate it in your Steam libraries itself.

## Playback settings

| Setting | Values | Effect |
|---|---|---|
| **Mute Audio** | on / off (default **on**) | `--silent` (wallpaperengine) or `--mute=yes` (mpv). Also greys out the Volume row. |
| **Volume** | 0–100 (default 50) | Only used when not muted. |
| **FPS Cap** | 30 / 60 (default 60) | 30 FPS roughly halves render cost. (Other values 1–240 can be set via `gsettings`.) |
| **Scaling Mode** | Fit / Fill / Stretch (default **Fill**) | Fit letterboxes, Fill crops to cover the monitor, Stretch ignores aspect ratio. |

## Display settings

**Target Monitor** lists *Primary Monitor* plus every connected output with its
model and connector name (e.g. `0: Dell U2723QE (DP-1)`). The wallpaper renders
on exactly one monitor, sized to that monitor's full geometry.

- *Primary Monitor* (the default) follows GNOME's primary-display setting even
  when you rearrange monitors.
- When monitors are hot-plugged or rearranged, the extension restarts the
  engine automatically with the new geometry.

To animate **multiple monitors simultaneously**, see
[Troubleshooting & FAQ](troubleshooting.md#can-i-run-wallpapers-on-multiple-monitors-at-once).

## Controlling everything from the command line

All preferences are plain GSettings keys — scriptable and bindable to keyboard
shortcuts:

```bash
S=org.gnome.shell.extensions.wallpaperengine

gsettings set $S enabled false          # pause/stop the wallpaper
gsettings set $S enabled true           # start it again

gsettings set $S wallpaper-id '1845706469'
gsettings set $S video-path "$HOME/Videos/rain.webm"
gsettings set $S engine mpv             # auto | wallpaperengine | mpv

gsettings set $S fps 30                 # battery saver
gsettings set $S scaling stretch        # fit | fill | stretch
gsettings set $S monitor-index 1        # -1 = primary
gsettings set $S mute false
gsettings set $S volume 80
```

Example: a "battery mode" toggle you can bind to a shortcut:

```bash
#!/usr/bin/env bash
S=org.gnome.shell.extensions.wallpaperengine
if [ "$(gsettings get $S fps)" = "60" ]; then
    gsettings set $S fps 30
else
    gsettings set $S fps 60
fi
```

The full key reference is in [Configuration Reference](configuration.md).

## Behavior you should expect

- **A brief flash at startup.** The renderer window maps as a normal window for
  a frame or two before the extension pushes it behind the desktop and returns
  focus to your previous window. This is inherent to the adoption approach.
- **Lock screen shows GNOME's own background.** On lock the engine is fully
  stopped (zero GPU/CPU); it restarts on unlock.
- **Screen blank pauses, not stops.** When the screensaver activates without a
  lock, the engine process is frozen with `SIGSTOP` and resumed instantly on
  wake — no reload, no re-buffering.
- **Crash recovery.** If the engine dies it is restarted after 2 s, up to
  3 consecutive times; 30 s of stable runtime resets the counter. A desktop
  notification appears if it keeps failing.
