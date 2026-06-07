#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_USER="${SUDO_USER:-${USER:-$(id -un)}}"
INSTALL_HOME="$(getent passwd "$INSTALL_USER" | cut -d: -f6 || true)"
INSTALL_HOME="${INSTALL_HOME:-/home/$INSTALL_USER}"
REPO_DIR="$SCRIPT_DIR"
LOG_DIR="$REPO_DIR/install-logs"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
LOG_FILE="$LOG_DIR/pi-zero2w-install-$TIMESTAMP.log"
SKIP_RTPMIDI=0
WHEEL_PATH=""

mkdir -p "$LOG_DIR"
touch "$LOG_FILE"
exec > >(tee -a "$LOG_FILE") 2>&1
PS4='+ [${BASH_SOURCE##*/}:${LINENO}] '
set -x

error_handler() {
  local exit_code=$?
  local line_no="$1"
  local failed_command="$2"
  echo
  echo "ERROR: command failed on line $line_no"
  echo "ERROR: $failed_command"
  echo "ERROR: exit code $exit_code"
  echo "ERROR: see log file at $LOG_FILE"
  exit "$exit_code"
}

trap 'error_handler "$LINENO" "$BASH_COMMAND"' ERR

usage() {
  cat <<EOF
Usage: bash autiubstakkpiz2.sh [--wheel /path/to/rpi_ws281x.whl] [--skip-rtpmidi]

Options:
  --wheel         Absolute or relative path to the precompiled rpi_ws281x wheel.
  --skip-rtpmidi  Skip installation of rtpmidid.
  --help          Show this message.
EOF
}

run() {
  echo
  echo "==> $*"
  "$@"
}

run_allow_fail() {
  echo
  echo "==> $*"
  set +e
  "$@"
  local exit_code=$?
  set -e
  return "$exit_code"
}

require_repo_layout() {
  if [[ ! -f "$REPO_DIR/visualizer.py" || ! -f "$REPO_DIR/requirements.txt" ]]; then
    echo "ERROR: this script must live inside the Piano-LED-Visualizer repository."
    echo "ERROR: expected to find visualizer.py and requirements.txt in $REPO_DIR"
    exit 1
  fi
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --wheel)
        [[ $# -ge 2 ]] || { echo "ERROR: --wheel requires a file path"; exit 1; }
        WHEEL_PATH="$2"
        shift 2
        ;;
      --skip-rtpmidi)
        SKIP_RTPMIDI=1
        shift
        ;;
      --help|-h)
        usage
        exit 0
        ;;
      *)
        echo "ERROR: unknown argument: $1"
        usage
        exit 1
        ;;
    esac
  done
}

find_boot_config() {
  if [[ -f /boot/firmware/config.txt ]]; then
    echo /boot/firmware/config.txt
  else
    echo /boot/config.txt
  fi
}

find_wheel() {
  if [[ -n "$WHEEL_PATH" ]]; then
    if [[ ! -f "$WHEEL_PATH" ]]; then
      echo "ERROR: wheel file not found: $WHEEL_PATH"
      exit 1
    fi
    WHEEL_PATH="$(realpath "$WHEEL_PATH")"
    return
  fi

  local candidate
  local -a search_dirs=(
    "$REPO_DIR"
    "$PWD"
    "$INSTALL_HOME"
    "$INSTALL_HOME/wheelhouse"
    "$INSTALL_HOME/wheelhouse/wheelhouse"
    /tmp
  )

  for dir in "${search_dirs[@]}"; do
    [[ -d "$dir" ]] || continue
    candidate="$(find "$dir" -maxdepth 2 -type f -name 'rpi_ws281x-*.whl' | sort | tail -n 1 || true)"
    if [[ -n "$candidate" ]]; then
      WHEEL_PATH="$candidate"
      break
    fi
  done

  if [[ -z "$WHEEL_PATH" ]]; then
    echo "ERROR: no precompiled rpi_ws281x wheel was found."
    echo "ERROR: place the wheel in one of these locations or pass --wheel:"
    printf '  - %s\n' "${search_dirs[@]}"
    exit 1
  fi

  WHEEL_PATH="$(realpath "$WHEEL_PATH")"
}

check_platform() {
  local arch
  arch="$(dpkg --print-architecture)"
  if [[ "$arch" != "armhf" ]]; then
    echo "ERROR: this installer is written for Raspberry Pi OS Bookworm 32-bit on a Zero 2 W."
    echo "ERROR: expected dpkg architecture 'armhf' but found '$arch'"
    exit 1
  fi

  local machine
  machine="$(uname -m)"
  if [[ "$machine" != "armv7l" ]]; then
    echo "ERROR: expected machine type armv7l but found '$machine'"
    exit 1
  fi
}

check_wheel_compatibility() {
  local wheel_name python_tag
  wheel_name="$(basename "$WHEEL_PATH")"
  python_tag="$(python3 - <<'PY'
import sys
print(f"cp{sys.version_info.major}{sys.version_info.minor}")
PY
)"

  if [[ "$wheel_name" != *"$python_tag"* ]]; then
    echo "ERROR: wheel '$wheel_name' does not match this Pi's Python tag '$python_tag'."
    echo "ERROR: build a wheel for the exact Python version installed on the Pi."
    exit 1
  fi

  if [[ "$wheel_name" != *"linux_armv7l.whl" ]]; then
    echo "ERROR: wheel '$wheel_name' is not an armv7l wheel."
    echo "ERROR: rebuild it for Raspberry Pi OS Bookworm 32-bit."
    exit 1
  fi
}

install_os_packages() {
  # Recover cleanly if a previous installer run left dpkg/apt in a broken state.
  run_allow_fail sudo apt-get -f install -y || true
  run sudo dpkg --configure -a
  run sudo apt-get update
  run sudo apt-get full-upgrade -y
  run sudo apt-get install -y \
    git \
    wget \
    ca-certificates \
    network-manager \
    avahi-daemon \
    libavahi-client3 \
    python3 \
    python3-pip \
    python3-flask \
    python3-mido \
    python3-numpy \
    python3-pillow \
    python3-psutil \
    python3-rpi.gpio \
    python3-rtmidi \
    python3-spidev \
    python3-waitress \
    python3-webcolors \
    python3-websockets \
    python3-werkzeug \
    abcmidi
}

check_python_version() {
  local python_tag
  python_tag="$(python3 - <<'PY'
import sys
print(f"{sys.version_info.major}.{sys.version_info.minor}")
PY
)"

  if [[ "$python_tag" != "3.11" ]]; then
    echo "ERROR: expected Python 3.11 on Raspberry Pi OS Bookworm 32-bit, found Python $python_tag"
    echo "ERROR: reflash with Raspberry Pi OS Lite Bookworm 32-bit or rebuild the wheel for this exact version."
    exit 1
  fi
}

install_wheel() {
  run sudo python3 -m pip install --break-system-packages --no-deps "$WHEEL_PATH"
}

enable_spi() {
  run sudo raspi-config nonint do_spi 0
}

disable_audio() {
  local boot_config
  boot_config="$(find_boot_config)"
  echo 'blacklist snd_bcm2835' | sudo tee /etc/modprobe.d/snd-blacklist.conf >/dev/null
  run sudo sed -i 's/^dtparam=audio=on/#dtparam=audio=on/' "$boot_config"
}

disable_visualizer_hotspot() {
  local settings_file="$REPO_DIR/config/settings.xml"
  local default_file="$REPO_DIR/config/default_settings.xml"

  if [[ ! -f "$settings_file" ]]; then
    run cp "$default_file" "$settings_file"
  fi

  run python3 - "$settings_file" <<'PY'
import sys
from xml.etree import ElementTree as ET

settings_path = sys.argv[1]
tree = ET.parse(settings_path)
root = tree.getroot()

is_hotspot_active = root.find("./is_hotspot_active")
if is_hotspot_active is None:
    raise SystemExit("Missing <is_hotspot_active> in settings.xml")

is_hotspot_active.text = "0"
tree.write(settings_path)
PY

  if sudo nmcli -t -f NAME connection show --active 2>/dev/null | grep -qx 'Hotspot'; then
    run sudo nmcli connection down Hotspot
  fi
}

install_rtpmidid() {
  if [[ "$SKIP_RTPMIDI" -eq 1 ]]; then
    echo
    echo "==> skipping rtpmidid installation"
    return
  fi

  local deb_path="/tmp/rtpmidid_24.12.2_armhf.deb"
  run wget -O "$deb_path" https://github.com/davidmoreno/rtpmidid/releases/download/v24.12/rtpmidid_24.12.2_armhf.deb
  if ! sudo dpkg -i "$deb_path"; then
    echo
    echo "==> rtpmidid had unmet dependencies; repairing with apt"
  fi
  run sudo apt-get -f install -y
  run rm -f "$deb_path"
}

create_service() {
  run sudo tee /etc/systemd/system/visualizer.service >/dev/null <<EOF
[Unit]
Description=Piano LED Visualizer
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$REPO_DIR
ExecStart=/usr/bin/python3 $REPO_DIR/visualizer.py
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF

  run sudo systemctl daemon-reload
  run sudo systemctl enable visualizer.service
  run sudo systemctl restart visualizer.service
}

show_summary() {
  echo
  echo "Installation complete."
  echo "Wheel used: $WHEEL_PATH"
  echo "Log file: $LOG_FILE"
  echo
  echo "Next steps:"
  echo "  1. Reboot the Pi: sudo reboot"
  echo "  2. Check service status after boot: systemctl status visualizer.service --no-pager"
  echo "  3. View logs if needed: sudo journalctl -u visualizer.service -n 100 --no-pager"
}

main() {
  parse_args "$@"
  require_repo_layout

  echo "Piano LED Visualizer Zero 2 W installer"
  echo "Repository: $REPO_DIR"
  echo "Install user: $INSTALL_USER"
  echo "Log file: $LOG_FILE"

  find_wheel
  check_platform
  install_os_packages
  check_python_version
  check_wheel_compatibility
  install_wheel
  enable_spi
  disable_audio
  disable_visualizer_hotspot
  install_rtpmidid
  create_service
  show_summary
}

main "$@"
