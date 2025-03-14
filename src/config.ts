import { RelativePattern, Uri, workspace, WorkspaceFolder } from "vscode";
import { TestingConfig } from "./types";
import * as path from "path";
import lodash from "lodash";

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

            const globalConfigUri = Uri.joinPath(workspaceFolder.uri, GLOBAL_CONFIG_DIRECTORY, TESTING_CONFIG_FILE);
            const globalConfig = await readLocalTestingConfig(globalConfigUri);

            return lodash.merge({}, globalConfig, localConfig);
        } catch (error) {
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

    async function readLocalTestingConfig(testingConfigPath: Uri): Promise<TestingConfig | undefined> {
        try {
            const content = await workspace.fs.readFile(testingConfigPath);
            return JSON.parse(content.toString()) as TestingConfig;
        } catch (error) {
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