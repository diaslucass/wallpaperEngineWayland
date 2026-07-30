// Wallpaper Engine for Wayland - GNOME Shell extension
// Spawns linux-wallpaperengine or mpv as a background renderer process and
// embeds its window into GNOME Shell's background group so it sits strictly
// behind desktop icons and application windows.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import {Extension, InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Workspace} from 'resource:///org/gnome/shell/ui/workspace.js';
import {WorkspaceThumbnail} from 'resource:///org/gnome/shell/ui/workspaceThumbnail.js';

const MPV_APP_ID = 'gwe-mpv-renderer';
const RENDERER_WM_CLASSES = [
    MPV_APP_ID,
    'linux-wallpaperengine',
    'wallpaperengine',
    'linux-wallpaperengine-window',
];

// Bumped on every code change; logged from enable() so we can tell which
// revision the running shell actually loaded (see the comment there).
const CODE_REVISION = 7;

const SIGTERM = 15;
const SIGCONT = 18;
const SIGSTOP = 19;

const RESTART_DEBOUNCE_MS = 700;
const CRASH_RETRY_DELAY_MS = 2000;
const MAX_CRASH_RETRIES = 3;
const STABLE_RUNTIME_US = 30 * 1000 * 1000; // 30s uptime resets the retry counter
const WINDOW_MATCH_RETRIES = 20;
const WINDOW_MATCH_INTERVAL_MS = 100;

function expandTilde(path) {
    if (path.startsWith('~/'))
        return GLib.build_filenamev([GLib.get_home_dir(), path.slice(2)]);
    if (path === '~')
        return GLib.get_home_dir();
    return path;
}

export default class WallpaperEngineExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._destroyed = false;

        this._proc = null;
        this._waylandClient = null;
        this._procStopping = false;
        this._procStartTime = 0;
        this._paused = false;
        this._crashRetries = 0;

        // Deliberately at warning level so it always reaches the journal:
        // on Wayland the shell never re-imports extension code within a
        // session, so this is how we verify which revision is actually live.
        console.warn(`[wallpaperengine@waylandwe] enabled, code revision ${CODE_REVISION}`);

        this._rendererWindow = null;
        this._rendererActor = null;
        this._rendererUnmanagedId = 0;
        this._rendererRaisedId = 0;
        this._rendererFocusId = 0;
        this._bgChildAddedId = 0;
        this._rendererVisibleId = 0;

        this._restartTimeoutId = 0;
        this._retryTimeoutId = 0;
        this._killTimeoutId = 0;
        this._matchTimeouts = new Set();

        this._injectionManager = new InjectionManager();
        this._installOverviewHiding();

        this._windowCreatedId = global.display.connect(
            'window-created', (_display, window) => this._onWindowCreated(window));

        this._monitorsChangedId = Main.layoutManager.connect(
            'monitors-changed', () => this._scheduleRestart());

        this._settingsChangedId = this._settings.connect(
            'changed', () => this._scheduleRestart());

        // Suspend rendering while the screensaver / screen blank is active.
        // (The full lock screen additionally disables this extension entirely
        // because metadata.json only declares the "user" session mode.)
        this._screenSaverSubId = Gio.DBus.session.signal_subscribe(
            'org.gnome.ScreenSaver',
            'org.gnome.ScreenSaver',
            'ActiveChanged',
            '/org/gnome/ScreenSaver',
            null,
            Gio.DBusSignalFlags.NONE,
            (_conn, _sender, _path, _iface, _signal, params) => {
                const [active] = params.deep_unpack();
                this._setPaused(active);
            });

        if (this._settings.get_boolean('enabled'))
            this._startEngine();
    }

    disable() {
        this._destroyed = true;

        if (this._injectionManager) {
            this._injectionManager.clear();
            this._injectionManager = null;
        }

        if (this._windowCreatedId) {
            global.display.disconnect(this._windowCreatedId);
            this._windowCreatedId = 0;
        }
        if (this._monitorsChangedId) {
            Main.layoutManager.disconnect(this._monitorsChangedId);
            this._monitorsChangedId = 0;
        }
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = 0;
        }
        if (this._screenSaverSubId) {
            Gio.DBus.session.signal_unsubscribe(this._screenSaverSubId);
            this._screenSaverSubId = 0;
        }

        this._clearTimeouts();
        this._stopEngine(true);

        this._settings = null;
    }

    // Hide the renderer window from the Overview grid, workspace thumbnails
    // and Alt-Tab. Without this GNOME treats it like any other normal
    // window: it shows up as a selectable tile, and clicking/hovering into
    // it makes GNOME try to focus a window that isn't really meant to be
    // interacted with, which looks like an involuntary Alt-Tab.
    _installOverviewHiding() {
        // The matcher must work the moment the window first appears (the
        // Overview registers new windows before our polling-based adoption
        // finishes), hence _windowMatchesRenderer rather than only checking
        // the adopted-window reference. Never let an exception escape into
        // the shell's UI code: misidentifying a window as "not ours" only
        // shows an extra tile, while a thrown error breaks the Overview.
        const isRenderer = window => {
            try {
                return this._windowMatchesRenderer(window);
            } catch (_e) {
                return false;
            }
        };

        this._injectionManager.overrideMethod(Workspace.prototype, '_isOverviewWindow',
            originalMethod => function (window) {
                return isRenderer(window) ? false : originalMethod.apply(this, [window]);
            });

        this._injectionManager.overrideMethod(WorkspaceThumbnail.prototype, '_isOverviewWindow',
            originalMethod => function (window) {
                return isRenderer(window) ? false : originalMethod.apply(this, [window]);
            });

        this._injectionManager.overrideMethod(Meta.Display.prototype, 'get_tab_list',
            originalMethod => function (type, workspace) {
                return originalMethod.apply(this, [type, workspace])
                    .filter(window => !isRenderer(window));
            });

        this._injectionManager.overrideMethod(Shell.Global.prototype, 'get_window_actors',
            originalMethod => function () {
                return originalMethod.call(this)
                    .filter(actor => !isRenderer(actor.get_meta_window()));
            });

        this._injectionManager.overrideMethod(Shell.WindowTracker.prototype, 'get_window_app',
            originalMethod => function (window) {
                return isRenderer(window) ? null : originalMethod.apply(this, [window]);
            });

        this._injectionManager.overrideMethod(Shell.App.prototype, 'get_windows',
            originalMethod => function () {
                return originalMethod.call(this).filter(window => !isRenderer(window));
            });

        this._injectionManager.overrideMethod(Shell.App.prototype, 'get_n_windows',
            _originalMethod => function () {
                return this.get_windows().length;
            });

        this._injectionManager.overrideMethod(Shell.AppSystem.prototype, 'get_running',
            originalMethod => function () {
                return originalMethod.call(this).filter(app => app.get_n_windows() > 0);
            });
    }

    _clearTimeouts() {
        if (this._restartTimeoutId) {
            GLib.source_remove(this._restartTimeoutId);
            this._restartTimeoutId = 0;
        }
        if (this._retryTimeoutId) {
            GLib.source_remove(this._retryTimeoutId);
            this._retryTimeoutId = 0;
        }
        if (this._killTimeoutId) {
            GLib.source_remove(this._killTimeoutId);
            this._killTimeoutId = 0;
        }
        for (const id of this._matchTimeouts)
            GLib.source_remove(id);
        this._matchTimeouts.clear();
    }

    // ---------------------------------------------------------------- geometry

    _targetMonitorIndex() {
        const monitors = Main.layoutManager.monitors;
        let index = this._settings.get_int('monitor-index');
        if (index < 0 || index >= monitors.length)
            index = Main.layoutManager.primaryIndex;
        return index;
    }

    _targetGeometry() {
        const monitor = Main.layoutManager.monitors[this._targetMonitorIndex()];
        return {
            x: monitor.x,
            y: monitor.y,
            width: monitor.width,
            height: monitor.height,
        };
    }

    // ------------------------------------------------------------ command line

    _resolveEngine() {
        const engine = this._settings.get_string('engine');
        if (engine !== 'auto')
            return engine;

        const sceneConfigured = this._settings.get_string('wallpaper-id').trim() !== '';
        const weBinary = expandTilde(this._settings.get_string('wallpaperengine-path'));
        const weFound = GLib.path_is_absolute(weBinary)
            ? GLib.file_test(weBinary, GLib.FileTest.IS_EXECUTABLE)
            : GLib.find_program_in_path(weBinary) !== null;

        if (sceneConfigured && weFound)
            return 'wallpaperengine';
        return 'mpv';
    }

    _resolveScenePath() {
        const raw = this._settings.get_string('wallpaper-id').trim();
        if (raw === '')
            return null;

        if (/^\d+$/.test(raw)) {
            const workshop = expandTilde(this._settings.get_string('workshop-path'));
            const candidate = GLib.build_filenamev([workshop, raw]);
            if (GLib.file_test(candidate, GLib.FileTest.EXISTS))
                return candidate;
            // Let linux-wallpaperengine try to locate the bare ID itself.
            return raw;
        }
        return expandTilde(raw);
    }

    _buildWallpaperEngineArgv() {
        const scene = this._resolveScenePath();
        if (scene === null) {
            this._notifyError(
                'No Wallpaper Engine scene configured. Set a Workshop item ID or scene path in the extension preferences.');
            return null;
        }

        const geo = this._targetGeometry();
        const fps = this._settings.get_int('fps');
        const scaling = this._settings.get_string('scaling');
        const argv = [
            expandTilde(this._settings.get_string('wallpaperengine-path')),
            '--fps', String(fps),
            '--scaling', scaling,
            // GNOME's Mutter does not implement wlr-layer-shell, so the
            // engine renders into a normal window sized to the monitor; the
            // extension then reparents that window behind the desktop.
            '--window', `0x0x${geo.width}x${geo.height}`,
        ];

        if (this._settings.get_boolean('mute'))
            argv.push('--silent');
        else
            argv.push('--volume', String(this._settings.get_int('volume')));

        const assets = expandTilde(this._settings.get_string('assets-path').trim());
        if (assets !== '')
            argv.push('--assets-dir', assets);

        argv.push(scene);
        return argv;
    }

    _buildMpvArgv() {
        const video = expandTilde(this._settings.get_string('video-path').trim());
        if (video === '') {
            this._notifyError(
                'No video file configured. Pick an MP4/WebM/GIF in the extension preferences.');
            return null;
        }
        if (!GLib.file_test(video, GLib.FileTest.EXISTS)) {
            this._notifyError(`Video file not found: ${video}`);
            return null;
        }

        const fps = this._settings.get_int('fps');
        const scaling = this._settings.get_string('scaling');
        const mute = this._settings.get_boolean('mute');
        const volume = this._settings.get_int('volume');

        const argv = [
            expandTilde(this._settings.get_string('mpv-path')),
            '--no-config',
            '--really-quiet',
            '--force-window=yes',
            '--no-border',
            '--no-osc',
            '--no-osd-bar',
            '--no-input-default-bindings',
            '--input-vo-keyboard=no',
            '--no-input-cursor',
            '--cursor-autohide=no',
            '--no-stop-screensaver',
            '--no-audio-display',
            '--hwdec=auto-safe',
            '--loop-file=inf',
            `--title=${MPV_APP_ID}`,
            `--wayland-app-id=${MPV_APP_ID}`,
            `--x11-name=${MPV_APP_ID}`,
            `--vf=fps=${fps}`,
            `--volume=${volume}`,
            mute ? '--mute=yes' : '--mute=no',
        ];

        if (scaling === 'fill')
            argv.push('--panscan=1.0');
        else if (scaling === 'stretch')
            argv.push('--keepaspect=no');

        argv.push(video);
        return argv;
    }

    // ------------------------------------------------------- process lifecycle

    _startEngine() {
        if (this._proc !== null || this._destroyed)
            return;
        if (Main.layoutManager.monitors.length === 0)
            return;

        const engine = this._resolveEngine();
        const argv = engine === 'wallpaperengine'
            ? this._buildWallpaperEngineArgv()
            : this._buildMpvArgv();
        if (argv === null)
            return;

        // Prefer spawning through Meta.WaylandClient: Mutter then knows the
        // window belongs to a compositor-private client, and owns_window()
        // gives us exact, race-free identification of the renderer window
        // (mpv reports no usable wm_class/app-id on Wayland, and PID matching
        // only works after the window exists). Fall back to a plain
        // subprocess if that fails (e.g. X11 session).
        let proc = null;
        this._waylandClient = null;
        try {
            const flags = Gio.SubprocessFlags.STDOUT_SILENCE |
                Gio.SubprocessFlags.STDERR_SILENCE;
            if (Meta.is_wayland_compositor()) {
                const launcher = new Gio.SubprocessLauncher({flags});
                this._waylandClient =
                    Meta.WaylandClient.new_subprocess(global.context, launcher, argv);
                proc = this._waylandClient.get_subprocess();
            }
            if (proc === null)
                proc = Gio.Subprocess.new(argv, flags);
        } catch (e) {
            this._waylandClient = null;
            try {
                proc = Gio.Subprocess.new(
                    argv,
                    Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE);
            } catch (e2) {
                this._notifyError(
                    `Failed to launch "${argv[0]}": ${e2.message}. ` +
                    'Check that the binary is installed (see scripts/install-fedora.sh).');
                return;
            }
        }

        this._proc = proc;
        this._procStopping = false;
        this._paused = false;
        this._procStartTime = GLib.get_monotonic_time();

        proc.wait_async(null, (p, res) => {
            try {
                p.wait_finish(res);
            } catch (_e) {
                // Cancelled or reaping failed; treat as exit.
            }
            this._onEngineExited(p);
        });
    }

    _onEngineExited(proc) {
        if (proc !== this._proc || this._destroyed)
            return;

        const wasStopping = this._procStopping;
        const uptime = GLib.get_monotonic_time() - this._procStartTime;
        this._proc = null;
        this._waylandClient = null;
        this._procStopping = false;
        this._paused = false;
        this._forgetWindow();

        if (wasStopping)
            return;

        if (uptime > STABLE_RUNTIME_US)
            this._crashRetries = 0;

        if (this._crashRetries < MAX_CRASH_RETRIES) {
            this._crashRetries++;
            this._retryTimeoutId = GLib.timeout_add(
                GLib.PRIORITY_DEFAULT, CRASH_RETRY_DELAY_MS, () => {
                    this._retryTimeoutId = 0;
                    if (this._settings?.get_boolean('enabled'))
                        this._startEngine();
                    return GLib.SOURCE_REMOVE;
                });
        } else {
            this._notifyError(
                'The wallpaper engine process keeps crashing and has been stopped. ' +
                'Check your scene/video settings, then toggle the extension to retry.');
        }
    }

    _stopEngine(immediate = false) {
        if (this._retryTimeoutId) {
            GLib.source_remove(this._retryTimeoutId);
            this._retryTimeoutId = 0;
        }
        for (const id of this._matchTimeouts)
            GLib.source_remove(id);
        this._matchTimeouts.clear();

        this._releaseWindow();

        const proc = this._proc;
        if (proc === null)
            return;

        this._procStopping = true;

        if (this._paused) {
            try {
                proc.send_signal(SIGCONT);
            } catch (_e) {
                // Process already gone.
            }
            this._paused = false;
        }

        if (immediate) {
            proc.force_exit();
            return;
        }

        try {
            proc.send_signal(SIGTERM);
        } catch (_e) {
            return;
        }

        this._killTimeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT, 3000, () => {
                this._killTimeoutId = 0;
                if (this._proc === proc && this._procStopping)
                    proc.force_exit();
                return GLib.SOURCE_REMOVE;
            });
    }

    _scheduleRestart() {
        if (this._destroyed)
            return;
        if (this._restartTimeoutId) {
            GLib.source_remove(this._restartTimeoutId);
            this._restartTimeoutId = 0;
        }
        this._restartTimeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT, RESTART_DEBOUNCE_MS, () => {
                this._restartTimeoutId = 0;
                this._crashRetries = 0;
                this._stopEngine();
                if (this._settings?.get_boolean('enabled'))
                    this._startEngine();
                return GLib.SOURCE_REMOVE;
            });
    }

    _setPaused(paused) {
        if (this._proc === null || this._procStopping || paused === this._paused)
            return;
        try {
            this._proc.send_signal(paused ? SIGSTOP : SIGCONT);
            this._paused = paused;
        } catch (_e) {
            // Process already gone; the exit handler will clean up.
        }
    }

    // -------------------------------------------------------- window embedding

    _onWindowCreated(window) {
        if (this._proc === null || this._rendererWindow !== null || this._destroyed)
            return;

        // wm_class / app-id and title may not be set at creation time on
        // Wayland; poll briefly before giving up on this window.
        let attempts = 0;
        const sourceId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT, WINDOW_MATCH_INTERVAL_MS, () => {
                attempts++;
                const done = this._tryAdoptWindow(window);
                if (done || attempts >= WINDOW_MATCH_RETRIES) {
                    this._matchTimeouts.delete(sourceId);
                    return GLib.SOURCE_REMOVE;
                }
                return GLib.SOURCE_CONTINUE;
            });
        this._matchTimeouts.add(sourceId);
    }

    _windowMatchesRenderer(window) {
        if (window == null)
            return false;

        // Callers aren't consistent about what they hand us: Workspace's
        // _isOverviewWindow passes a MetaWindow, WorkspaceThumbnail's passes
        // a MetaWindowActor. Accept both.
        if (typeof window.get_meta_window === 'function')
            window = window.get_meta_window();
        if (window == null || typeof window.get_pid !== 'function')
            return false;

        // Already adopted: identity beats every heuristic.
        if (window === this._rendererWindow)
            return true;

        // Authoritative on Wayland: Mutter tracks which client owns the window.
        if (this._waylandClient !== null) {
            try {
                if (this._waylandClient.owns_window(window))
                    return true;
            } catch (_e) {
                // Client already gone; fall through to the heuristics.
            }
        }

        if (this._proc === null)
            return false;

        const procPid = parseInt(this._proc.get_identifier(), 10);
        if (Number.isInteger(procPid) && window.get_pid() === procPid)
            return true;

        const wmClass = (window.get_wm_class() ?? '').toLowerCase();
        const title = (window.get_title() ?? '').toLowerCase();
        return RENDERER_WM_CLASSES.some(c =>
            wmClass === c.toLowerCase() || title === c.toLowerCase());
    }

    _tryAdoptWindow(window) {
        if (this._rendererWindow !== null || this._destroyed)
            return true;
        if (!this._windowMatchesRenderer(window))
            return false;

        const actor = window.get_compositor_private();
        if (!actor)
            return false;

        this._rendererWindow = window;
        this._rendererActor = actor;

        // Keep the renderer out of everyone's way. We deliberately do NOT call
        // window.stick() here: once the actor is reparented into
        // _backgroundGroup below it is already visible on every workspace
        // (that group is a single persistent layer, not per-workspace), and
        // marking the *window* itself sticky makes GNOME's workspace-switch
        // slide animation (workspaceAnimation.js _syncStacking) try to look up
        // a per-workspace stacking record for it and crash, since its actor no
        // longer lives where the window-tracking code expects.
        window.lower();

        const geo = this._targetGeometry();
        window.move_resize_frame(false, geo.x, geo.y, geo.width, geo.height);

        // Move the window's actor from the normal window stack into the
        // background group. _backgroundGroup lives inside window_group at the
        // very bottom, so the video ends up above the static wallpaper but
        // strictly below desktop-icon windows and all application windows.
        const bgGroup = Main.layoutManager._backgroundGroup;
        const parent = actor.get_parent();
        if (parent !== bgGroup) {
            if (parent)
                parent.remove_child(actor);
            bgGroup.add_child(actor);
        }

        // The shell recreates its static background actors whenever settings,
        // monitors, or the session mode change (including right after the
        // login transition), and new ones are added on top of the group -
        // which would bury the video under the static wallpaper. Pin our
        // actor to the top of the group whenever a sibling appears.
        bgGroup.set_child_above_sibling(actor, null);
        this._bgChildAddedId = bgGroup.connect('child-added', (group, child) => {
            if (child !== actor)
                group.set_child_above_sibling(actor, null);
        });

        // Mutter hides a window's actor whenever its owning MetaWindow isn't
        // on the active workspace - that hiding happens at the actor level
        // and is independent of which Clutter group currently parents it, so
        // reparenting alone does not make the video survive a workspace
        // switch. We deliberately do NOT call window.stick() to solve this:
        // that marks the *window* sticky, which makes GNOME's workspace-
        // switch slide animation (workspaceAnimation.js's WorkspaceGroup)
        // try to clone/track it as a normal sticky window - but its actor no
        // longer lives where that code expects, and it crashes _syncStacking.
        // Instead we fight the symptom directly: whenever something hides
        // the actor, show it again immediately.
        this._rendererVisibleId = actor.connect('notify::visible', () => {
            if (!actor.visible) {
                console.warn('[wallpaperengine@waylandwe] renderer actor was ' +
                    'hidden (likely a workspace switch); forcing it visible again');
                actor.show();
            }
        });
        if (!actor.visible)
            actor.show();

        this._rendererUnmanagedId = window.connect('unmanaged', () => {
            this._forgetWindow();
        });

        // A wallpaper must never hold focus or rise in the stack, yet its
        // surface covers the whole desktop, so any click on "the desktop"
        // actually lands on it. Undo both effects whenever they happen -
        // without this, clicking the wallpaper visibly yanks focus off the
        // active application (and Mutter logs stack-position assertions when
        // it tries to restack a window whose actor lives in the background
        // layer).
        this._rendererRaisedId = window.connect_after('raised', () => {
            window.lower();
        });
        this._rendererFocusId = window.connect('focus', () => {
            this._refocusNormalWindow(window);
        });

        // The renderer stole focus when it mapped; give it back to the most
        // recently used normal window.
        this._refocusNormalWindow(window);

        console.warn(`[wallpaperengine@waylandwe] adopted renderer window ` +
            `"${window.get_title() ?? ''}" (pid ${window.get_pid()}) ` +
            `into the background layer`);

        return true;
    }

    _refocusNormalWindow(rendererWindow) {
        const tabList = global.display
            .get_tab_list(Meta.TabList.NORMAL, null)
            .filter(w => w !== rendererWindow);
        if (tabList.length > 0)
            tabList[0].activate(global.get_current_time());
    }

    _forgetWindow() {
        if (this._rendererWindow !== null) {
            if (this._rendererUnmanagedId)
                this._rendererWindow.disconnect(this._rendererUnmanagedId);
            if (this._rendererRaisedId)
                this._rendererWindow.disconnect(this._rendererRaisedId);
            if (this._rendererFocusId)
                this._rendererWindow.disconnect(this._rendererFocusId);
        }
        if (this._bgChildAddedId) {
            Main.layoutManager._backgroundGroup.disconnect(this._bgChildAddedId);
            this._bgChildAddedId = 0;
        }
        if (this._rendererVisibleId && this._rendererActor) {
            try {
                this._rendererActor.disconnect(this._rendererVisibleId);
            } catch (_e) {
                // Actor may already be disposed if this runs from 'unmanaged'.
            }
        }
        this._rendererVisibleId = 0;
        this._rendererUnmanagedId = 0;
        this._rendererRaisedId = 0;
        this._rendererFocusId = 0;
        this._rendererWindow = null;
        this._rendererActor = null;
    }

    _releaseWindow() {
        const actor = this._rendererActor;
        this._forgetWindow();

        // Hand the actor back to the normal window stack before the process
        // dies so Mutter can destroy it from its expected parent.
        if (actor && actor.get_parent() === Main.layoutManager._backgroundGroup) {
            Main.layoutManager._backgroundGroup.remove_child(actor);
            global.window_group.add_child(actor);
        }
    }

    // ---------------------------------------------------------------- misc

    _notifyError(message) {
        console.error(`[wallpaperengine@waylandwe] ${message}`);
        Main.notify('Wallpaper Engine for Wayland', message);
    }
}
