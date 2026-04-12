# Claude Whisper

Record your voice and send the transcription directly into the [Claude Code](https://marketplace.visualstudio.com/items?itemName=anthropic.claude-code) input box.

## How it works

Press `Ctrl+Shift+V` while the Claude Code input is focused to toggle recording:

1. **First press** — starts recording from your microphone
2. **Second press** — stops recording, transcribes speech to text, and pastes the result into Claude Code

## Platform support

| Platform | Status |
|---|---|
| Linux | Supported |
| macOS | Coming soon |
| Windows | Coming soon |

## Requirements

- **Claude Code** extension installed and active
- **Python 3** available on your system
- **One of the following audio tools** (detected automatically in order):
  - `parecord` — part of `pulseaudio-utils`
  - `arecord` — part of `alsa-utils`
  - `pw-record` — part of `pipewire`

Most Linux desktop systems already have at least one of these installed.

## First run

On first use, Claude Whisper will:

1. **Install `faster-whisper`** into the extension's private storage (`~/.config/Code/User/globalStorage/...`). This is a one-time setup that takes ~30 seconds and requires an internet connection.
2. **Download the Whisper `tiny` speech model** (~150 MB) to `~/.cache/huggingface/hub/`. This also happens once and is cached permanently.

Subsequent uses are fast — no downloads, no setup.

## Changing the keyboard shortcut

Open the Keyboard Shortcuts editor (`Ctrl+K Ctrl+S`), search for **Claude Whisper: Toggle Recording**, and assign any key combination you prefer.

## Privacy

All processing is local. Your audio is never sent to any server — transcription runs entirely on your machine using the Whisper model.
