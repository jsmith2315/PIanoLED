# Piano LED Visualizer on Raspberry Pi Zero 2 W

This guide is for:

- a **Raspberry Pi Zero 2 W**
- **Raspberry Pi OS Lite Bookworm 32-bit**
- a **Windows PC**
- building `rpi_ws281x` on the PC because the Zero 2 W should not compile it locally

## Why this is the recommended path

Use **Bookworm 32-bit**, not Trixie, for this project on a Zero 2 W.

Reasons:

- Bookworm 32-bit should give you **Python 3.11**, which matches the wheel we build below.
- The Zero 2 W only has **512 MB RAM**, so 32-bit Bookworm is a safer fit.
- `rtpmidid` is available as an `armhf` package, which matches a 32-bit install.
- This project still has some older runtime assumptions, and Bookworm is the lower-risk compatibility choice.

## What you need

- Raspberry Pi Zero 2 W
- microSD card
- Windows PC
- Raspberry Pi Imager
- Docker Desktop for Windows
- Wi-Fi credentials for the Pi

## Step 1: Flash the OS

In **Raspberry Pi Imager**:

1. Device: `Raspberry Pi Zero 2 W`
2. Operating System: `Raspberry Pi OS Lite (32-bit)`
3. Storage: your microSD card

Open the advanced settings in Imager and set:

- hostname: something like `pianoledvisualizer`
- enable SSH: `Yes`
- username: choose one and remember it
- password: choose one and remember it
- configure Wi-Fi: `Yes`
- set your Wi-Fi SSID, password, and country

Write the image, insert the card into the Pi, and boot it.

## Step 2: Connect to the Pi

From **PowerShell** on Windows:

```powershell
ssh <your-user>@pianoledvisualizer.local
```

If `.local` resolution does not work, find the Pi's IP in your router and use:

```powershell
ssh <your-user>@192.168.x.x
```

## Step 3: Verify the Pi is on the right Python version

On the Pi:

```bash
python3 --version
```

You want:

```text
Python 3.11.x
```

If it is not Python 3.11, stop and reflash with **Raspberry Pi OS Lite Bookworm 32-bit**.

## Step 4: Build the `rpi_ws281x` wheel on Windows

Install **Docker Desktop** first if you do not already have it.

Create a working folder in PowerShell:

```powershell
New-Item -ItemType Directory -Force .\rpi_ws281x-wheel | Out-Null
Set-Location .\rpi_ws281x-wheel
```

Create the Dockerfile from PowerShell:

```powershell
@'
FROM --platform=$TARGETPLATFORM python:3.11-bookworm AS build

RUN apt-get update && apt-get install -y \
    build-essential \
    scons \
    swig \
 && rm -rf /var/lib/apt/lists/*

RUN python -m pip install --upgrade pip wheel
RUN python -m pip wheel --no-deps rpi-ws281x==5.0.0 -w /wheelhouse

FROM scratch
COPY --from=build /wheelhouse /wheelhouse
'@ | Set-Content -Path .\Dockerfile
```

Build the wheel with Docker Buildx:

```powershell
docker buildx inspect --bootstrap
docker buildx build --platform=linux/arm/v7 --output type=local,dest=.\wheelhouse .
```

When it finishes, check the result:

```powershell
Get-ChildItem -Recurse .\wheelhouse
```

You should get a file similar to:

```text
rpi_ws281x-5.0.0-cp311-cp311-linux_armv7l.whl
```

That `cp311` part is why the Pi needs Python 3.11.

## Step 5: Copy the wheel to the Pi

From PowerShell, copy the wheel to the Pi:

```powershell
scp .\wheelhouse\wheelhouse\rpi_ws281x-5.0.0-cp311-cp311-linux_armv7l.whl <your-user>@pianoledvisualizer.local:/home/<your-user>/
```

If `.local` does not work, use the Pi IP instead:

```powershell
scp .\wheelhouse\wheelhouse\rpi_ws281x-5.0.0-cp311-cp311-linux_armv7l.whl <your-user>@192.168.x.x:/home/<your-user>/
```

## Step 6: Install the project on the Pi

SSH back into the Pi if needed:

```powershell
ssh <your-user>@pianoledvisualizer.local
```

Install `git` first on the Pi:

```bash
sudo apt update
sudo apt install -y git
```

Then clone the project:

```bash
cd /home
git clone https://github.com/onlaj/Piano-LED-Visualizer.git Piano-LED-Visualizer
cd /home/Piano-LED-Visualizer
```

If you want to use your local modified checkout instead of GitHub, copy your repo from Windows with `scp` and place it at `/home/Piano-LED-Visualizer`.

## Step 6A: Optional one-command installer

If you want the Pi to do the package install, wheel install, SPI setup, service setup, and logging for you, run:

```bash
cd /home/Piano-LED-Visualizer
bash autiubstakkpiz2.sh --wheel /home/<your-user>/rpi_ws281x-5.0.0-cp311-cp311-linux_armv7l.whl
```

Notes:

- the script is **verbose** and prints each step while it runs
- it writes a full log to `install-logs/` inside the repo
- it checks that the wheel is present before installing
- it disables the Visualizer-managed hotspot by setting `is_hotspot_active` to `0`, so the Pi keeps using your normal Wi-Fi instead of trying to bring up `PianoLEDVisualizer`
- if you do not need RTP-MIDI, add `--skip-rtpmidi`

If you use the script, you can skip the manual install steps below and jump to the reboot and verification section after it finishes.

## Step 7: Install all precompiled runtime packages

On the Pi:

```bash
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

## Step 8: Install the prebuilt `rpi_ws281x` wheel

On the Pi:

```bash
sudo python3 -m pip install --break-system-packages --no-deps /home/<your-user>/rpi_ws281x-5.0.0-cp311-cp311-linux_armv7l.whl
```

This installs a wheel that was already compiled on your PC, so the Zero 2 W does not need to compile it.

## Step 9: Enable SPI and disable onboard audio

Enable SPI:

```bash
sudo raspi-config nonint do_spi 0
```

Blacklist the onboard audio module:

```bash
echo 'blacklist snd_bcm2835' | sudo tee /etc/modprobe.d/snd-blacklist.conf
```

Disable `dtparam=audio=on` in the active boot config:

```bash
if [ -f /boot/firmware/config.txt ]; then
  sudo sed -i 's/^dtparam=audio=on/#dtparam=audio=on/' /boot/firmware/config.txt
else
  sudo sed -i 's/^dtparam=audio=on/#dtparam=audio=on/' /boot/config.txt
fi
```

## Step 10: Optional RTP-MIDI support

If you want RTP-MIDI, install `rtpmidid`:

```bash
cd /tmp
wget https://github.com/davidmoreno/rtpmidid/releases/download/v24.12/rtpmidid_24.12.2_armhf.deb
sudo dpkg -i rtpmidid_24.12.2_armhf.deb || sudo apt -f install -y
sudo apt -f install -y
rm -f rtpmidid_24.12.2_armhf.deb
```

## Step 11: Create the systemd service

Create the service file:

```bash
sudo tee /etc/systemd/system/visualizer.service > /dev/null <<'EOF'
[Unit]
Description=Piano LED Visualizer
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/home/Piano-LED-Visualizer
ExecStart=/usr/bin/python3 /home/Piano-LED-Visualizer/visualizer.py
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF
```

Enable and start it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable visualizer.service
sudo systemctl restart visualizer.service
```

## Step 12: Reboot and verify

Reboot:

```bash
sudo reboot
```

After the Pi comes back up, reconnect and check:

```bash
systemctl status visualizer.service --no-pager
sudo journalctl -u visualizer.service -n 100 --no-pager
```

If everything is right:

- the service should be `active (running)`
- the LCD menu should appear if your display is connected
- the web interface should become available after the app starts

## Step 13: Open the web interface

From Windows, try:

- `http://pianoledvisualizer.local`
- or `http://<pi-ip-address>`

## Useful maintenance commands

Update OS packages:

```bash
sudo apt update
sudo apt full-upgrade -y
```

Restart the visualizer:

```bash
sudo systemctl restart visualizer.service
```

View recent logs:

```bash
sudo journalctl -u visualizer.service -n 200 --no-pager
```

Check Python version again:

```bash
python3 --version
```

## Important notes

- Do **not** run `pip install -r requirements.txt` directly on the Zero 2 W if you are trying to avoid local compilation.
- If you reinstall the Pi with a different Python version, you must rebuild the `rpi_ws281x` wheel to match it.
- If you switch from Bookworm 32-bit to a 64-bit OS, this wheel will be wrong and you must rebuild it for the new architecture.
