# Configuration Reference

[← Documentation index](index.md)

Schema id: **`org.gnome.shell.extensions.wallpaperengine`**
Path: `/org/gnome/shell/extensions/wallpaperengine/`
Source: [`schemas/org.gnome.shell.extensions.wallpaperengine.gschema.xml`](../schemas/org.gnome.shell.extensions.wallpaperengine.gschema.xml)

Read/write any key with `gsettings get|set org.gnome.shell.extensions.wallpaperengine <key> [value]`,
or browse them in `dconf-editor`. Every write triggers a debounced (~0.7 s)
engine restart.

## Keys

### `enabled`
| | |
|---|---|
| Type | `b` (boolean) |
| Default | `true` |

Master switch. `false` terminates the engine process and shows the normal
static GNOME wallpaper. No process is spawned while disabled.

### `engine`
| | |
|---|---|
| Type | `s`, one of `auto`, `wallpaperengine`, `mpv` |
| Default | `'auto'` |

Backend selection. `auto` chooses `wallpaperengine` when `wallpaper-id` is
non-empty **and** the `wallpaperengine-path` binary is found (absolute path
must be executable; bare command is looked up on `PATH`); otherwise `mpv`.

### `video-path`
| | |
|---|---|
| Type | `s` |
| Default | `''` |

Absolute path to the video for the mpv backend (MP4, WebM, MKV, GIF — anything
mpv can decode). `~` is expanded. If empty or missing when the mpv backend
starts, the engine is not spawned and a desktop notification explains why.

### `wallpaper-id`
| | |
|---|---|
| Type | `s` |
| Default | `''` |

Steam Workshop item ID (all digits) or absolute path to a scene directory /
`.pkg` file. Digit-only values are resolved against `workshop-path` first
(`<workshop-path>/<id>` if that directory exists), else passed through for the
engine to locate.

### `workshop-path`
| | |
|---|---|
| Type | `s` |
| Default | `'~/.local/share/Steam/steamapps/workshop/content/431960'` |

Directory containing downloaded Workshop items (one numeric folder per item).
`431960` is Wallpaper Engine's Steam app ID. Change only for non-default Steam
library locations.

### `assets-path`
| | |
|---|---|
| Type | `s` |
| Default | `''` |

Optional path to Wallpaper Engine's `assets` folder. Empty = let
`linux-wallpaperengine` auto-detect from the Steam library. When set, passed
as `--assets-dir <path>`.

### `wallpaperengine-path`
| | |
|---|---|
| Type | `s` |
| Default | `'linux-wallpaperengine'` |

Command name (resolved on `PATH`) or absolute path of the
`linux-wallpaperengine` executable.

### `mpv-path`
| | |
|---|---|
| Type | `s` |
| Default | `'mpv'` |

Command name or absolute path of the mpv executable. Point this at a wrapper
script if you need custom mpv behavior (the extension passes `--no-config`).

### `mute`
| | |
|---|---|
| Type | `b` |
| Default | `true` |

Silences wallpaper audio. Maps to `--silent` (wallpaperengine) or `--mute=yes`
(mpv). When `true`, `volume` is ignored.

### `volume`
| | |
|---|---|
| Type | `i`, range 0–100 |
| Default | `50` |

Audio volume in percent, applied only when `mute` is `false`. Maps to
`--volume <n>` (wallpaperengine) or `--volume=<n>` (mpv).

### `fps`
| | |
|---|---|
| Type | `i`, range 1–240 |
| Default | `60` |

Frame-rate cap. The preferences UI offers 30/60; any value in range can be set
via `gsettings`. Maps to `--fps <n>` (wallpaperengine) or a
`--vf=fps=<n>` video filter (mpv).

### `monitor-index`
| | |
|---|---|
| Type | `i`, range −1–15 |
| Default | `-1` |

Index of the target monitor in GNOME's monitor list. `-1` (or any
out-of-range value) means the **primary** monitor. Monitor indices match
`Main.layoutManager.monitors` ordering, which is what the preferences dialog
enumerates.

### `scaling`
| | |
|---|---|
| Type | `s`, one of `fit`, `fill`, `stretch` |
| Default | `'fill'` |

How the wallpaper is fitted to the monitor.

## Setting → engine flag mapping

How each key becomes command-line arguments (built in `extension.js`,
`_buildWallpaperEngineArgv()` / `_buildMpvArgv()`):

| Key | linux-wallpaperengine | mpv |
|---|---|---|
| `fps` | `--fps N` | `--vf=fps=N` |
| `scaling=fit` | `--scaling fit` | *(default keep-aspect)* |
| `scaling=fill` | `--scaling fill` | `--panscan=1.0` |
| `scaling=stretch` | `--scaling stretch` | `--keepaspect=no` |
| `mute=true` | `--silent` | `--mute=yes` |
| `mute=false` + `volume` | `--volume N` | `--volume=N --mute=no` |
| `monitor-index` | window sized to monitor via `--window 0x0xWxH`, positioned by the extension | window positioned/sized by the extension via Mutter |
| `assets-path` | `--assets-dir PATH` | — |
| `wallpaper-id` | positional scene argument | — |
| `video-path` | — | positional file argument |

Fixed mpv flags (not configurable): `--no-config --really-quiet
--force-window=yes --no-border --no-osc --no-osd-bar
--no-input-default-bindings --input-vo-keyboard=no --no-input-cursor
--cursor-autohide=no --no-stop-screensaver --no-audio-display
--hwdec=auto-safe --loop-file=inf --title=gwe-mpv-renderer
--wayland-app-id=gwe-mpv-renderer --x11-name=gwe-mpv-renderer`.

## Dumping and restoring configuration

```bash
# backup
dconf dump /org/gnome/shell/extensions/wallpaperengine/ > wallpaper-settings.ini

# restore
dconf load /org/gnome/shell/extensions/wallpaperengine/ < wallpaper-settings.ini

# factory reset
dconf reset -f /org/gnome/shell/extensions/wallpaperengine/
```
