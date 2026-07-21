# Wallpaper Engine for Wayland — Documentation

**Version 1** · GNOME Shell 45–48 · Fedora Linux · Wayland

A GNOME Shell extension that renders animated wallpapers (MP4/WebM/MKV/GIF via
`mpv`) and Steam Wallpaper Engine Workshop scenes (via
[`linux-wallpaperengine`](https://github.com/Almamu/linux-wallpaperengine))
strictly behind your desktop icons and windows — on Wayland, where no
layer-shell protocol is available in Mutter.

## Documentation contents

| Page | What it covers |
|---|---|
| [Installation](installation.md) | Automatic and manual install on Fedora, RPM Fusion, building linux-wallpaperengine, first activation |
| [Usage](usage.md) | Setting up video wallpapers and Workshop scenes, all preference options, CLI control with `gsettings` |
| [Configuration Reference](configuration.md) | Every GSettings key: type, default, range, and exactly how it maps to engine command-line flags |
| [Architecture](architecture.md) | How the extension works internally: process lifecycle, Wayland window embedding, power management, crash recovery |
| [Development](development.md) | Code layout, hacking on the extension, debug workflow, adding a new backend |
| [Troubleshooting & FAQ](troubleshooting.md) | Diagnosing black screens, codec problems, GPU usage, log reading, common questions |

## Quick start

```bash
git clone https://github.com/waylandwe/gnome-wallpaperengine-wayland.git
cd gnome-wallpaperengine-wayland
./scripts/install-fedora.sh
# log out, log back in (Wayland requirement), then:
gnome-extensions enable wallpaperengine@waylandwe
gnome-extensions prefs wallpaperengine@waylandwe
```

Pick a video file in the preferences window — done. For Steam Workshop scenes,
see [Usage → Steam Wallpaper Engine scenes](usage.md#steam-wallpaper-engine-scenes).

## At a glance

- **Two backends.** `linux-wallpaperengine` for Steam Workshop `.pkg`/scene
  wallpapers, `mpv` (with `--hwdec=auto-safe`, i.e. NVDEC/VA-API) for ordinary
  video files. An *Automatic* mode picks the right one from your settings.
- **True background embedding.** The renderer's window actor is reparented into
  GNOME Shell's background group, below desktop icons and all windows.
- **Power aware.** `SIGSTOP`/`SIGCONT` on screensaver, full engine shutdown on
  the lock screen, automatic restart on unlock.
- **Self-healing.** Crash detection with bounded automatic restarts and a
  desktop notification when the engine can't stay up.
- **Live settings.** Every preference change restarts the engine automatically
  (debounced); no manual reloads.

## Requirements

| Requirement | Notes |
|---|---|
| Fedora Linux | Tested target; other distros work with equivalent packages |
| GNOME Shell 45, 46, 47 or 48 | ESM extension architecture |
| Wayland session | This is the whole point; an X11 session also works but is not the target |
| RPM Fusion | For full `ffmpeg`/`mpv` codec support (H.264/HEVC) |
| `mpv` ≥ 0.35 | Needs `--wayland-app-id` support |
| `linux-wallpaperengine` | Optional; only for Steam Workshop scenes |
| Steam + Wallpaper Engine purchase | Optional; only to download Workshop scenes and the `assets` folder |
