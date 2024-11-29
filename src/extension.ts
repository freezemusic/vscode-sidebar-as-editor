import * as vscode from 'vscode';
import { SidebarProvider } from './SidebarProvider';
import { EditorProvider } from './EditorProvider';

export function activate(context: vscode.ExtensionContext) {
	console.log('Extension is now active!');

	// 註冊 Sidebar Provider
	const sidebarProvider = new SidebarProvider(context.extensionUri);
	console.log('Sidebar Provider created');

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			"sidebarEditor.editView",
			sidebarProvider
		)
	);
	console.log('Webview Provider registered');

	// 添加拖放命令
	context.subscriptions.push(
		vscode.commands.registerCommand('sidebarEditor.openFile', async (uri?: vscode.Uri) => {
			if (uri) {
				const document = await vscode.workspace.openTextDocument(uri);
				sidebarProvider.addTab(document);
			}
		})
	);

	// 註冊 Custom Editor Provider
	context.subscriptions.push(
		vscode.window.registerCustomEditorProvider(
			'sidebarEditor.editor',
			new EditorProvider(context),
			{
				webviewOptions: { retainContextWhenHidden: true },
				supportsMultipleEditorsPerDocument: true
			}
		)
	);
}

export function deactivate() { }
