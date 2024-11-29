import * as vscode from "vscode";
import * as path from "path";

export class SidebarProvider implements vscode.WebviewViewProvider {
    _view?: vscode.WebviewView;
    _doc?: vscode.TextDocument;
    private tabs: { uri: vscode.Uri, active: boolean }[] = [];

    constructor(private readonly _extensionUri: vscode.Uri) { }

    public resolveWebviewView(webviewView: vscode.WebviewView) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                this._extensionUri,
                vscode.Uri.file(path.join(this._extensionUri.fsPath, 'node_modules', 'monaco-editor'))
            ]
        };

        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor && this._view && this.tabs.find(tab => tab.uri.fsPath === editor.document.uri.fsPath)) {
                this.tabs.forEach(tab => {
                    tab.active = tab.uri.fsPath === editor.document.uri.fsPath;
                });
                this._doc = editor.document;
                this.updateEditor(editor.document);
            }
        });

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async (data) => {
            console.log('Received message:', data);
            switch (data.type) {
                case 'edit':
                    if (this._doc) {
                        const edit = new vscode.WorkspaceEdit();
                        edit.replace(
                            this._doc.uri,
                            new vscode.Range(0, 0, this._doc.lineCount, 0),
                            data.content
                        );
                        await vscode.workspace.applyEdit(edit);
                    }
                    break;
                case 'drop':
                    console.log('Processing drop:', data.path);
                    try {
                        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(data.path));
                        this._doc = document;
                        if (!this.tabs.find(tab => tab.uri.fsPath === document.uri.fsPath)) {
                            this.tabs.forEach(tab => tab.active = false);
                            this.tabs.push({ uri: document.uri, active: true });
                        }
                        this.updateEditor(document);
                    } catch (err) {
                        console.error('Error processing drop:', err);
                    }
                    break;
                case 'switchTab':
                    const tab = this.tabs.find(t => t.uri.fsPath === data.path);
                    if (tab) {
                        this.tabs.forEach(t => t.active = t.uri.fsPath === data.path);
                        const doc = await vscode.workspace.openTextDocument(tab.uri);
                        this._doc = doc;
                        this.updateEditor(doc);
                    }
                    break;
                case 'closeTab':
                    const index = this.tabs.findIndex(t => t.uri.fsPath === data.path);
                    if (index !== -1) {
                        this.tabs.splice(index, 1);
                        if (this.tabs.length > 0) {
                            const newActive = this.tabs[Math.min(index, this.tabs.length - 1)];
                            newActive.active = true;
                            const doc = await vscode.workspace.openTextDocument(newActive.uri);
                            this._doc = doc;
                            this.updateEditor(doc);
                        } else {
                            this._doc = undefined;
                            this.updateEditor();
                        }
                    }
                    break;
            }
        });
    }

    private async updateEditor(document?: vscode.TextDocument) {
        if (!this._view) return;

        const content = document ? document.getText() : '';
        const language = document ? this.getLanguageFromPath(document.fileName) : 'plaintext';

        this._view.webview.postMessage({
            type: 'update',
            content: content,
            language: language,
            tabs: this.tabs.map(tab => ({
                path: tab.uri.fsPath,
                name: path.basename(tab.uri.fsPath),
                active: tab.active
            }))
        });
    }

    private getLanguageFromPath(path: string): string {
        const ext = path.split('.').pop()?.toLowerCase();
        const languageMap: { [key: string]: string } = {
            'js': 'javascript',
            'ts': 'typescript',
            'py': 'python',
            'html': 'html',
            'css': 'css',
            'json': 'json'
        };
        return languageMap[ext || ''] || 'plaintext';
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const monacoPath = vscode.Uri.file(
            path.join(this._extensionUri.fsPath, 'node_modules', 'monaco-editor', 'min', 'vs')
        );
        const monacoUri = webview.asWebviewUri(monacoPath);

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' ${webview.cspSource}; script-src 'unsafe-inline' ${webview.cspSource}; font-src ${webview.cspSource};">
                <style>
                    body {
                        padding: 0;
                        margin: 0;
                    }
                    #editor {
                        width: 100%;
                        height: calc(100vh - 35px);
                    }
                    .tabs {
                        height: 35px;
                        display: flex;
                        background: var(--vscode-editor-background);
                        border-bottom: 1px solid var(--vscode-panel-border);
                        overflow-x: auto;
                    }
                    .dropzone {
                        display: none;
                        position: absolute;
                        top: 0;
                        left: 0;
                        width: 100%;
                        height: 100%;
                        background: rgba(0, 0, 0, 0.5);
                        align-items: center;
                        justify-content: center;
                        color: white;
                    }
                    .dropzone.active {
                        display: flex;
                    }
                </style>
            </head>
            <body>
                <div class="tabs" id="tabs"></div>
                <div id="editor"></div>
                <div id="dropzone" class="dropzone">Drop file here</div>
                <script>
                    const vscode = acquireVsCodeApi();
                    const editorContainer = document.getElementById('editor');
                    const dropzone = document.getElementById('dropzone');

                    // 載入 Monaco Editor
                    const loadMonaco = () => {
                        const script = document.createElement('script');
                        script.src = "${monacoUri}/loader.js";
                        script.onload = () => {
                            require.config({ paths: { vs: '${monacoUri}' }});
                            require(['vs/editor/editor.main'], () => {
                                const editor = monaco.editor.create(editorContainer, {
                                    value: '',
                                    language: 'plaintext',
                                    theme: 'vs-dark',
                                    minimap: { enabled: false },
                                    automaticLayout: true,
                                    scrollBeyondLastLine: false,
                                    fontSize: 13,
                                    lineNumbers: 'on',
                                    wordWrap: 'on'
                                });

                                editor.onDidChangeModelContent(() => {
                                    vscode.postMessage({
                                        type: 'edit',
                                        content: editor.getValue()
                                    });
                                });

                                window.addEventListener('message', e => {
                                    const message = e.data;
                                    switch (message.type) {
                                        case 'update':
                                            editor.setValue(message.content || '');
                                            monaco.editor.setModelLanguage(
                                                editor.getModel(),
                                                message.language || 'plaintext'
                                            );
                                            if (message.tabs) {
                                                updateTabs(message.tabs);
                                            }
                                            break;
                                    }
                                });
                            });
                        };
                        document.body.appendChild(script);
                    };

                    // 立即載入 Monaco Editor
                    loadMonaco();

                    function updateTabs(tabs) {
                        const tabsContainer = document.getElementById('tabs');
                        tabsContainer.innerHTML = tabs.map(tab => \`
                            <div class="tab \${tab.active ? 'active' : ''}"
                                 onclick="switchTab('\${tab.path}')"
                                 title="\${tab.path}">
                                <span>\${tab.name}</span>
                                <span class="tab-close" onclick="event.stopPropagation(); closeTab('\${tab.path}')">×</span>
                            </div>
                        \`).join('');
                    }

                    function switchTab(path) {
                        vscode.postMessage({ type: 'switchTab', path });
                    }

                    function closeTab(path) {
                        vscode.postMessage({ type: 'closeTab', path });
                    }
                </script>
            </body>
            </html>`;
    }

    public async addTab(document: vscode.TextDocument) {
        if (!this.tabs.find(tab => tab.uri.fsPath === document.uri.fsPath)) {
            this.tabs.forEach(tab => tab.active = false);
            this.tabs.push({ uri: document.uri, active: true });
            this._doc = document;
            this.updateEditor(document);
        }
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}