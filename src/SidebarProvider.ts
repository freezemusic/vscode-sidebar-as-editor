import * as vscode from "vscode";
import * as path from "path";

export class SidebarProvider implements vscode.WebviewViewProvider {
    _view?: vscode.WebviewView;
    _doc?: vscode.TextDocument;
    private tabs: { uri: vscode.Uri, active: boolean }[] = [];

    constructor(private readonly _extensionUri: vscode.Uri) { }

    public resolveWebviewView(webviewView: vscode.WebviewView) {
        this._view = webviewView;
        console.log('SidebarProvider: resolveWebviewView called');

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                this._extensionUri,
                vscode.Uri.file(path.join(this._extensionUri.fsPath, 'node_modules', 'monaco-editor'))
            ]
        };
        console.log('Webview options set');

        webviewView.onDidChangeVisibility(() => {
            console.log('Webview visibility changed, visible:', webviewView.visible);
        });

        webviewView.webview.onDidReceiveMessage(async (data) => {
            console.log('Extension received message:', data);
            try {
                switch (data.type) {
                    case 'drop':
                        console.log('Extension processing drop:', data);
                        try {
                            const document = await vscode.workspace.openTextDocument(vscode.Uri.file(data.path));
                            console.log('Document opened successfully:', document.uri.fsPath);
                            await this.addTab(document);
                            console.log('Tab added successfully');
                        } catch (err) {
                            console.error('Error processing document:', err);
                        }
                        break;
                    case 'edit':
                        console.log('Edit event received');
                        break;
                    case 'switchTab':
                        console.log('Switch tab event received:', data);
                        break;
                    case 'closeTab':
                        console.log('Close tab event received:', data);
                        break;
                }
            } catch (error) {
                console.error('Error in message handler:', error);
            }
        });

        const html = this._getHtmlForWebview(webviewView);
        console.log('Generated HTML:', html.substring(0, 500));

        webviewView.webview.html = html;
        console.log('HTML set to webview');
    }

    private _getHtmlForWebview(webviewView: vscode.WebviewView) {
        const monacoPath = vscode.Uri.file(
            path.join(this._extensionUri.fsPath, 'node_modules', 'monaco-editor', 'min', 'vs')
        );
        const monacoUri = webviewView.webview.asWebviewUri(monacoPath);

        const csp = `
            default-src 'none';
            style-src 'unsafe-inline' ${webviewView.webview.cspSource};
            script-src 'unsafe-inline' ${webviewView.webview.cspSource} 'unsafe-eval' blob:;
            worker-src blob:;
            font-src ${webviewView.webview.cspSource};
            img-src ${webviewView.webview.cspSource};
            connect-src ${webviewView.webview.cspSource} blob: data:;
        `.replace(/\s+/g, ' ');

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="Content-Security-Policy" content="${csp}">
                <style>
                    body { padding: 0; margin: 0; }
                    #editor { width: 100%; height: calc(100vh - 35px); }
                    .tabs {
                        height: 35px;
                        display: flex;
                        background: var(--vscode-editor-background);
                        border-bottom: 1px solid var(--vscode-panel-border);
                        overflow-x: auto;
                    }
                    #dropzone {
                        display: none;
                        position: fixed;
                        top: 0;
                        left: 0;
                        width: 100vw;
                        height: 100vh;
                        background: rgba(0, 0, 0, 0.3);
                        align-items: center;
                        justify-content: center;
                        color: white;
                        z-index: 9999;
                    }
                    #dropzone.active { display: flex; }
                </style>
            </head>
            <body>
                <div class="tabs" id="tabs"></div>
                <div id="editor"></div>
                <div id="dropzone">Drop files here</div>

                <script src="${monacoUri}/loader.js"></script>
                <script>
                    (function() {
                        console.log('[Debug] Script starting...');
                        
                        try {
                            const vscode = acquireVsCodeApi();
                            console.log('[Debug] VS Code API acquired');
                            const editorContainer = document.getElementById('editor');
                            const dropzone = document.getElementById('dropzone');

                            // Monaco Editor 初始化
                            require.config({
                                paths: { vs: '${monacoUri}' }
                            });
                            
                            // 配置 Monaco 環境
                            window.MonacoEnvironment = {
                                getWorker: () => null
                            };

                            // 創建編輯器
                            require(['vs/editor/editor.main'], function() {
                                const editor = monaco.editor.create(editorContainer, {
                                    value: '',
                                    language: 'plaintext',
                                    theme: 'vs-dark',
                                    minimap: { enabled: false },
                                    automaticLayout: true,
                                    // 禁用需要 worker 的功能
                                    quickSuggestions: false,
                                    formatOnType: false,
                                    formatOnPaste: false,
                                    hover: { enabled: false },
                                    links: false,
                                    folding: false
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

                            // 拖放事件處理
                            document.addEventListener('dragover', (e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                console.log('[Debug] Dragover event');
                                dropzone.classList.add('active');
                            }, true);

                            document.addEventListener('dragleave', (e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                console.log('[Debug] Dragleave event');
                                if (!e.relatedTarget || !document.contains(e.relatedTarget)) {
                                    dropzone.classList.remove('active');
                                }
                            }, true);

                            document.addEventListener('drop', (e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                console.log('[Debug] Drop event triggered');
                                console.log('[Debug] DataTransfer types:', e.dataTransfer.types);
                                dropzone.classList.remove('active');

                                if (e.dataTransfer.types.includes('text/uri-list')) {
                                    const uriList = e.dataTransfer.getData('text/uri-list');
                                    console.log('[Debug] Dropped URI:', uriList);
                                    vscode.postMessage({
                                        type: 'drop',
                                        path: uriList
                                    });
                                } else {
                                    console.log('[Debug] No URI found in drop event');
                                }
                            }, true);

                            function updateTabs(tabs) {
                                const tabsContainer = document.getElementById('tabs');
                                tabsContainer.innerHTML = tabs.map(tab => \`
            < div class="tab \${tab.active ? 'active' : ''}"
        onclick = "switchTab('\${tab.path}')"
        title = "\${tab.path}" >
            <span>\${ tab.name } </span>
                < span class="tab-close" onclick = "event.stopPropagation(); closeTab('\${tab.path}')" >×</span>
                    </div>
                        \`).join('');
                            }

                            function switchTab(path) {
                                vscode.postMessage({ type: 'switchTab', path });
                            }

                            function closeTab(path) {
                                vscode.postMessage({ type: 'closeTab', path });
                            }

                        } catch (error) {
                            console.error('[Debug] Initialization error:', error);
                        }
                    })();
                </script>
            </body>
            </html>`;
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