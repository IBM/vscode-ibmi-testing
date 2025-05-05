import path from "path";
import { ConfigurationChangeEvent, WorkspaceFolder, workspace } from "vscode";
import { Env } from "./types";

export namespace Utils {
    /**
     * Get local and remote test suffixes. Local test suffixes are identical to remote ones,
     * but include `.TEST` along with the file extension.
     */
    export function getTestSuffixes(options: { rpg: boolean, cobol: boolean }): { local: string[], remote: string[] } {
        const localSuffix = '.TEST';

        // Supported extensions
        const rpgleExt = `.RPGLE`;
        const sqlrpgleExt = `.SQLRPGLE`;
        const cobolExt = `.CBLLE`;
        const sqlcobolExt = `.SQLCBLLE`;

        const testSuffixes: { local: string[], remote: string[] } = {
            local: [],
            remote: []
        };

        if (options.rpg) {
            testSuffixes.remote.push(rpgleExt, sqlrpgleExt);
        }

        if (options.cobol) {
            testSuffixes.remote.push(cobolExt, sqlcobolExt);
        }

        testSuffixes.local.push(...testSuffixes.remote.map(suffix => localSuffix + suffix));

        return testSuffixes;
    }

    /**
     * Reuse logic used in Source Orbit to convert a given file name to a 10 character system name.
     * 
     * Explanation:     https://ibm.github.io/sourceorbit/#/./pages/general/rules?id=long-file-names
     * Original Source: https://github.com/IBM/sourceorbit/blob/main/cli/src/utils.ts#L12
     */
    export function getSystemName(inputName: string) {
        let baseName = inputName.includes(`-`) ? inputName.split(`-`)[0] : inputName;

        // If the name is of valid length, return it
        if (baseName.length <= 10) {
            return baseName.toUpperCase();
        }

        // We also support prefixes to the name, such as UA_
        let prefix = ``;
        let name = baseName;

        if (baseName.includes(`_`)) {
            const parts = baseName.split(`_`);
            prefix = parts[0];
            name = parts[1];
        }

        // We start the system name with the suppliedPrefix
        let systemName = prefix;

        for (let i = 0; i < name.length && systemName.length < 10; i++) {
            const char = name[i];
            if (char === char.toUpperCase() || i === 0) {
                systemName += char;
            }
        }

        // If we only have one character, then no capitals were used in the name. Let's just use the first 10 characters
        if (systemName.length === 1) {
            systemName = name.substring(0, 10);
        }

        return systemName.toUpperCase();
    }

    /**
     * Retrieve the environment variables defined in a workspace folder's `.env` file. This implementation
     * is a modified version of the original source to include `&` as a prefix for each key.
     * 
     * Original Source: https://github.com/codefori/vscode-ibmi/blob/master/src/filesystems/local/env.ts#L20
     */
    export async function getEnvConfig(workspaceFolder: WorkspaceFolder) {
        const env: Env = {};
        const prefix = `&`;

        if (await envExists(workspaceFolder)) {
            const folderUri = workspaceFolder.uri;
            let readData, readStr;

            // Then we get the local .env file
            const envUri = folderUri.with({ path: path.join(folderUri.fsPath, `.env`) });
            readData = await workspace.fs.readFile(envUri);
            readStr = Buffer.from(readData).toString(`utf8`);

            const envLines = readStr.replace(new RegExp(`\\\r`, `g`), ``).split(`\n`);

            // Parse out the env lines
            envLines.forEach(line => {
                if (!line.startsWith(`#`)) {
                    const [key, value] = line.split(`=`);
                    if (key.length > 0 && value.length > 0) {
                        env[`${prefix}${key.trim()}`] = value.trim();
                    }
                }
            });
        }

        return env;
    }

    /**
     * Check if a `.env` file exists in a workspace folder.
     * 
     * Original Source: https://github.com/codefori/vscode-ibmi/blob/master/src/filesystems/local/env.ts#L8
     */
    async function envExists(workspaceFolder: WorkspaceFolder) {
        const folderUri = workspaceFolder.uri;
        const envUri = folderUri.with({ path: path.join(folderUri.fsPath, `.env`) });

        try {
            await workspace.fs.stat(envUri);
            return true;
        } catch (err) {
            return false;
        }
    }

    /**
     * Subscribe to Code for IBM i configuration changes.
     * 
     * Original Source: https://github.com/codefori/vscode-ibmi/blob/master/src/config/Configuration.ts#L5
     */
    export function onCodeForIBMiConfigurationChange<T>(props: string | string[], todo: (value: ConfigurationChangeEvent) => void) {
        const keys = (Array.isArray(props) ? props : Array.of(props)).map(key => `code-for-ibmi.${key}`);
        return workspace.onDidChangeConfiguration(async event => {
            if (keys.some(key => event.affectsConfiguration(key))) {
                todo(event);
            }
        });
    }
}