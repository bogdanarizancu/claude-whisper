# Claude Whisper

VSCode extension that records mic input and sends the transcription to the Claude Code input box.

## What it does

Press `Ctrl+Shift+V` **when the Claude Code input box is focused** to toggle recording:
1. First press → starts recording mic via `arecord`
2. Second press → stops recording, transcribes with `faster-whisper`, pastes result into Claude Code

On first transcription, `faster-whisper` is auto-installed to the extension's global storage (one-time, ~30s). The Whisper `tiny` model (~150 MB) is downloaded on the first transcription and cached in `~/.cache/huggingface`.

## Key files

- [src/extension.ts](src/extension.ts) — state machine, recording, transcription, paste logic
- [scripts/transcribe.py](scripts/transcribe.py) — Python STT script (spawned per transcription)
- [package.json](package.json) — command + keybinding declarations
- [.vscode/launch.json](.vscode/launch.json) — dev host config (F5)
- [.vscode/tasks.json](.vscode/tasks.json) — background tsc watch task

## System requirements

- **Linux** with at least one of: `parecord` (pulseaudio-utils), `arecord` (alsa-utils), `pw-record` (pipewire) — detected automatically in that order
- **Python 3** — for running `faster-whisper` transcription

## Commands

| Command ID | Trigger | When |
|---|---|---|
| `claude-whisper.sendToClaudeCode` | `Ctrl+Shift+V` | Claude input focused |

## When clause (keybinding guard)

```
activeWebviewPanelId == 'claudeVSCodePanel' || (claude-vscode.sideBarActive && !editorFocus && !panelFocus)
```

Covers both the sidebar panel and the tab panel modes of Claude Code.

## Dev workflow

```bash
# Compile once (must use Node 20 explicitly — system node is too old for tsc)
/home/bogdan/.nvm/versions/node/v20.20.2/bin/node ./node_modules/.bin/tsc -p ./

# Launch dev host
# Press F5 in VS Code

# Restart extension host after changes (faster than F5)
# Ctrl+Shift+F5
```

## Notes

- Node 20 required (`nvm use 20` or `nvm alias default 20`)
- `drcika.apc-extension` and `cloudstudio.common` are disabled in the dev host to suppress unrelated errors
- `faster-whisper` is installed to `context.globalStorageUri/pypackages` — not in the repo
- The Whisper model is cached in `~/.cache/huggingface` (shared with other tools if any)
