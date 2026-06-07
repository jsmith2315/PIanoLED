# Raspberry Pi Zero 2 W Install Guide

This project can run on a Raspberry Pi Zero 2 W without changing the main application logic, but the install path should be different from the original Pi Zero setup:

- Use **Raspberry Pi OS Lite Bookworm 32-bit**, not Trixie, for the first install.
- Install **all Python dependencies from `apt`** except `rpi_ws281x`.
- Install `rpi_ws281x` from a **prebuilt wheel** copied onto the Zero 2 W.
- Run the `visualizer.service` as **root** so newer Raspberry Pi OS releases do not depend on passwordless `sudo`.
- Do **not** install the legacy `connectall.py` udev/service pair; the current app already monitors MIDI devices and reconnects them in-process.

## Why Bookworm 32-bit is the safer choice

Bookworm 32-bit is the best fit for a Zero 2 W with 512 MB RAM:

- the project's optional `rtpmidid` package is already distributed as an `armhf` `.deb`
- the smaller 32-bit userspace is friendlier to the Zero 2 W's memory limits
- Bookworm has less package churn than Trixie for this project's current install/update flow
- fresh Trixie installs now require a password for `sudo` by default, which conflicts with the old service layout

Trixie can probably be made to work after the same runtime changes, but Bookworm is the lower-risk path for a compatibility-focused install.

## What changed in the repo for newer Pi OS releases

- Wi-Fi status and scanning now prefer `nmcli`, which matches Bookworm/Trixie's default `NetworkManager` setup.
- The in-app updater now refreshes the Python runtime dependencies from `apt` instead of trying to rebuild everything from `pip`.

## Step 1: Flash the right OS

In Raspberry Pi Imager choose:

- Device: `Raspberry Pi Zero 2 W`
- OS: `Raspberry Pi OS Lite (32-bit)` based on **Bookworm**

In the Imager advanced options:

- enable SSH
- set a username and password
- set Wi-Fi credentials if you want the Pi on your normal network immediately

## Step 2: Build or obtain a prebuilt `rpi_ws281x` wheel

There is no reliable fully precompiled `rpi_ws281x` package in Debian for this project, and the PyPI package is source-based. To keep the Zero 2 W from compiling it locally, build the wheel on a helper machine first.

The helper machine should ideally be:

- another Raspberry Pi 3/4/5
- running **Raspberry Pi OS Bookworm 32-bit**
- using Python 3.11

On the helper machine:

```bash
sudo apt update
sudo apt install -y git python3-pip python3-dev swig scons build-essential
mkdir -p ~/plv-wheelhouse
python3 -m pip wheel --no-deps rpi-ws281x==5.0.0 -w ~/plv-wheelhouse
ls -1 ~/plv-wheelhouse
```

You should get a file similar to:

```text
rpi_ws281x-5.0.0-cp311-cp311-linux_armv7l.whl
```

Copy that wheel to the Zero 2 W, for example into `/home/<your-user>/wheelhouse/`.

## Step 3: Copy the project to the Pi

On the Zero 2 W:

```bash
cd ~
git clone https://github.com/onlaj/Piano-LED-Visualizer.git Piano-LED-Visualizer
cd ~/Piano-LED-Visualizer
```

If you are using your own modified checkout, copy your version into `~/Piano-LED-Visualizer` instead.

## Step 4: Install the runtime packages

```bash
sudo apt update
sudo apt full-upgrade -y
sudo apt install -y \
  git \
  network-manager \
  avahi-daemon \
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
```

## Step 5: Install the prebuilt `rpi_ws281x` wheel

Adjust the filename to match the wheel you copied over:

```bash
sudo python3 -m pip install --break-system-packages --no-deps \
  /home/<your-user>/wheelhouse/rpi_ws281x-5.0.0-cp311-cp311-linux_armv7l.whl
```

This still uses `pip`, but it installs a wheel that is already compiled, so the Zero 2 W does not have to build the extension locally.

## Step 6: Enable SPI and disable onboard audio

Enable SPI:

```bash
sudo raspi-config nonint do_spi 0
```

Blacklist the audio module used by the older PWM audio path:

```bash
echo 'blacklist snd_bcm2835' | sudo tee /etc/modprobe.d/snd-blacklist.conf
```

Then comment out `dtparam=audio=on` in the active `config.txt`:

```bash
if [ -f /boot/firmware/config.txt ]; then
  sudo sed -i 's/^dtparam=audio=on/#dtparam=audio=on/' /boot/firmware/config.txt
else
  sudo sed -i 's/^dtparam=audio=on/#dtparam=audio=on/' /boot/config.txt
fi
```

## Step 7: Install `rtpmidid` if you need RTP-MIDI

This is optional. Keep the 32-bit OS so the published `armhf` package matches the system architecture.

```bash
cd /tmp
wget https://github.com/davidmoreno/rtpmidid/releases/download/v24.12/rtpmidid_24.12.2_armhf.deb
sudo dpkg -i rtpmidid_24.12.2_armhf.deb || sudo apt -f install -y
sudo apt -f install -y
rm -f rtpmidid_24.12.2_armhf.deb
```

## Step 8: Create a root-run systemd service

Create `/etc/systemd/system/visualizer.service`:

```ini
[Unit]
Description=Piano LED Visualizer
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/home/<your-user>/Piano-LED-Visualizer
ExecStart=/usr/bin/python3 /home/<your-user>/Piano-LED-Visualizer/visualizer.py
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
```

Install and start it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable visualizer.service
sudo systemctl restart visualizer.service
```

## Step 9: Reboot and verify

```bash
sudo reboot
```

After the Pi comes back:

```bash
systemctl status visualizer.service --no-pager
sudo journalctl -u visualizer.service -n 100 --no-pager
```

If the LCD is attached and SPI is enabled correctly, the menu should appear after boot. If you enabled Wi-Fi or the hotspot, the web interface should come up afterward.

## Recommended day-2 operations

- update the OS with `sudo apt update && sudo apt full-upgrade`
- avoid reinstalling Python dependencies from `requirements.txt` directly on the Zero 2 W
- if you ever need a newer `rpi_ws281x`, rebuild a new wheel on the helper machine and replace it on the Pi
