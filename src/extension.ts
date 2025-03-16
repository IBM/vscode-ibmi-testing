import { ExtensionContext, LogLevel, workspace } from "vscode";
import { IBMiTestManager } from "./manager";
import { getInstance, loadBase } from "./api/ibmi";
import { Configuration } from "./configuration";
import { Logger } from "./outputChannel";

export let manager: IBMiTestManager | undefined;

export function activate(context: ExtensionContext) {
	console.log('Congratulations, your extension "vscode-ibmi-testing" is now active!');
	Logger.getInstance().log(LogLevel.Info, 'IBM i Testing extension activated!');

	// Load Code4i API
	loadBase();

	// Initialize configurations
	Configuration.initialize();
	workspace.onDidChangeConfiguration(async event => {
		if (event.affectsConfiguration(Configuration.group)) {
			await Configuration.initialize();
		}
	});

	// Setup output channel
	Logger.getInstance();

	// Subscribe to IBM i connect and disconnect events
	const ibmi = getInstance();
	ibmi?.subscribe(context, 'connected', 'Load IBM i Test Manager', async () => {
		const connection = ibmi!.getConnection();
		Logger.getInstance().log(LogLevel.Info, `Connected to ${connection.currentUser}@${connection.currentHost}`);

		if (!manager) {
			manager = new IBMiTestManager(context);
		}
	});
	ibmi?.subscribe(context, 'disconnected', 'Dispose IBM i Test Manager', async () => {
		const connection = ibmi!.getConnection();
		Logger.getInstance().log(LogLevel.Info, `Disconnected from ${connection.currentUser}@${connection.currentHost}`);

		if (manager) {
			manager.controller.dispose();
			manager = undefined;
		}

		// TODO: Handle disposing of tests mid execution
	});
}

export function deactivate() {
	Logger.getInstance().log(LogLevel.Info, 'IBM i Testing extension deactivated!');
}
