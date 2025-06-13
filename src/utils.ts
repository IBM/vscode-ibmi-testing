import path from "path";
import { ConfigurationChangeEvent, WorkspaceFolder, workspace } from "vscode";
import { getInstance } from "./extensions/ibmi";
import { IBMiMember } from "@halcyontech/vscode-ibmi-types/api/types";

export type Env = Record<string, string>;

export namespace Utils {
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

    export async function getMemberList(libraries: string[], sourceFiles: string[], extensions: string[]): Promise<IBMiMember[]> {
        const ibmi = getInstance();
        const connection = ibmi!.getConnection();

        const statement =
            `WITH MEMBERS AS (
                        SELECT RTRIM(CAST(a.SYSTEM_TABLE_SCHEMA AS CHAR(10) FOR BIT DATA)) AS LIBRARY,
                            a.IASP_NUMBER AS ASP,
                            RTRIM(CAST(a.SYSTEM_TABLE_NAME AS CHAR(10) FOR BIT DATA)) AS SOURCE_FILE,
                            RTRIM(CAST(b.SYSTEM_TABLE_MEMBER AS CHAR(10) FOR BIT DATA)) AS NAME,
                            COALESCE(RTRIM(CAST(b.SOURCE_TYPE AS VARCHAR(10) FOR BIT DATA)), '') AS TYPE
                            FROM QSYS2.SYSTABLES AS a
                                JOIN QSYS2.SYSPARTITIONSTAT AS b
                                    ON (b.SYSTEM_TABLE_SCHEMA, b.SYSTEM_TABLE_NAME) = (a.SYSTEM_TABLE_SCHEMA, a.SYSTEM_TABLE_NAME)
                    )
                    SELECT *
                        FROM MEMBERS
                        WHERE LIBRARY IN (${libraries.map(library => `'${library}'`).join(`,`)})
                            AND SOURCE_FILE IN (${sourceFiles.map(sourceFile => `'${sourceFile}'`).join(`,`)})
                            AND TYPE IN (${extensions.map(extension => `'${extension}'`).join(`,`)})
                        ORDER BY NAME DESC`;

        const results = await connection.runSQL(statement);
        if (results.length) {
            return results.map(result => ({
                asp: connection.getIAspName(Number(result.ASP)),
                library: connection.sysNameInLocal(String(result.LIBRARY)),
                file: connection.sysNameInLocal(String(result.SOURCE_FILE)),
                name: connection.sysNameInLocal(String(result.NAME)),
                extension: connection.sysNameInLocal(String(result.TYPE)),
            } as IBMiMember));
        } else {
            return [];
        }
    }
}