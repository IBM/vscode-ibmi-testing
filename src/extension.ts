import { commands, ConfigurationChangeEvent, ExtensionContext, LogLevel, TestRunRequest, Uri, window, workspace } from "vscode";
import { IBMiTestManager } from "./manager";
import { getComponentRegistry, getInstance, loadBase } from "./extensions/ibmi";
import { Configuration, Section } from "./configuration";
import IBMi from "@halcyontech/vscode-ibmi-types/api/IBMi";
import { RPGUnit } from "./components/rpgUnit";
import { CodeCov } from "./components/codeCov";
import * as tmp from "tmp";
import { TestOutputLogger } from "./loggers/testOutputLogger";
import { TestStubCodeActions } from "./codeActions/testStub";
import { IBMiTesting } from "./types";

export let testOutputLogger: TestOutputLogger = new TestOutputLogger();
export let manager: IBMiTestManager | undefined;
let userLibraryList: string[] | undefined;

export async function activate(context: ExtensionContext): Promise<IBMiTesting> {
	console.log('Congratulations, your extension "vscode-ibmi-testing" is now active!');
	const installedVersion = context.extension.packageJSON.version;
	await testOutputLogger.log(LogLevel.Info, `IBM i Testing (v${installedVersion}) extension activated!`);

	// Load Code4i API
	loadBase();
	const ibmi = getInstance();

	// Initialize configurations
	Configuration.initialize();
	workspace.onDidChangeConfiguration(async event => {
		if (event.affectsConfiguration(Configuration.group)) {
			await testOutputLogger.log(LogLevel.Info, `Configurations changed`);
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
	onCodeForIBMiConfigurationChange('connectionSettings', async () => {
		const connection = ibmi!.getConnection();
		if (connection) {
			const config = connection.getConfig();
			const newLibraryList = config.libraryList;

			if (newLibraryList !== userLibraryList) {
				await testOutputLogger.log(LogLevel.Info, `Library list changed: ${userLibraryList}`);
				userLibraryList = newLibraryList;

				if (manager) {
					await manager.refreshTests();
				}
			}
		}
	});

	// Register components
	const rpgUnit = new RPGUnit(installedVersion);
	const codeCov = new CodeCov();
	const componentRegistry = getComponentRegistry();
	componentRegistry?.registerComponent(context, rpgUnit);
	componentRegistry?.registerComponent(context, codeCov);

	// Subscribe to IBM i connect and disconnect events
	let connection: IBMi | undefined;
	ibmi!.subscribe(context, 'connected', 'Load IBM i Test Manager', async () => {
		connection = ibmi!.getConnection()!;
		await testOutputLogger.log(LogLevel.Debug, `Connected to ${connection.currentUser}@${connection.currentHost}`);

		if (!manager) {
			manager = new IBMiTestManager(context);
		}

		const config = connection.getConfig();
		userLibraryList = config.libraryList;
	});
	ibmi!.subscribe(context, 'disconnected', 'Dispose IBM i Test Manager', async () => {
		if (connection) {
			await testOutputLogger.log(LogLevel.Debug, `Disconnected from ${connection.currentUser}@${connection.currentHost}`);
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
	TestStubCodeActions.registerTestStubCodeActions(context);
	tmp.setGracefulCleanup();

	return {
		getTestManager: () => {
			return manager;
		}
	};
}

export async function deactivate() {
	await testOutputLogger.log(LogLevel.Info, 'IBM i Testing extension deactivated!');
}

/**
* Subscribe to Code for IBM i configuration changes.
* 
* Original Source: https://github.com/codefori/vscode-ibmi/blob/master/src/config/Configuration.ts#L5
*/
function onCodeForIBMiConfigurationChange<T>(props: string | string[], todo: (value: ConfigurationChangeEvent) => void) {
	const keys = (Array.isArray(props) ? props : Array.of(props)).map(key => `code-for-ibmi.${key}`);
	return workspace.onDidChangeConfiguration(async event => {
		if (keys.some(key => event.affectsConfiguration(key))) {
			todo(event);
		}
	});
}