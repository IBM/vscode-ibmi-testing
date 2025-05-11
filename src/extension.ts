import { ExtensionContext, LogLevel, workspace } from "vscode";
import { IBMiTestManager } from "./manager";
import { getComponentRegistry, getInstance, loadBase } from "./api/ibmi";
import { Configuration, Section } from "./configuration";
import { Logger } from "./logger";
import IBMi from "@halcyontech/vscode-ibmi-types/api/IBMi";
import { RPGUnit } from "./components/rpgUnit";
import { CodeCov } from "./components/codeCov";
import { Utils } from "./utils";
import * as tmp from "tmp";

export let manager: IBMiTestManager | undefined;
let userLibraryList: string[] | undefined;

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
			Logger.log(LogLevel.Info, `Configurations changed`);
			await Configuration.initialize();
		}

		if (event.affectsConfiguration(`${Configuration.group}.${Section.productLibrary}`)) {
			const connection = ibmi!.getConnection();
			const componentManager = connection?.getComponentManager();
			await componentManager?.getRemoteState(RPGUnit.ID);
		}

		if (event.affectsConfiguration(`${Configuration.group}.${Section.testSourceFiles}`)) {
			if (manager) {
				await manager.refreshTests();
			}
		}
	});
	Utils.onCodeForIBMiConfigurationChange('connectionSettings', async () => {
		const connection = ibmi!.getConnection();
		if (connection) {
			const config = connection.getConfig();
			const newLibraryList = config.libraryList;

			if (newLibraryList !== userLibraryList) {
				Logger.log(LogLevel.Info, `Library list changed: ${userLibraryList}`);
				userLibraryList = newLibraryList;

				if (manager) {
					await manager.refreshTests();
				}
			}
		}
	});

	// Register components
	const rpgUnit = new RPGUnit();
	const codeCov = new CodeCov();
	const componentRegistry = getComponentRegistry();
	componentRegistry?.registerComponent(context, rpgUnit);
	componentRegistry?.registerComponent(context, codeCov);

	// Subscribe to IBM i connect and disconnect events
	let connection: IBMi | undefined;
	ibmi!.subscribe(context, 'connected', 'Load IBM i Test Manager', async () => {
		connection = ibmi!.getConnection();
		Logger.log(LogLevel.Debug, `Connected to ${connection.currentUser}@${connection.currentHost}`);

		if (!manager) {
			manager = new IBMiTestManager(context);
		}

		const config = connection.getConfig();
		userLibraryList = config.libraryList;
	});
	ibmi!.subscribe(context, 'disconnected', 'Dispose IBM i Test Manager', async () => {
		if (connection) {
			Logger.log(LogLevel.Debug, `Disconnected from ${connection.currentUser}@${connection.currentHost}`);
		}

		// Clean up test manager
		if (manager) {
			manager.controller.dispose();
			manager = undefined;
		}

		// Clean up cache
		userLibraryList = undefined;

		// TODO: Handle disposing of tests mid execution
	});

	// Miscellaneous setup
	tmp.setGracefulCleanup();
}

export function deactivate() {
	Logger.log(LogLevel.Info, 'IBM i Testing extension deactivated!');
}
