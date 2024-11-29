import * as vscode from 'vscode';
import * as path from 'path';
import { TextDecoder, TextEncoder } from 'util';

export class EditorProvider implements vscode.CustomTextEditorProvider {
  constructor(private readonly context: vscode.ExtensionContext) { }

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        this.context.extensionUri,
        vscode.Uri.file(path.join(this.context.extensionPath, 'node_modules', 'monaco-editor'))
      ]
    };

    webviewPanel.webview.html = this._getHtmlForWebview(webviewPanel.webview);

    // 同步文件內容
    const updateWebview = () => {
      webviewPanel.webview.postMessage({
        type: 'update',
        content: document.getText()
      });
    };

    // 初始化內容
    updateWebview();

    // 監聽文件變更
    const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(e => {
      if (e.document.uri.toString() === document.uri.toString()) {
        updateWebview();
      }
    });

    // 清理訂閱
    webviewPanel.onDidDispose(() => {
      changeDocumentSubscription.dispose();
    });

    // 處理來自 webview 的訊息
    webviewPanel.webview.onDidReceiveMessage(async e => {
      switch (e.type) {
        case 'edit':
          await this.makeEdit(document, e.content);
          return;
      }
    });
  }

  private async makeEdit(document: vscode.TextDocument, content: string) {
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      document.uri,
      new vscode.Range(0, 0, document.lineCount, 0),
      content
    );
    await vscode.workspace.applyEdit(edit);
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    const monacoPath = vscode.Uri.file(
      path.join(this.context.extensionPath, 'node_modules', 'monaco-editor', 'min', 'vs')
    );
    const monacoUri = webview.asWebviewUri(monacoPath);
    const nonce = this.getNonce();

    return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource};">
                <title>Editor</title>
                <style>
                    body {
                        padding: 0;
                        margin: 0;
                    }
                    #editor {
                        width: 100%;
                        height: 100vh;
                    }
                </style>
            </head>
            <body>
                <div id="editor"></div>
                <script src="${monacoUri}/loader.js" nonce="${nonce}"></script>
                <script nonce="${nonce}">
                    const vscode = acquireVsCodeApi();
                    require.config({ paths: { vs: '${monacoUri}' }});
                    require(['vs/editor/editor.main'], function() {
                        const editor = monaco.editor.create(document.getElementById('editor'), {
                            value: '',
                            language: 'plaintext',
                            theme: 'vs-dark',
                            minimap: { enabled: false },
                            automaticLayout: true
                        });

                        // 監聽編輯器內容變更
                        editor.onDidChangeModelContent(() => {
                            vscode.postMessage({
                                type: 'edit',
                                content: editor.getValue()
                            });
                        });

                        // 監聽來自 extension 的訊息
                        window.addEventListener('message', e => {
                            switch (e.data.type) {
                                case 'update':
                                    editor.setValue(e.data.content);
                                    break;
                            }
                        });
                    });
                </script>
            </body>
            </html>`;
  }

  private getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }
} 