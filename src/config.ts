import { RelativePattern, Uri, workspace, WorkspaceFolder } from "vscode";
import { TestingConfig } from "./types";
import * as path from "path";

export namespace ConfigHandler {
    const TESTING_CONFIG_FILE = 'testing.json';

    export async function getLocalConfig(uri: Uri): Promise<TestingConfig | undefined> {
        const workspaceFolder = workspace.getWorkspaceFolder(uri);
        if (!workspaceFolder) {
            return;
        }

        try {
            const testingConfigUri = await findTestingConfig(workspaceFolder, uri);
            if (testingConfigUri) {
                const content = await workspace.fs.readFile(testingConfigUri);
                return JSON.parse(content.toString()) as TestingConfig;
            }
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

    export async function getRemoteConfig(uri: Uri): Promise<TestingConfig | undefined> {
        // TODO: Implement this
        // LIB/VSCODE/TESTING.JSON file to configure RUCRT* command parameters, relative to member library.
        // Maybe we have TESTING.JSON member per source file
        return;
    }
}