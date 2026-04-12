import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
  const statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBar.text = '$(mic) Talk to Claude';
  statusBar.tooltip = 'Claude Listen active — Ctrl+Shift+V sends to Claude Code input';
  statusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  statusBar.command = 'claude-vscode.sidebar.open';
  statusBar.show();

  const disposable = vscode.commands.registerCommand(
    'claude-listen.sendToClaudeCode',
    async () => {
      // The `when` clause guarantees Claude's input is already focused.
      // Write to clipboard first so selectAll doesn't disrupt the sequence.
      await vscode.env.clipboard.writeText('Hello from claude-listen');
      await vscode.commands.executeCommand('editor.action.selectAll');
      await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
    }
  );

  context.subscriptions.push(statusBar, disposable);
}

export function deactivate() {}
