import { LogLevel, RelativePattern, Uri, workspace, WorkspaceFolder } from "vscode";
import { TestingConfig } from "./types";
import * as path from "path";
import lodash from "lodash";
import { Logger } from "./logger";

export namespace ConfigHandler {
    const TESTING_CONFIG_FILE = 'testing.json';
    const GLOBAL_CONFIG_DIRECTORY = '.vscode';

    export async function getLocalConfig(uri: Uri): Promise<TestingConfig | undefined> {
        const workspaceFolder = workspace.getWorkspaceFolder(uri);
        if (!workspaceFolder) {
            return;
        }

        try {
            const localConfigUri = await findTestingConfig(workspaceFolder, uri);
            const localConfig = localConfigUri ? await readLocalTestingConfig(localConfigUri) : undefined;
            if (localConfigUri && localConfig) {
                Logger.log(LogLevel.Info, `Found local testing configuration at ${localConfigUri.toString()}:\n${JSON.stringify(localConfig, null, 2)}`);
            } else {
                Logger.log(LogLevel.Info, `No local testing configuration found`);
            }

            const globalConfigUri = Uri.joinPath(workspaceFolder.uri, GLOBAL_CONFIG_DIRECTORY, TESTING_CONFIG_FILE);
            const globalConfig = await readLocalTestingConfig(globalConfigUri);
            if (globalConfigUri && globalConfig) {
                Logger.log(LogLevel.Info, `Found global testing configuration at ${globalConfigUri.toString()}:\n${JSON.stringify(globalConfig, null, 2)}`);
            } else {
                Logger.log(LogLevel.Info, `No global testing configuration found`);
            }

            const mergedConfig = lodash.merge({}, globalConfig, localConfig);
            Logger.log(LogLevel.Info, `Merged testing configuration:\n${JSON.stringify(mergedConfig, null, 2)}`);
            return mergedConfig;
        } catch (error: any) {
            Logger.logWithNotification(LogLevel.Error, `Failed to retrieve testing configuration`, error);
            return;
        }
    }

    async function findTestingConfig(workspaceFolder: WorkspaceFolder, uri: Uri): Promise<Uri | undefined> {
        const parentDirectory = path.parse(uri.fsPath).dir;
        if (parentDirectory.startsWith(workspaceFolder.uri.fsPath)) {
            const testingConfigUris = await workspace.findFiles(new RelativePattern(parentDirectory, TESTING_CONFIG_FILE));

            if (testingConfigUris.length > 0) {
                return testingConfigUris[0];
            } else {
                return findTestingConfig(workspaceFolder, Uri.parse(parentDirectory));
            }
        }
    };

    async function readLocalTestingConfig(testingConfigUri: Uri): Promise<TestingConfig | undefined> {
        try {
            // Check if file exists
            await workspace.fs.stat(testingConfigUri);
        } catch (error: any) {
            return;
        }

        try {
            // Read and parse file
            const content = await workspace.fs.readFile(testingConfigUri);
            return JSON.parse(content.toString()) as TestingConfig;
        } catch (error: any) {
            Logger.logWithNotification(LogLevel.Error, `Failed to read testing configuration`, `${testingConfigUri} - ${error}`);
            return;
        }
    }

    export async function getRemoteConfig(uri: Uri): Promise<TestingConfig | undefined> {
        // TODO: Implement this
        // LIB/VSCODE/TESTING.JSON file to configure RUCRT* command parameters, relative to member library.
        // Maybe we have TESTING.JSON member per source file
        return;
    }
}