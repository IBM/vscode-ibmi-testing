import { IBMiMember } from "@halcyontech/vscode-ibmi-types/api/types";
import { getInstance } from "../extensions/ibmi";

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
        let baseName = inputName.includes(`-`) ? inputName.split(`-`)[0] : inputName;

        if (isTest) {
            // Remove the .TEST part
            baseName = baseName.substring(0, baseName.length - 5);
        }

        // If the name is of valid length, return it
        if (baseName.length <= 10 && !isTest) {
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

        if (isTest) {
            prefix = `T`;
            name = name.toUpperCase();
        }

        // We start the system name with the suppliedPrefix
        let systemName = prefix;

        for (let i = 0; i < name.length && systemName.length <= 10; i++) {
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

    export async function readMember(library: string, file: string, member: string): Promise<string> {
        const ibmi = getInstance();
        const connection = ibmi!.getConnection();

        const rFilePath = `${library}/${file}(${member})`;
        const result = await connection.sendCommand({ command: `/QOpenSys/usr/bin/Rfile -rQ "${rFilePath}"` });
        if (result.code === 0) {
            return result.stdout;
        } else {
            throw new Error('Failed to read member: ' + result.stderr);
        }
    }
}