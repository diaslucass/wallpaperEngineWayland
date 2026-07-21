# Installation

[← Documentation index](index.md)

## Supported platform

- **Fedora Linux** (any currently supported release; the installer detects the
  version via `rpm -E %fedora`).
- **GNOME Shell 45–48** running a **Wayland** session.
- Works on Intel, AMD, and NVIDIA GPUs. Hardware video decode uses VA-API
  (Intel/AMD) or NVDEC (NVIDIA) automatically through mpv's `--hwdec=auto-safe`.

## Automatic installation (recommended)

```bash
git clone https://github.com/waylandwe/gnome-wallpaperengine-wayland.git
cd gnome-wallpaperengine-wayland
chmod +x scripts/install-fedora.sh
./scripts/install-fedora.sh
```

Run it as your **normal user** — it refuses to run as root and uses `sudo`
only for `dnf`.

### What the installer does, step by step

1. **Sanity checks** — Fedora release file, `dnf`, `gnome-shell` present,
   not running as root, extension sources present.
2. **RPM Fusion** — installs the *free* and *nonfree* release packages so full
   codec builds of ffmpeg/mpv are available.
3. **Codec swap** — `dnf swap ffmpeg-free ffmpeg --allowerasing` replaces
   Fedora's patent-stripped ffmpeg with the full build (H.264/HEVC decode).
4. **Runtime packages** — `mpv`, `ffmpeg`, `gstreamer1-plugins-good`,
   `gstreamer1-plugins-bad-free`, `gstreamer1-plugins-bad-freeworld`,
   `gstreamer1-plugins-ugly`, `gstreamer1-libav`, `libva`, `libva-utils`,
   `gnome-extensions-app`.
5. **Build toolchain** — `git cmake gcc-c++ make` plus development headers:
   `zlib-devel lz4-devel ffmpeg-devel libX11-devel libXrandr-devel
   libXxf86vm-devel libXinerama-devel libXcursor-devel libXi-devel
   mesa-libGL-devel mesa-libEGL-devel glew-devel glfw-devel glm-devel
   SDL2-devel freeglut-devel pulseaudio-libs-devel mpv-devel wayland-devel
   wayland-protocols-devel`.
6. **Builds `linux-wallpaperengine`** — clones
   `https://github.com/Almamu/linux-wallpaperengine.git` (with submodules) into
   `~/.cache/linux-wallpaperengine-build`, builds Release with CMake, and
   installs the result under `~/.local` (binary reachable as
   `~/.local/bin/linux-wallpaperengine`). If the binary is already on your
   `PATH` and no build cache exists, the build is skipped.
7. **Installs the extension** — copies `metadata.json`, `extension.js`,
   `prefs.js` and the schema into
   `~/.local/share/gnome-shell/extensions/wallpaperengine@waylandwe/`, then runs
   `glib-compile-schemas` on the `schemas/` directory.
8. **Enables the extension** — via `gnome-extensions enable`; if GNOME Shell
   hasn't loaded the new extension yet (always the case on a fresh install
   under Wayland) it prints the log-out/log-in instructions instead.

### Installer flags

| Flag | Effect |
|---|---|
| `--no-engine` | Skip cloning/building `linux-wallpaperengine`. Use this for an mpv-only setup. |
| `--no-deps` | Skip every `dnf` command. Use when packages are already installed or on a non-Fedora system where you handle dependencies yourself. |
| `-h`, `--help` | Print the header comment of the script. |

## Manual installation

If you prefer to see every command, the full manual sequence is in the
[README](../README.md#manual). Summary:

1. Enable RPM Fusion, swap in full `ffmpeg`, install `mpv` and the GStreamer
   plugin set.
2. (Optional) Build `linux-wallpaperengine` with CMake and symlink the binary
   into `~/.local/bin`.
3. Copy the extension files into
   `~/.local/share/gnome-shell/extensions/wallpaperengine@waylandwe/` and run
   `glib-compile-schemas` on its `schemas/` subdirectory. **The extension will
   not load without the compiled schema** (`gschemas.compiled`).

## First activation (important on Wayland)

Wayland GNOME Shell only scans for new extensions at session start. After
installing:

1. **Log out and log back in.**
2. `gnome-extensions enable wallpaperengine@waylandwe`
3. `gnome-extensions prefs wallpaperengine@waylandwe`

Verify it's running:

```bash
gnome-extensions info wallpaperengine@waylandwe
# State: ENABLED
```

## Updating

Re-run `./scripts/install-fedora.sh` from an updated checkout. The engine build
step does a `git pull --ff-only` in the build cache and rebuilds. Extension
file changes require another log-out/log-in to take effect.

## Uninstalling

```bash
gnome-extensions disable wallpaperengine@waylandwe
rm -rf ~/.local/share/gnome-shell/extensions/wallpaperengine@waylandwe

# optional: remove the engine build and binary
rm -rf ~/.cache/linux-wallpaperengine-build
rm -f  ~/.local/bin/linux-wallpaperengine
rm -rf ~/.local/share/linux-wallpaperengine

# optional: remove stored settings
dconf reset -f /org/gnome/shell/extensions/wallpaperengine/
```
