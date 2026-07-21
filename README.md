# Wallpaper Engine for Wayland

A GNOME Shell extension that runs **animated wallpapers** and **Steam Wallpaper Engine
scenes** on **Fedora Linux under Wayland**.

| | |
|---|---|
| **UUID** | `wallpaperengine@waylandwe` |
| **GNOME Shell** | 45, 46, 47, 48 (modern ESM architecture) |
| **Display server** | Wayland (Mutter) |
| **Backends** | [`linux-wallpaperengine`](https://github.com/Almamu/linux-wallpaperengine) (Steam Workshop scenes) and `mpv` (MP4 / WebM / MKV / GIF, hardware accelerated via VA-API / NVDEC) |
| **Preferences UI** | GTK4 + Libadwaita (`Adw.PreferencesWindow`) |

**📚 Full documentation:** [docs/index.md](docs/index.md) — [Installation](docs/installation.md) · [Usage](docs/usage.md) · [Configuration Reference](docs/configuration.md) · [Architecture](docs/architecture.md) · [Development](docs/development.md) · [Troubleshooting & FAQ](docs/troubleshooting.md)

## How it works

GNOME's Mutter compositor does **not** implement the `wlr-layer-shell` protocol that
wallpaper tools use on wlroots compositors (Sway, Hyprland, …). This extension solves
that from *inside* the compositor:

1. It spawns the renderer (`linux-wallpaperengine` in windowed mode, or `mpv` with a
   private Wayland app-id) as a detached background subprocess — never blocking the
   GNOME Shell main thread.
2. When the renderer's window appears, the extension matches it by **PID** (with an
   app-id/title fallback), sizes it to the target monitor, sticks it to all
   workspaces, and **reparents its compositor actor into GNOME Shell's background
   group** — so the video sits strictly *behind* desktop icons and every application
   window, exactly like a real wallpaper.
3. Rendering is suspended automatically to save GPU/CPU:
   - **Screensaver / screen blank** → the engine process receives `SIGSTOP`
     (0% CPU/GPU) and `SIGCONT` on wake.
   - **Lock screen** → the extension declares only the `user` session mode, so GNOME
     disables it entirely on lock and the engine process is terminated; it is
     restarted automatically on unlock.
4. If the engine crashes it is restarted automatically (up to 3 times, with the
   counter reset after 30 s of stable runtime), and you get a desktop notification if
   it keeps failing.

## Repository layout

```
├── metadata.json
├── extension.js                # Shell-side logic: process + window management
├── prefs.js                    # Libadwaita preferences window
├── schemas/
│   └── org.gnome.shell.extensions.wallpaperengine.gschema.xml
├── scripts/
│   └── install-fedora.sh       # One-shot Fedora installer
└── README.md
```

## Installation (Fedora)

### Automatic (recommended)

```bash
git clone https://github.com/waylandwe/gnome-wallpaperengine-wayland.git
cd gnome-wallpaperengine-wayland
chmod +x scripts/install-fedora.sh
./scripts/install-fedora.sh
```

The script:

- enables **RPM Fusion** (free + nonfree) and swaps `ffmpeg-free` for full `ffmpeg`,
- installs `mpv`, `ffmpeg`, `gstreamer1-plugins-bad-freeworld`,
  `gstreamer1-plugins-ugly`, `gstreamer1-libav`, VA-API libraries,
- installs the build toolchain and **compiles `linux-wallpaperengine`** into
  `~/.local/bin`,
- installs the extension to
  `~/.local/share/gnome-shell/extensions/wallpaperengine@waylandwe`,
- compiles the GSettings schema and enables the extension.

Flags: `--no-engine` skips the linux-wallpaperengine build (mpv-only setup),
`--no-deps` skips all `dnf` installs.

> **Wayland note:** newly installed extensions are only picked up after you
> **log out and log back in**. Then run
> `gnome-extensions enable wallpaperengine@waylandwe`.

### Manual

```bash
# 1. Runtime dependencies (RPM Fusion required for full codecs)
sudo dnf install \
  "https://mirrors.rpmfusion.org/free/fedora/rpmfusion-free-release-$(rpm -E %fedora).noarch.rpm" \
  "https://mirrors.rpmfusion.org/nonfree/fedora/rpmfusion-nonfree-release-$(rpm -E %fedora).noarch.rpm"
sudo dnf swap ffmpeg-free ffmpeg --allowerasing
sudo dnf install mpv ffmpeg gstreamer1-plugins-bad-freeworld gstreamer1-plugins-ugly gstreamer1-libav libva libva-utils

# 2. Build linux-wallpaperengine (optional, for Steam Workshop scenes)
sudo dnf install git cmake gcc-c++ make zlib-devel lz4-devel ffmpeg-devel \
  libX11-devel libXrandr-devel libXxf86vm-devel libXinerama-devel libXcursor-devel libXi-devel \
  mesa-libGL-devel mesa-libEGL-devel glew-devel glfw-devel glm-devel SDL2-devel freeglut-devel \
  pulseaudio-libs-devel mpv-devel wayland-devel wayland-protocols-devel
git clone --recurse-submodules https://github.com/Almamu/linux-wallpaperengine.git
cd linux-wallpaperengine
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --parallel "$(nproc)"
mkdir -p ~/.local/bin && ln -sf "$PWD/build/output/linux-wallpaperengine" ~/.local/bin/

# 3. Install the extension
EXT=~/.local/share/gnome-shell/extensions/wallpaperengine@waylandwe
mkdir -p "$EXT/schemas"
cp metadata.json extension.js prefs.js "$EXT/"
cp schemas/org.gnome.shell.extensions.wallpaperengine.gschema.xml "$EXT/schemas/"
glib-compile-schemas "$EXT/schemas/"

# 4. Log out, log back in, then:
gnome-extensions enable wallpaperengine@waylandwe
```

## Usage

Open the preferences:

```bash
gnome-extensions prefs wallpaperengine@waylandwe
```

(or via the **Extensions** app → *Wallpaper Engine for Wayland* → ⚙️)

### Playing a local video (mpv backend)

1. In **Video Wallpaper (mpv)** → **Video File**, pick an MP4, WebM, MKV or GIF.
2. Leave **Rendering Engine** on *Automatic* (or force *mpv*).
3. The wallpaper starts within a second; mpv uses `--hwdec=auto-safe`, which
   picks NVDEC on NVIDIA and VA-API on Intel/AMD automatically.

### Playing a Steam Workshop scene (linux-wallpaperengine backend)

1. Install **Wallpaper Engine** on Steam (it's fine that the app itself is
   Windows-only — you only need the Workshop downloads and its `assets` folder).
   Subscribe to wallpapers in the Workshop and let Steam download them.
2. Find the item ID: Workshop items live in
   `~/.local/share/Steam/steamapps/workshop/content/431960/<ITEM_ID>/`.
   The ID is also the number in the wallpaper's Workshop URL.
3. In **Steam Wallpaper Engine** → **Workshop Item ID or Scene Path**, enter the
   numeric ID (e.g. `1845706469`) or paste a full path to a scene folder/`.pkg`.
4. If your Steam library is in a non-default location, set **Workshop Content
   Folder** accordingly. **Assets Folder** can usually stay empty
   (auto-detected from Steam).

### Playback & display settings

| Setting | Effect |
|---|---|
| **Mute Audio / Volume** | Silences the wallpaper or sets its volume (0–100 %). |
| **FPS Cap** | 30 or 60 FPS. 30 roughly halves GPU usage. |
| **Scaling Mode** | *Fit* (letterbox), *Fill* (crop, default), *Stretch*. |
| **Target Monitor** | Primary monitor, or a specific output on multi-monitor setups. |
| **Animated Wallpaper** | Master switch — turns the engine process off entirely. |

All changes apply live (the engine restarts automatically, debounced).

### Command-line control

```bash
# Toggle without opening the UI
gsettings set org.gnome.shell.extensions.wallpaperengine enabled false
gsettings set org.gnome.shell.extensions.wallpaperengine enabled true

# Switch wallpapers
gsettings set org.gnome.shell.extensions.wallpaperengine wallpaper-id '1845706469'
gsettings set org.gnome.shell.extensions.wallpaperengine video-path "$HOME/Videos/rain.webm"

# Power saving
gsettings set org.gnome.shell.extensions.wallpaperengine fps 30
```

## Troubleshooting

**The wallpaper window appears *on top* of other windows for a split second.**
Normal — the extension adopts the window as soon as Mutter maps it, then pushes it
into the background group and returns focus to your previous window.

**Nothing appears (mpv backend).**
Test mpv manually: `mpv --hwdec=auto-safe ~/Videos/test.mp4`. If codecs are missing,
verify RPM Fusion is enabled and full `ffmpeg` is installed
(`sudo dnf swap ffmpeg-free ffmpeg --allowerasing`).

**Nothing appears (Wallpaper Engine backend).**
Run it manually to see the error:
`linux-wallpaperengine --window 0x0x1920x1080 <ITEM_ID>`.
Common causes: the Workshop item is a *video* type that needs the full `assets`
folder from a Wallpaper Engine Steam install, or the scene uses features the native
engine doesn't support yet.

**High GPU usage.**
Set the FPS cap to 30, and prefer WebM/VP9 or H.264 videos over complex 3D scenes.
Confirm hardware decode with `vainfo` (Intel/AMD) or `nvidia-smi` while playing.

**Check extension logs.**

```bash
journalctl -f -o cat /usr/bin/gnome-shell | grep -i wallpaperengine
```

**Uninstall.**

```bash
gnome-extensions disable wallpaperengine@waylandwe
rm -rf ~/.local/share/gnome-shell/extensions/wallpaperengine@waylandwe
```

## Known limitations

- On the lock screen the wallpaper is intentionally stopped (session-mode `user`);
  GNOME's own lock-screen background is shown instead.
- `linux-wallpaperengine` runs in windowed mode here (GNOME lacks layer-shell), so
  per-monitor scene rendering uses one window sized by the extension; audio-reactive
  and mouse-interactive scene features behave as in the upstream project.
- Workshop scenes vary wildly in complexity; not every scene type is supported by
  the upstream native engine.

## License

GPL-2.0-or-later — the standard license for GNOME Shell extensions.
