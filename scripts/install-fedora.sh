#!/usr/bin/env bash
#
# install-fedora.sh - Fedora installer for "Wallpaper Engine for Wayland"
#
# What this script does:
#   1. Enables RPM Fusion (free + nonfree) for full ffmpeg/mpv codec support
#   2. Installs runtime dependencies (mpv, ffmpeg, GStreamer plugins)
#   3. Installs build dependencies and compiles Almamu/linux-wallpaperengine
#   4. Installs the GNOME Shell extension into ~/.local/share/gnome-shell/extensions
#   5. Compiles the GSettings schema and enables the extension
#
# Usage:
#   ./scripts/install-fedora.sh                # full install
#   ./scripts/install-fedora.sh --no-engine    # skip building linux-wallpaperengine
#   ./scripts/install-fedora.sh --no-deps      # skip dnf package installation
#
set -euo pipefail

EXT_UUID="wallpaperengine@waylandwe"
EXT_DIR="${HOME}/.local/share/gnome-shell/extensions/${EXT_UUID}"
BUILD_DIR="${HOME}/.cache/linux-wallpaperengine-build"
INSTALL_PREFIX="${HOME}/.local"
ENGINE_REPO="https://github.com/Almamu/linux-wallpaperengine.git"

SKIP_ENGINE=0
SKIP_DEPS=0
for arg in "$@"; do
    case "${arg}" in
        --no-engine) SKIP_ENGINE=1 ;;
        --no-deps)   SKIP_DEPS=1 ;;
        -h|--help)
            grep '^#' "$0" | sed 's/^# \{0,1\}//'
            exit 0
            ;;
        *)
            echo "Unknown option: ${arg}" >&2
            exit 1
            ;;
    esac
done

log()  { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m==> WARNING:\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m==> ERROR:\033[0m %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- sanity checks

[[ -r /etc/fedora-release ]] || die "This script is for Fedora Linux only."
command -v dnf >/dev/null 2>&1 || die "dnf not found."
command -v gnome-shell >/dev/null 2>&1 || die "GNOME Shell not found."

if [[ "${EUID}" -eq 0 ]]; then
    die "Run this script as your normal user (it uses sudo only where needed)."
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

[[ -f "${SRC_DIR}/metadata.json" ]] || die "metadata.json not found in ${SRC_DIR}; run from the extension source tree."
[[ -f "${SRC_DIR}/extension.js" ]]  || die "extension.js not found in ${SRC_DIR}."

FEDORA_VERSION="$(rpm -E %fedora)"
log "Detected Fedora ${FEDORA_VERSION}, GNOME Shell $(gnome-shell --version | awk '{print $3}')"

# ------------------------------------------------------------------- packages

if [[ "${SKIP_DEPS}" -eq 0 ]]; then
    log "Enabling RPM Fusion free and nonfree repositories..."
    sudo dnf install -y \
        "https://mirrors.rpmfusion.org/free/fedora/rpmfusion-free-release-${FEDORA_VERSION}.noarch.rpm" \
        "https://mirrors.rpmfusion.org/nonfree/fedora/rpmfusion-nonfree-release-${FEDORA_VERSION}.noarch.rpm" \
        || warn "RPM Fusion release packages may already be installed."

    log "Swapping ffmpeg-free for full ffmpeg (needed for H.264/HEVC decode)..."
    sudo dnf swap -y ffmpeg-free ffmpeg --allowerasing \
        || sudo dnf install -y ffmpeg --allowerasing

    log "Installing runtime dependencies (mpv, GStreamer plugins, VA-API)..."
    sudo dnf install -y \
        mpv \
        ffmpeg \
        gstreamer1-plugins-good \
        gstreamer1-plugins-bad-free \
        gstreamer1-plugins-bad-freeworld \
        gstreamer1-plugins-ugly \
        gstreamer1-libav \
        libva \
        libva-utils \
        glib2 \
        gnome-extensions-app

    log "Installing build dependencies for linux-wallpaperengine..."
    sudo dnf install -y \
        git \
        cmake \
        gcc-c++ \
        make \
        zlib-devel \
        lz4-devel \
        ffmpeg-devel \
        libX11-devel \
        libXrandr-devel \
        libXxf86vm-devel \
        libXinerama-devel \
        libXcursor-devel \
        libXi-devel \
        mesa-libGL-devel \
        mesa-libEGL-devel \
        glew-devel \
        glfw-devel \
        glm-devel \
        SDL2-devel \
        freeglut-devel \
        pulseaudio-libs-devel \
        mpv-devel \
        wayland-devel \
        wayland-protocols-devel \
        dbus-devel \
        gmp-devel
else
    log "Skipping package installation (--no-deps)."
fi

# ------------------------------------------------ build linux-wallpaperengine

if [[ "${SKIP_ENGINE}" -eq 0 ]]; then
    if command -v linux-wallpaperengine >/dev/null 2>&1 && [[ ! -d "${BUILD_DIR}" ]]; then
        log "linux-wallpaperengine already installed at $(command -v linux-wallpaperengine); skipping build."
    else
        log "Cloning/updating linux-wallpaperengine..."
        if [[ -d "${BUILD_DIR}/.git" ]]; then
            git -C "${BUILD_DIR}" pull --ff-only
        else
            rm -rf "${BUILD_DIR}"
            git clone --recurse-submodules "${ENGINE_REPO}" "${BUILD_DIR}"
        fi
        git -C "${BUILD_DIR}" submodule update --init --recursive

        log "Building linux-wallpaperengine (this can take a few minutes)..."
        cmake -S "${BUILD_DIR}" -B "${BUILD_DIR}/build" \
            -DCMAKE_BUILD_TYPE=Release \
            -DCMAKE_INSTALL_PREFIX="${INSTALL_PREFIX}"
        cmake --build "${BUILD_DIR}/build" --parallel "$(nproc)"

        log "Installing linux-wallpaperengine to ${INSTALL_PREFIX}/bin..."
        mkdir -p "${INSTALL_PREFIX}/bin"
        if [[ -f "${BUILD_DIR}/build/output/linux-wallpaperengine" ]]; then
            # Newer builds place the binary plus its runtime assets in build/output;
            # keep them together and expose the binary through a symlink.
            mkdir -p "${INSTALL_PREFIX}/share/linux-wallpaperengine"
            cp -a "${BUILD_DIR}/build/output/." "${INSTALL_PREFIX}/share/linux-wallpaperengine/"
            ln -sf "${INSTALL_PREFIX}/share/linux-wallpaperengine/linux-wallpaperengine" \
                   "${INSTALL_PREFIX}/bin/linux-wallpaperengine"
        elif [[ -f "${BUILD_DIR}/build/linux-wallpaperengine" ]]; then
            cp -a "${BUILD_DIR}/build/linux-wallpaperengine" "${INSTALL_PREFIX}/bin/"
        else
            die "Build finished but the linux-wallpaperengine binary was not found."
        fi
    fi

    if ! echo "${PATH}" | tr ':' '\n' | grep -qx "${INSTALL_PREFIX}/bin"; then
        warn "${INSTALL_PREFIX}/bin is not in your PATH."
        warn "Add it with: echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.bashrc"
    fi
else
    log "Skipping linux-wallpaperengine build (--no-engine)."
fi

# ------------------------------------------------------- install the extension

log "Installing extension to ${EXT_DIR}..."
mkdir -p "${EXT_DIR}/schemas"
cp -f "${SRC_DIR}/metadata.json" "${EXT_DIR}/"
cp -f "${SRC_DIR}/extension.js"  "${EXT_DIR}/"
cp -f "${SRC_DIR}/prefs.js"      "${EXT_DIR}/"
cp -f "${SRC_DIR}/schemas/org.gnome.shell.extensions.wallpaperengine.gschema.xml" "${EXT_DIR}/schemas/"

log "Compiling GSettings schema..."
glib-compile-schemas "${EXT_DIR}/schemas/"

# ----------------------------------------------------------------- enable it

if gnome-extensions enable "${EXT_UUID}" 2>/dev/null; then
    log "Extension enabled."
else
    warn "Could not enable the extension yet - GNOME Shell has not loaded it."
    warn "On Wayland you must log out and log back in first, then run:"
    warn "    gnome-extensions enable ${EXT_UUID}"
fi

log "Done!"
echo
echo "Next steps:"
echo "  1. Log out and log back in (required on Wayland for new extensions)."
echo "  2. Enable the extension:   gnome-extensions enable ${EXT_UUID}"
echo "  3. Open the preferences:   gnome-extensions prefs ${EXT_UUID}"
echo "  4. Pick a video file, or set a Steam Workshop item ID from:"
echo "     ~/.local/share/Steam/steamapps/workshop/content/431960"
