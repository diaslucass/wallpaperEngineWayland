// Wallpaper Engine for Wayland - Libadwaita preferences window (GNOME 45+)

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const ENGINE_VALUES = ['auto', 'wallpaperengine', 'mpv'];
const ENGINE_LABELS = [_('Automatic'), _('linux-wallpaperengine'), _('mpv')];

const SCALING_VALUES = ['fit', 'fill', 'stretch'];
const SCALING_LABELS = [_('Fit (letterbox)'), _('Fill (crop)'), _('Stretch')];

const FPS_VALUES = [30, 60];
const FPS_LABELS = ['30 FPS', '60 FPS'];

function shortenPath(path) {
    const home = GLib.get_home_dir();
    if (path.startsWith(home))
        return `~${path.slice(home.length)}`;
    return path;
}

export default class WallpaperEnginePrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.set_default_size(680, 780);
        window.set_search_enabled(true);

        const page = new Adw.PreferencesPage({
            title: _('Wallpaper'),
            icon_name: 'preferences-desktop-wallpaper-symbolic',
        });
        window.add(page);

        page.add(this._buildGeneralGroup(settings));
        page.add(this._buildVideoGroup(settings, window));
        page.add(this._buildWallpaperEngineGroup(settings, window));
        page.add(this._buildPlaybackGroup(settings));
        page.add(this._buildDisplayGroup(settings));
    }

    // ------------------------------------------------------------------ groups

    _buildGeneralGroup(settings) {
        const group = new Adw.PreferencesGroup({
            title: _('General'),
        });

        const enabledRow = new Adw.SwitchRow({
            title: _('Animated Wallpaper'),
            subtitle: _('Master switch for the wallpaper engine process'),
        });
        settings.bind('enabled', enabledRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(enabledRow);

        const engineRow = new Adw.ComboRow({
            title: _('Rendering Engine'),
            subtitle: _('Automatic uses linux-wallpaperengine for Workshop scenes, mpv otherwise'),
            model: Gtk.StringList.new(ENGINE_LABELS),
        });
        this._bindComboToStringSetting(settings, 'engine', engineRow, ENGINE_VALUES);
        group.add(engineRow);

        return group;
    }

    _buildVideoGroup(settings, window) {
        const group = new Adw.PreferencesGroup({
            title: _('Video Wallpaper (mpv)'),
            description: _('Local MP4, WebM, MKV or GIF played with hardware-accelerated mpv'),
        });

        const videoRow = new Adw.ActionRow({
            title: _('Video File'),
            activatable: true,
        });
        const updateVideoSubtitle = () => {
            const path = settings.get_string('video-path');
            videoRow.set_subtitle(path === '' ? _('No file selected') : shortenPath(path));
        };
        updateVideoSubtitle();
        settings.connect('changed::video-path', updateVideoSubtitle);

        const clearButton = new Gtk.Button({
            icon_name: 'edit-clear-symbolic',
            tooltip_text: _('Clear selection'),
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });
        clearButton.connect('clicked', () => settings.set_string('video-path', ''));

        const browseButton = new Gtk.Button({
            icon_name: 'document-open-symbolic',
            tooltip_text: _('Choose a video file'),
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });
        const openVideoDialog = () => {
            const filter = new Gtk.FileFilter();
            filter.set_name(_('Videos and GIFs'));
            filter.add_mime_type('video/mp4');
            filter.add_mime_type('video/webm');
            filter.add_mime_type('video/x-matroska');
            filter.add_mime_type('image/gif');

            const allFilter = new Gtk.FileFilter();
            allFilter.set_name(_('All files'));
            allFilter.add_pattern('*');

            const filters = new Gio.ListStore({item_type: Gtk.FileFilter});
            filters.append(filter);
            filters.append(allFilter);

            const dialog = new Gtk.FileDialog({
                title: _('Select a Video Wallpaper'),
                modal: true,
                filters,
                default_filter: filter,
            });
            dialog.open(window, null, (dlg, result) => {
                try {
                    const file = dlg.open_finish(result);
                    if (file !== null)
                        settings.set_string('video-path', file.get_path());
                } catch (_e) {
                    // Dialog dismissed by the user.
                }
            });
        };
        browseButton.connect('clicked', openVideoDialog);
        videoRow.connect('activated', openVideoDialog);

        videoRow.add_suffix(clearButton);
        videoRow.add_suffix(browseButton);
        group.add(videoRow);

        const mpvPathRow = new Adw.EntryRow({
            title: _('mpv Command'),
        });
        settings.bind('mpv-path', mpvPathRow, 'text', Gio.SettingsBindFlags.DEFAULT);
        group.add(mpvPathRow);

        return group;
    }

    _buildWallpaperEngineGroup(settings, window) {
        const group = new Adw.PreferencesGroup({
            title: _('Steam Wallpaper Engine'),
            description: _('Workshop scenes rendered with linux-wallpaperengine'),
        });

        const idRow = new Adw.EntryRow({
            title: _('Workshop Item ID or Scene Path'),
        });
        settings.bind('wallpaper-id', idRow, 'text', Gio.SettingsBindFlags.DEFAULT);
        group.add(idRow);

        group.add(this._buildFolderRow(
            settings, window, 'workshop-path',
            _('Workshop Content Folder'),
            _('Select the Steam Workshop Content Folder')));

        group.add(this._buildFolderRow(
            settings, window, 'assets-path',
            _('Assets Folder (optional)'),
            _('Select the Wallpaper Engine Assets Folder')));

        const binRow = new Adw.EntryRow({
            title: _('linux-wallpaperengine Command'),
        });
        settings.bind('wallpaperengine-path', binRow, 'text', Gio.SettingsBindFlags.DEFAULT);
        group.add(binRow);

        return group;
    }

    _buildFolderRow(settings, window, key, title, dialogTitle) {
        const row = new Adw.ActionRow({
            title,
            activatable: true,
        });
        const updateSubtitle = () => {
            const path = settings.get_string(key);
            row.set_subtitle(path === '' ? _('Not set') : shortenPath(path));
        };
        updateSubtitle();
        settings.connect(`changed::${key}`, updateSubtitle);

        const clearButton = new Gtk.Button({
            icon_name: 'edit-clear-symbolic',
            tooltip_text: _('Clear selection'),
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });
        clearButton.connect('clicked', () => settings.set_string(key, ''));

        const browseButton = new Gtk.Button({
            icon_name: 'folder-open-symbolic',
            tooltip_text: _('Choose a folder'),
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });
        const openFolderDialog = () => {
            const dialog = new Gtk.FileDialog({
                title: dialogTitle,
                modal: true,
            });
            dialog.select_folder(window, null, (dlg, result) => {
                try {
                    const folder = dlg.select_folder_finish(result);
                    if (folder !== null)
                        settings.set_string(key, folder.get_path());
                } catch (_e) {
                    // Dialog dismissed by the user.
                }
            });
        };
        browseButton.connect('clicked', openFolderDialog);
        row.connect('activated', openFolderDialog);

        row.add_suffix(clearButton);
        row.add_suffix(browseButton);
        return row;
    }

    _buildPlaybackGroup(settings) {
        const group = new Adw.PreferencesGroup({
            title: _('Playback'),
        });

        const muteRow = new Adw.SwitchRow({
            title: _('Mute Audio'),
        });
        settings.bind('mute', muteRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(muteRow);

        const volumeRow = new Adw.SpinRow({
            title: _('Volume'),
            subtitle: _('Audio volume in percent when not muted'),
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 100,
                step_increment: 5,
                page_increment: 10,
            }),
        });
        settings.bind('volume', volumeRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('mute', volumeRow, 'sensitive',
            Gio.SettingsBindFlags.GET | Gio.SettingsBindFlags.INVERT_BOOLEAN);
        group.add(volumeRow);

        const fpsRow = new Adw.ComboRow({
            title: _('FPS Cap'),
            subtitle: _('Lower values save GPU/CPU and battery'),
            model: Gtk.StringList.new(FPS_LABELS),
        });
        const currentFps = settings.get_int('fps');
        const fpsIndex = FPS_VALUES.indexOf(currentFps);
        fpsRow.set_selected(fpsIndex >= 0 ? fpsIndex : 1);
        fpsRow.connect('notify::selected', () => {
            settings.set_int('fps', FPS_VALUES[fpsRow.get_selected()]);
        });
        group.add(fpsRow);

        const scalingRow = new Adw.ComboRow({
            title: _('Scaling Mode'),
            model: Gtk.StringList.new(SCALING_LABELS),
        });
        this._bindComboToStringSetting(settings, 'scaling', scalingRow, SCALING_VALUES);
        group.add(scalingRow);

        return group;
    }

    _buildDisplayGroup(settings) {
        const group = new Adw.PreferencesGroup({
            title: _('Display'),
        });

        const labels = [_('Primary Monitor')];
        const display = Gdk.Display.get_default();
        if (display !== null) {
            const monitors = display.get_monitors();
            for (let i = 0; i < monitors.get_n_items(); i++) {
                const monitor = monitors.get_item(i);
                const connector = monitor.get_connector() ?? _('Unknown');
                const description = monitor.get_description() ?? '';
                labels.push(description !== ''
                    ? `${i}: ${description} (${connector})`
                    : `${i}: ${connector}`);
            }
        }

        const monitorRow = new Adw.ComboRow({
            title: _('Target Monitor'),
            subtitle: _('Which monitor the animated wallpaper is rendered on'),
            model: Gtk.StringList.new(labels),
        });
        const currentIndex = settings.get_int('monitor-index');
        monitorRow.set_selected(
            currentIndex >= 0 && currentIndex + 1 < labels.length ? currentIndex + 1 : 0);
        monitorRow.connect('notify::selected', () => {
            const selected = monitorRow.get_selected();
            settings.set_int('monitor-index', selected === 0 ? -1 : selected - 1);
        });
        group.add(monitorRow);

        return group;
    }

    // ----------------------------------------------------------------- helpers

    _bindComboToStringSetting(settings, key, comboRow, values) {
        const current = settings.get_string(key);
        const index = values.indexOf(current);
        comboRow.set_selected(index >= 0 ? index : 0);
        comboRow.connect('notify::selected', () => {
            settings.set_string(key, values[comboRow.get_selected()]);
        });
    }
}
