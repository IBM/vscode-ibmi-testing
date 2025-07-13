import { LogLevel, RelativePattern, Uri, workspace, WorkspaceFolder } from "vscode";
import * as path from "path";
import lodash from "lodash";
import { getInstance } from "./extensions/ibmi";
import { TestingConfig } from "./cli/src/api/types";
import { testOutputLogger } from "./extension";

export class ConfigHandler {
    static TESTING_CONFIG_FILE = 'testing.json';
    static GLOBAL_CONFIG_DIRECTORY = '.vscode';

    async getLocalConfig(uri: Uri): Promise<TestingConfig | undefined> {
        const workspaceFolder = workspace.getWorkspaceFolder(uri);
        if (!workspaceFolder) {
            return;
        }

        try {
            const directoryConfigUri = await this.findLocalTestingConfig(workspaceFolder, uri);
            const directoryConfig = directoryConfigUri ? await this.readTestingConfig(directoryConfigUri, 'local') : undefined;
            if (directoryConfigUri && directoryConfig) {
                await testOutputLogger.log(LogLevel.Info, `Found directory testing configuration at ${directoryConfigUri.toString()}:\n${JSON.stringify(directoryConfig, null, 2)}`);
            }

            const globalConfigUri = Uri.joinPath(workspaceFolder.uri, ConfigHandler.GLOBAL_CONFIG_DIRECTORY, ConfigHandler.TESTING_CONFIG_FILE);
            const globalConfig = await this.readTestingConfig(globalConfigUri, 'local');
            if (globalConfig) {
                await testOutputLogger.log(LogLevel.Info, `Found global testing configuration at ${globalConfigUri.toString()}:\n${JSON.stringify(globalConfig, null, 2)}`);
            }

            const mergedConfig = lodash.merge({}, globalConfig, directoryConfig);
            await testOutputLogger.log(LogLevel.Info, `Merged testing configuration:\n${JSON.stringify(mergedConfig, null, 2)}`);
            return mergedConfig;
        } catch (error: any) {
            await testOutputLogger.appendWithNotification(LogLevel.Error, `Failed to retrieve testing configuration`, error);
            return;
        }
    }

    async getRemoteConfig(uri: Uri): Promise<TestingConfig | undefined> {
        const ibmi = getInstance();
        const connection = ibmi!.getConnection();

        try {
            const parsedPath = connection.parserMemberPath(uri.path);
            const sourceFileConfigPath = parsedPath.asp ?
                path.posix.join(parsedPath.asp, parsedPath.library, parsedPath.file, ConfigHandler.TESTING_CONFIG_FILE) :
                path.posix.join(parsedPath.library, parsedPath.file, ConfigHandler.TESTING_CONFIG_FILE);
            const sourceFileConfigUri = Uri.from({ scheme: 'member', path: `/${sourceFileConfigPath}` });
            const sourceFileConfig = await this.readTestingConfig(sourceFileConfigUri, 'remote');
            if (sourceFileConfig) {
                await testOutputLogger.log(LogLevel.Info, `Found source file testing configuration at ${sourceFileConfigUri.toString()}:\n${JSON.stringify(sourceFileConfig, null, 2)}`);
            }

            const globaConfigPath = parsedPath.asp ?
                path.posix.join(parsedPath.asp, parsedPath.library, 'VSCODE', ConfigHandler.TESTING_CONFIG_FILE) :
                path.posix.join(parsedPath.library, 'VSCODE', ConfigHandler.TESTING_CONFIG_FILE);
            const globalConfigUri = Uri.from({ scheme: 'member', path: `/${globaConfigPath}` });
            const globalConfig = await this.readTestingConfig(globalConfigUri, 'remote');
            if (globalConfig) {
                await testOutputLogger.log(LogLevel.Info, `Found global testing configuration at ${globalConfigUri.toString()}:\n${JSON.stringify(globalConfig, null, 2)}`);
            }

            const mergedConfig = lodash.merge({}, globalConfig, sourceFileConfig);
            await testOutputLogger.log(LogLevel.Info, `Merged testing configuration:\n${JSON.stringify(mergedConfig, null, 2)}`);
            return mergedConfig;
        } catch (error: any) {
            await testOutputLogger.appendWithNotification(LogLevel.Error, `Failed to retrieve testing configuration`, error);
            return;
        }
    }

    private async findLocalTestingConfig(workspaceFolder: WorkspaceFolder, uri: Uri): Promise<Uri | undefined> {
        const parentDirectory = path.parse(uri.fsPath).dir;
        if (parentDirectory.startsWith(workspaceFolder.uri.fsPath)) {
            const testingConfigUris = await workspace.findFiles(new RelativePattern(parentDirectory, ConfigHandler.TESTING_CONFIG_FILE));

            if (testingConfigUris.length > 0) {
                return testingConfigUris[0];
            } else {
                return this.findLocalTestingConfig(workspaceFolder, Uri.parse(parentDirectory));
            }
        }
    };

    private async readTestingConfig(testingConfigUri: Uri, type: 'local' | 'remote'): Promise<TestingConfig | undefined> {
        try {
            // Check if file exists
            await workspace.fs.stat(testingConfigUri);
        } catch (error: any) {
            await testOutputLogger.log(LogLevel.Info, `No ${type} testing configuration found at ${testingConfigUri.toString()}`);
            return;
        }

        try {
            // Read and parse file
            let testingConfig;
            if (type === 'local') {
                testingConfig = await workspace.fs.readFile(testingConfigUri);
            } else {
                const ibmi = getInstance();
                const connection = ibmi!.getConnection();
                const content = connection.getContent();

                const parsedPath = connection.parserMemberPath(testingConfigUri.path);
                testingConfig = await content.downloadMemberContent(parsedPath.library, parsedPath.file, parsedPath.name);
            }

            return JSON.parse(testingConfig.toString()) as TestingConfig;
        } catch (error: any) {
            testOutputLogger.appendWithNotification(LogLevel.Error, `Failed to read testing configuration`, `${testingConfigUri} - ${error}`);
            return;
        }
    }
}