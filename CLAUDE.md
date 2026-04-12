# claude-listen

VSCode extension that intercepts keyboard shortcuts and interacts with the Claude Code panel.

## What it does

Listens for `Ctrl+Shift+V` (Mac: `Cmd+Shift+V`) **only when the Claude Code input box is focused**, then:
1. Writes a message to the clipboard
2. Selects all existing text in the input
3. Pastes, replacing whatever was there

## Key files

- [src/extension.ts](src/extension.ts) — command logic
- [package.json](package.json) — command + keybinding declarations
- [.vscode/launch.json](.vscode/launch.json) — dev host config (F5)
- [.vscode/tasks.json](.vscode/tasks.json) — background tsc watch task

## Commands

| Command ID | Trigger | When |
|---|---|---|
| `claude-listen.sendToClaudeCode` | `Ctrl+Shift+V` | Claude input focused |

## When clause (keybinding guard)

```
activeWebviewPanelId == 'claudeVSCodePanel' || (claude-vscode.sideBarActive && !editorFocus && !panelFocus)
```

Covers both the sidebar panel and the tab panel modes of Claude Code.

## Claude Code command IDs (discovered from its manifest)

| Command | Purpose |
|---|---|
| `claude-vscode.sidebar.open` | Open sidebar panel |
| `claude-vscode.newConversation` | Clear and start new chat |
| `claude-vscode.focus` | Focus input (also opens new window if not already open — avoid) |

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
- `editor.action.selectAll` must run *after* clipboard is written or it can shift focus
- `drcika.apc-extension` and `cloudstudio.common` are disabled in the dev host to suppress unrelated errors
