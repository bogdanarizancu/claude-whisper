import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
  console.log('claude-listen is now active');

  const disposable = vscode.commands.registerCommand('claude-listen.helloWorld', () => {
    vscode.window.showInformationMessage('Hello from Claude Listen!');
  });

  context.subscriptions.push(disposable);
}

export function deactivate() {}
