import IBMi from "@halcyontech/vscode-ibmi-types/api/IBMi";
import { IBMiMember } from "@halcyontech/vscode-ibmi-types/api/types";
import * as fs from "fs/promises";
import path from "path";

export type Env = Record<string, string>;

export namespace ApiUtils {
    /**
     * Get IFS and QSYS test suffixes. IFS test suffixes are identical to QSYS ones,
     * but include `.TEST` along with the file extension.
     */
    export function getTestSuffixes(options: { rpg: boolean, cobol: boolean }): { ifs: string[], qsys: string[] } {
        const localSuffix = '.TEST';

        // Supported extensions
        const rpgleExt = `.RPGLE`;
        const sqlrpgleExt = `.SQLRPGLE`;
        const cobolExt = `.CBLLE`;
        const sqlcobolExt = `.SQLCBLLE`;

        const testSuffixes: { ifs: string[], qsys: string[] } = {
            ifs: [],
            qsys: []
        };

        if (options.rpg) {
            testSuffixes.qsys.push(rpgleExt, sqlrpgleExt);
        }

        if (options.cobol) {
            testSuffixes.qsys.push(cobolExt, sqlcobolExt);
        }

        testSuffixes.ifs.push(...testSuffixes.qsys.map(suffix => localSuffix + suffix));

        return testSuffixes;
    }

    /**
     * Reuse logic used in Source Orbit to convert a given file name to a 10 character system name.
     * 
     * Explanation:     https://ibm.github.io/sourceorbit/#/./pages/general/rules?id=long-file-names
     * Original Source: https://github.com/IBM/sourceorbit/blob/main/cli/src/utils.ts#L12
     */
    export function getSystemNameFromPath(inputName: string) {
        const isTest = inputName.toUpperCase().endsWith(`.TEST`);
        if (isTest) {
            // Remove the .TEST part
            inputName = inputName.substring(0, inputName.length - 5);
        }

        const baseName = inputName.includes(`-`) ? inputName.split(`-`)[0] : inputName;

        // Test -> If the name with test prefix T is of valid length, return it
        if (isTest && `T${baseName}`.length <= 10) {
            return `T${baseName}`.toUpperCase();
        }

        // Non-test -> If the name is of valid length, return it
        if (!isTest && baseName.length <= 10) {
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

        // If it is a test, we prefix it with T
        if (isTest) {
            systemName = `T${systemName}`;
        }

        // System name could exceed 10 characters (ie. if prefix is long, name is all uppercase, or because of T prefix) so substring one last time
        return systemName.substring(0, 10).toUpperCase();
    }

    /**
     * Retrieve the environment variables defined in a workspace folder's `.env` file. This implementation
     * is a modified version of the original source to include `&` as a prefix for each key.
     * 
     * Original Source: https://github.com/codefori/vscode-ibmi/blob/master/src/filesystems/local/env.ts#L20
     */
    export async function getEnvConfig(workspaceFolderPath: string) {
        const env: Env = {};
        const prefix = `&`;

        const envPath = path.join(workspaceFolderPath, `.env`);
        if (await envExists(envPath)) {
            const envContent = await fs.readFile(envPath, { encoding: 'utf8' });
            const envLines = envContent.replace(new RegExp(`\\\r`, `g`), ``).split(`\n`);

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
    async function envExists(envPath: string): Promise<boolean> {
        try {
            const stats = await fs.stat(envPath);
            return stats.isFile();
        } catch (err) {
            return false;
        }
    }

    export function isRPGLE(fsPath: string): boolean {
        const rpgleTestSuffixes = ApiUtils.getTestSuffixes({ rpg: true, cobol: false });
        return rpgleTestSuffixes.qsys.some(suffix => fsPath.toLocaleUpperCase().endsWith(suffix));
    }

    /**
     * Flatten compile parameters and convert to strings.
     */
    export function flattenCommandParams(commandParams: any): any {
        const flattenedCompileParams: any = { ...commandParams };
        for (const key of Object.keys(commandParams) as (keyof typeof commandParams)[]) {
            const value = commandParams[key];
            if (Array.isArray(value)) {
                flattenedCompileParams[key] = value.join(' ');
            } else if (typeof value === 'number') {
                flattenedCompileParams[key] = value.toString();
            }
        }

        return flattenedCompileParams;
    }

    export async function getMemberList(connection: IBMi, libraries: string[], sourceFiles: string[], extensions: string[]): Promise<IBMiMember[]> {
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

    export async function readMember(connection: IBMi, library: string, file: string, member: string): Promise<string> {
        const rFilePath = `${library}/${file}(${member})`;
        const result = await connection.sendCommand({ command: `/QOpenSys/usr/bin/Rfile -rQ "${rFilePath}"` });
        if (result.code === 0) {
            return result.stdout;
        } else {
            throw new Error('Failed to read member: ' + result.stderr);
        }
    }
}