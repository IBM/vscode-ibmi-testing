import { ExtensionContext, LogLevel, workspace } from "vscode";
import { IBMiTestManager } from "./manager";
import { getComponentRegistry, getInstance, loadBase } from "./api/ibmi";
import { Configuration, Section } from "./configuration";
import { Logger } from "./outputChannel";
import IBMi from "@halcyontech/vscode-ibmi-types/api/IBMi";
import { RPGUnitComponent } from "./rpgunit";

export let manager: IBMiTestManager | undefined;

export function activate(context: ExtensionContext) {
	console.log('Congratulations, your extension "vscode-ibmi-testing" is now active!');
	const installedVersion = context.extension.packageJSON.version;
	Logger.log(LogLevel.Info, `IBM i Testing (v${installedVersion}) extension activated!`);

	// Load Code4i API
	loadBase();
	const ibmi = getInstance();

	// Initialize configurations
	Configuration.initialize();
	workspace.onDidChangeConfiguration(async event => {
		if (event.affectsConfiguration(Configuration.group)) {
			Logger.log(LogLevel.Info, `Configuration change detected`);
			await Configuration.initialize();
		}
		if (event.affectsConfiguration(`${Configuration.group}.${Section.productLibrary}`)) {
			const connection = ibmi?.getConnection();
			const componentManager = connection?.getComponentManager();
			await componentManager?.getRemoteState(RPGUnitComponent.ID);
		}
	});

	// Register component
	const rpgUnitComponent = new RPGUnitComponent();
	const componentRegistry = getComponentRegistry();
	if (componentRegistry) {
		componentRegistry.registerComponent(context, rpgUnitComponent);
	}

	// Subscribe to IBM i connect and disconnect events
	let connection: IBMi | undefined;
	ibmi?.subscribe(context, 'connected', 'Load IBM i Test Manager', async () => {
		connection = ibmi!.getConnection();
		Logger.log(LogLevel.Info, `Connected to ${connection.currentUser}@${connection.currentHost}`);

		if (!manager) {
			manager = new IBMiTestManager(context);
		}
	});
	ibmi?.subscribe(context, 'disconnected', 'Dispose IBM i Test Manager', async () => {
		if (connection) {
			Logger.log(LogLevel.Info, `Disconnected from ${connection.currentUser}@${connection.currentHost}`);
		}

		if (manager) {
			manager.controller.dispose();
			manager = undefined;
		}

		// TODO: Handle disposing of tests mid execution
	});
}

export function deactivate() {
	Logger.log(LogLevel.Info, 'IBM i Testing extension deactivated!');
}
