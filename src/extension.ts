import { ExtensionContext } from "vscode";
import { IBMiTestManager } from "./manager";
import { getInstance, loadBase } from "./api/ibmi";

export let manager: IBMiTestManager | undefined;

export function activate(context: ExtensionContext) {
	console.log('Congratulations, your extension "vscode-ibmi-testing" is now active!');

	loadBase();

	const ibmi = getInstance();
	ibmi?.subscribe(context, 'connected', 'Load IBM i Test Manager', async () => {
		if (!manager) {
			manager = new IBMiTestManager(context);
		}
	});
	ibmi?.subscribe(context, 'disconnected', 'Dispose IBM i Test Manager', async () => {
		if (manager) {
			manager.controller.dispose();
			manager = undefined;
		}

		// TODO: Handle disposing of tests mid execution
	});
}

export function deactivate() { }
