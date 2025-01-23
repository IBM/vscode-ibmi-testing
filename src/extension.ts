import { ExtensionContext, workspace } from "vscode";
import { IBMiTestManager } from "./manager";
import { getInstance, loadBase } from "./api/ibmi";
import { Configurations } from "./configuration";

export let manager: IBMiTestManager | undefined;

export function activate(context: ExtensionContext) {
	console.log('Congratulations, your extension "vscode-ibmi-testing" is now active!');

	// Load Code4i API
	loadBase();

	// Initialize configurations
	Configurations.initialize();
	workspace.onDidChangeConfiguration(async event => {
		if (event.affectsConfiguration(Configurations.group)) {
			await Configurations.initialize();
		}
	});

	// Subscribe to IBM i connect and disconnect events
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
