import { ExtensionContext } from "vscode";
import { IBMiTestManager } from "./manager";

export function activate(context: ExtensionContext) {
	console.log('Congratulations, your extension "vscode-ibmi-testing" is now active!');

	const manager = new IBMiTestManager(context);
}

export function deactivate() { }
