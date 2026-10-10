import { Uri, window, workspace } from "vscode";
import * as path from "path";
import { ApiUtils } from "../../../api/apiUtils";
import { LocalConfigHandler, QsysConfigHandler } from "../../../api/config";
import { Configuration, Section, TestStubPreferences } from "../../configuration";
import { testOutputLogger } from "../../extension";
import IBMi from "@halcyontech/vscode-ibmi-types/api/IBMi";

export type RoutineType = `FUNCTION` | `PROCEDURE`;
export type FunctionType = `SCALAR` | `COLUMN` | `TABLE`;

export interface SysRoutineRow {
    SPECIFIC_NAME: string;
    ROUTINE_CREATED: string;
}
export interface RoutineSignature {
    parms: SysParmRow[];
    returns: SysParmRow[];
}

export interface SysParmRow {
    PARAMETER_NAME: string | null;
    PARAMETER_MODE: `IN` | `OUT` | `INOUT`;
    DATA_TYPE: string;
    NUMERIC_PRECISION: number | null;
    NUMERIC_SCALE: number | null;
    CHARACTER_MAXIMUM_LENGTH: number | null;
    ROW_TYPE: `P` | `R` | `C`;
}

export interface RpgVarDetail {
    dataType: string; // RPG dcl-s type keyword, e.g. `int(10)`, `packed(9:2)`, `char(6)`, `varchar(12)
    defaultValue: string; // Default value literal for initialisation
    assertion: `iEqual` | `nEqual` | `aEqual` | `assertEqual`;
    isSupported: boolean;
}

export interface SqlTestCaseSpec {
    dataStructure: { name: string; text: string[] } | undefined;
    testCase: { name: string; text: string[] };
}

export namespace SqlTestStubGenerator {
    export async function generateTestStubLocation(uri: Uri, name: string, connection?: IBMi, forcePreferences?: Partial<TestStubPreferences>) {
        // Get test stub generation preferences
        const testStubPreferences = {
            ...Configuration.getOrFallback<TestStubPreferences>(Section.testStubPreferences),
            ...forcePreferences
        };

        // Build test file name, parent name (directory or source file) and URI
        const safeName = name.replace(/[^a-zA-Z0-9_]/g, '_');
        let testFileName: string;
        let testFileParentName: string;
        let testFileUri: Uri;
        if (uri.scheme === 'file') {
            const workspaceFolder = workspace.getWorkspaceFolder(uri);
            if (workspaceFolder) {
                testFileName = `${safeName.toLocaleLowerCase()}.test.sqlrpgle`;
                testFileParentName = testStubPreferences["Test Source Directory"];

                if (testStubPreferences["Prompt For Test Name"]) {
                    const userInput = await promptUserForTestName(testFileParentName, testFileName, true);
                    if (userInput) {
                        testFileParentName = userInput.testFileParentName;
                        testFileName = userInput.testFileName;
                    } else {
                        return;
                    }
                }

                const testFilePath = path.posix.join(workspaceFolder.uri.fsPath, testFileParentName, testFileName);
                testFileUri = Uri.file(testFilePath);
            } else {
                window.showErrorMessage(`No workspace folder found for the document.`);
                return;
            }
        } else if (uri.scheme === 'member' && connection) {
            const parsedPath = connection.parserMemberPath(uri.path);
            testFileName = `${ApiUtils.getSystemNameFromPath(`${safeName}.test`)}.SQLRPGLE`;
            testFileParentName = testStubPreferences["Test Source File"];

            if (testStubPreferences["Prompt For Test Name"]) {
                const userInput = await promptUserForTestName(testFileParentName, testFileName, false);
                if (userInput) {
                    testFileParentName = userInput.testFileParentName;
                    testFileName = userInput.testFileName;
                } else {
                    return;
                }
            }

            const testFilePath = parsedPath.asp ?
                path.posix.join(parsedPath.asp, parsedPath.library, testFileParentName, testFileName) :
                path.posix.join(parsedPath.library, testFileParentName, testFileName);
            testFileUri = Uri.from({ scheme: 'member', path: `/${testFilePath}` });
        } else {
            window.showErrorMessage(`Unsupported file type: ${uri.scheme}`);
            return;
        }

        return { testFileName, testFileParentName, testFileUri };
    }

    export async function generateTestConfig(uri: Uri, testFileUri: Uri, connection?: IBMi): Promise<{ uri: Uri; content: string } | undefined> {
        const defaultTestConfig = {
            "rpgunit": {
                "rucrtrpg": {
                    "tgtCcsid": "*JOB",
                    "dbgView": "*SOURCE",
                    "rpgPpOpt": "*LVL2",
                    "cOption": [
                        "*EVENTF"
                    ]
                },
                "rucalltst": {
                    "order": "*API",
                    "libl": "*CURRENT",
                    "jobD": "*DFT",
                    "detail": "*BASIC",
                    "output": "*ALLWAYS",
                    "rclRsc": "*NO",
                    "onFailure": "*ABORT"
                }
            },
            "codecov": {
                "module": []
            }
        };

        if (uri.scheme === 'file') {
            const workspaceFolder = workspace.getWorkspaceFolder(uri);
            if (!workspaceFolder) {
                return;
            }

            const configHandler = new LocalConfigHandler(testOutputLogger, workspaceFolder.uri.fsPath, testFileUri.fsPath);
            const existingConfig = await configHandler.getConfig();
            if (existingConfig) {
                return;
            }

            const configPath = path.join(testFileUri.fsPath, '..', 'testing.json');

            return {
                uri: Uri.file(configPath),
                content: JSON.stringify(defaultTestConfig, null, 4)
            };
        } else if (uri.scheme === 'member' && connection) {
            const configHandler = new QsysConfigHandler(connection as any, testOutputLogger, testFileUri.path);
            const existingConfig = await configHandler.getConfig();
            if (existingConfig) {
                return;
            }

            const parsedTestPath = connection.parserMemberPath(testFileUri.path);
            const configPath = parsedTestPath.asp ?
                path.posix.join(parsedTestPath.asp, parsedTestPath.library, parsedTestPath.file, 'testing.json') :
                path.posix.join(parsedTestPath.library, parsedTestPath.file, 'testing.json');

            return {
                uri: Uri.from({ scheme: 'member', path: `/${configPath}` }),
                content: JSON.stringify(defaultTestConfig, null, 4)
            };
        }
    }

    async function promptUserForTestName(testFileParentName: string, testFileName: string, isLocal: boolean): Promise<{ testFileParentName: string; testFileName: string } | undefined> {
        const errorMessage = isLocal ?
            'Invalid format. Valid example: qtestsrc/example.test.sqlrpgle' :
            'Invalid format. Valid example: QTESTSRC/EXAMPLET.SQLRPGLE';
        const testName = await window.showInputBox({
            prompt: 'Enter test name',
            placeHolder: 'Test name',
            value: `${testFileParentName}/${testFileName}`,
            validateInput: (value) => {
                if (!/^[^\s\/]+\/[^\s\/]+\.[^\s\/\.]+$/.test(value)) {
                    return errorMessage;
                }
                return null;
            }
        });
        if (!testName) {
            return;
        }

        // Update test file name and parent name based on user input
        const testNameParts = testName.split('/');
        if (testNameParts.length === 2) {
            testFileParentName = testNameParts[0];
            testFileName = testNameParts[1];
        } else {
            window.showErrorMessage(errorMessage);
            return;
        }

        return {
            testFileParentName,
            testFileName
        };
    }

    /**
     * Query QSYS2.SYSROUTINES to confirm the routine exists.
     * https://www.ibm.com/docs/en/i/7.6.0?topic=views-sysroutines
     */
    export async function getRoutineRows(connection: IBMi, schema: string, name: string, type: RoutineType): Promise<SysRoutineRow[]> {
        try {
            const rows = await connection.runSQL(
                `SELECT
                    SPECIFIC_NAME,
                    ROUTINE_CREATED
                FROM
                    QSYS2.SYSROUTINES
                WHERE
                    ROUTINE_SCHEMA = '${schema}' AND
                    ROUTINE_NAME = '${name}' AND
                    ROUTINE_TYPE = '${type}'`
            );
            return (rows ?? []) as unknown as SysRoutineRow[];
        } catch (error: any) {
            throw new Error(`Failed to query QSYS2.SYSROUTINES for ${schema}.${name}: ${error?.message ?? error}`);
        }
    }

    /**
     * Query QSYS2.SYSFUNCS for function type.
     * https://www.ibm.com/docs/en/i/7.6.0?topic=views-sysfuncs
     */
    export async function getFunctionType(connection: IBMi, schema: string, specificName: string): Promise<FunctionType | undefined> {
        try {
            const rows = await connection.runSQL(
                `SELECT 
                    FUNCTION_TYPE 
                FROM 
                    QSYS2.SYSFUNCS 
                WHERE
                    SPECIFIC_SCHEMA = '${schema}' AND 
                    SPECIFIC_NAME = '${specificName}'`
            );

            const ft = String(rows?.[0]?.FUNCTION_TYPE ?? ``).trim();
            switch (ft) {
                case `S`: return `SCALAR`;
                case `C`: return `COLUMN`;
                case `T`: return `TABLE`;
                default: return;
            }
        } catch (error: any) {
            throw new Error(`Failed to query QSYS2.SYSFUNCS for ${schema}.${specificName}: ${error?.message ?? error}`);
        }
    }

    /**
     * Query QSYS2.SYSPARMS for parameter and returns.
     * https://www.ibm.com/docs/en/i/7.6.0?topic=views-sysparms
     */
    export async function getSignaturesFor(connection: IBMi, schema: string, specificName: string): Promise<RoutineSignature> {
        try {
            const rows = await connection.runSQL(
                `SELECT 
                    PARAMETER_NAME, 
                    PARAMETER_MODE, 
                    DATA_TYPE, 
                    NUMERIC_PRECISION, 
                    NUMERIC_SCALE, 
                    CHARACTER_MAXIMUM_LENGTH, 
                    ROW_TYPE 
                FROM 
                    QSYS2.SYSPARMS 
                WHERE 
                    SPECIFIC_SCHEMA = '${schema}' AND 
                    SPECIFIC_NAME = '${specificName}' 
                ORDER BY ORDINAL_POSITION`
            ) as unknown as SysParmRow[];

            return {
                parms: (rows ?? []).filter(r => r.ROW_TYPE === `P`),
                returns: (rows ?? []).filter(r => r.ROW_TYPE === `R` || r.ROW_TYPE === `C`)
            };
        } catch (error: any) {
            throw new Error(`Failed to query QSYS2.SYSPARMS for ${schema}.${specificName}: ${error?.message ?? error}`);
        }
    }

    export function generateTestCaseSpec(schema: string, name: string, routineType: RoutineType, routineSignature: RoutineSignature, functionType?: FunctionType, addStubComments?: boolean): SqlTestCaseSpec {
        const safeName = name.replace(/[^a-zA-Z0-9_]/g, '_').toLocaleLowerCase();

        let dataStructure: { name: string; text: string[] } | undefined;
        let text: string[] = [];
        if (routineType === `FUNCTION` && functionType === `SCALAR`) {
            text = buildScalarFunctionStub(schema, name, safeName, routineSignature, addStubComments);
        } else if (routineType === `FUNCTION` && functionType === `TABLE`) {
            const result = buildTableFunctionStub(schema, name, safeName, routineSignature, addStubComments);
            dataStructure = result.dataStructure;
            text = result.text;
        } else if (routineType === `PROCEDURE`) {
            text = buildProcedureStub(schema, name, safeName, routineSignature, addStubComments);
        }

        return {
            dataStructure,
            testCase: { name: name, text }
        };
    }

    function buildScalarFunctionStub(schema: string, name: string, safeName: string, routineSignature: RoutineSignature, addStubComments?: boolean): string[] {
        const qualifiedName = `${schema}.${name}`;

        // Return
        const returnRow = routineSignature.returns.find(r => r.ROW_TYPE === `C`);
        const returnDetail = returnRow ? sqlDataTypeToRpgDetail(returnRow) : undefined;

        // Parameter declartions
        const paramDecls = routineSignature.parms.map((p, i) => {
            const varName = toRpgVarName(p.PARAMETER_NAME, i, `param`);
            const detail = sqlDataTypeToRpgDetail(p);
            return `  dcl-s ${varName} ${detail.dataType};`;
        });

        // Parameter initializations
        const paramInits = routineSignature.parms.map((p, i) => {
            const varName = toRpgVarName(p.PARAMETER_NAME, i, `param`);
            const detail = sqlDataTypeToRpgDetail(p);
            return `  ${varName} = ${detail.defaultValue};`;
        });

        // Parameter host variables for embedded SQL
        const paramHostVars = routineSignature.parms.map((p, i) => {
            return `:${toRpgVarName(p.PARAMETER_NAME, i, `param`)}`;
        }).join(`, `);

        return [
            `dcl-proc test_${safeName} export;`,
            `  dcl-pi *n extproc(*dclcase) end-pi;`,
            ``,
            ...paramDecls,
            ...(returnDetail ?
                [
                    `  dcl-s actual ${returnDetail.dataType};`,
                    `  dcl-s expected  ${returnDetail.dataType};`
                ] : []),
            ``,
            ...(addStubComments ? [`  // Input`] : []),
            ...paramInits,
            ``,
            ...(addStubComments ? [`  // Actual results`] : []),
            `  exec sql`,
            `    SET :actual = ${qualifiedName}(${paramHostVars});`,
            ``,
            `  if (SQLCODE <> 0);`,
            `    fail('Failed to fetch using ${qualifiedName}. SQLCODE: ' + %char(SQLCODE));`,
            `  endif;`,
            ``,
            ...(returnDetail ?
                [
                    ...(addStubComments ? [`  // Expected results`] : []),
                    `  expected = ${returnDetail.defaultValue};`,
                    ``,
                    ...(addStubComments ? [`  // Assertions`] : []),
                    `  ${buildAssertion(returnDetail.assertion, `expected`, `actual`, `actual`)}`
                ] : []),
            `end-proc;`
        ];
    }

    function buildTableFunctionStub(schema: string, name: string, safeName: string, routineSignature: RoutineSignature, addStubComments?: boolean): { dataStructure: { name: string; text: string[] }; text: string[] } {
        const qualifiedName = `${schema}.${name}`;

        // Row data structure fields
        const rowDsFields = routineSignature.returns.map((col, i) => {
            const colName = toRpgVarName(col.PARAMETER_NAME, i, `col`);
            const detail = sqlDataTypeToRpgDetail(col);
            return `  ${colName} ${detail.dataType};`;
        });

        // Parameter declarations
        const paramDecls = routineSignature.parms.map((p, i) => {
            const varName = toRpgVarName(p.PARAMETER_NAME, i, `param`);
            const detail = sqlDataTypeToRpgDetail(p);
            return `  dcl-s ${varName} ${detail.dataType};`;
        });

        // Parameter initializations
        const paramInits = routineSignature.parms.map((p, i) => {
            const varName = toRpgVarName(p.PARAMETER_NAME, i, `param`);
            const detail = sqlDataTypeToRpgDetail(p);
            return `  ${varName} = ${detail.defaultValue};`;
        });

        // Expected initializations
        const expectedInits = routineSignature.returns.map((col, i) => {
            const colName = toRpgVarName(col.PARAMETER_NAME, i, `col`);
            const detail = sqlDataTypeToRpgDetail(col);
            return `  expected(1).${colName} = ${detail.defaultValue};`;
        });

        // Select columns for embedded SQL
        const selectCols = routineSignature.returns.map(col => {
            return col.PARAMETER_NAME?.toLocaleUpperCase() ?? col.PARAMETER_NAME;
        }).join(`, `);

        // Parameter host variables for embedded SQL
        const paramHostVars = routineSignature.parms.map((p, i) => {
            return `:${toRpgVarName(p.PARAMETER_NAME, i, `param`)}`;
        }).join(`, `);

        // Assertions
        const assertions = routineSignature.returns.map((col, i) => {
            const colName = toRpgVarName(col.PARAMETER_NAME, i, `col`);
            const detail = sqlDataTypeToRpgDetail(col);
            const exp = `expected(1).${colName}`;
            const act = `actual(1).${colName}`;
            return `  ${buildAssertion(detail.assertion, exp, act, act)}`;
        });

        return {
            dataStructure: {
                name: `row_t`,
                text: [
                    `dcl-ds row_t qualified template;`,
                    ...rowDsFields,
                    `end-ds;`
                ]
            },
            text: [
                `dcl-proc test_${safeName} export;`,
                `  dcl-pi *n extproc(*dclcase) end-pi;`,
                ``,
                ...paramDecls,
                `  dcl-ds actual    likeds(row_t) dim(1) inz(*likeds);`,
                `  dcl-ds expected  likeds(row_t) dim(1) inz(*likeds);`,
                ``,
                ...(addStubComments ? [`  // Input`] : []),
                ...paramInits,
                ``,
                ...(addStubComments ? [`  // Actual results`] : []),
                `  exec sql`,
                `    DECLARE C1 CURSOR FOR`,
                `      SELECT ${selectCols}`,
                `        FROM TABLE(${qualifiedName}(${paramHostVars})) AS T;`,
                ``,
                `  exec sql OPEN C1;`,
                ``,
                `  exec sql`,
                `    FETCH C1 FOR 1 ROWS INTO :actual;`,
                ``,
                `  if (SQLCODE <> 0);`,
                `    fail('Failed to fetch using ${qualifiedName}. SQLCODE: ' + %char(SQLCODE));`,
                `  endif;`,
                ``,
                `  exec sql CLOSE C1;`,
                ``,
                ...(addStubComments ? [`  // Expected results`] : []),
                ...expectedInits,
                ``,
                ...(addStubComments ? [`  // Assertions`] : []),
                ...assertions,
                `end-proc;`
            ]
        };
    }

    function buildProcedureStub(schema: string, name: string, safeName: string, routineSignature: RoutineSignature, addStubComments?: boolean): string[] {
        const qualifiedName = `${schema}.${name}`;

        const inParams = routineSignature.parms.filter(p => p.PARAMETER_MODE === `IN` || p.PARAMETER_MODE === `INOUT`);
        const outParams = routineSignature.parms.filter(p => p.PARAMETER_MODE === `OUT` || p.PARAMETER_MODE === `INOUT`);

        // Parameter declarations
        const paramDecls = routineSignature.parms.map((p, i) => {
            const varName = toRpgVarName(p.PARAMETER_NAME, i, `param`);
            const detail = sqlDataTypeToRpgDetail(p);
            return `  dcl-s ${varName} ${detail.dataType};`;
        });

        // Expected OUT/INOUT parameter declarations
        const expectedDecls = outParams.map(p => {
            const varName = toRpgVarName(p.PARAMETER_NAME, routineSignature.parms.indexOf(p), `param`);
            const detail = sqlDataTypeToRpgDetail(p);
            return `  dcl-s expected_${varName} ${detail.dataType};`;
        });

        // IN / INOUT parameter initializations
        const paramInits = inParams.map(p => {
            const varName = toRpgVarName(p.PARAMETER_NAME, routineSignature.parms.indexOf(p), `param`);
            const detail = sqlDataTypeToRpgDetail(p);
            return `  ${varName} = ${detail.defaultValue};`;
        });

        // Parameter host variables for embedded SQL
        const callArgs = routineSignature.parms.map((p, i) => {
            return `      :${toRpgVarName(p.PARAMETER_NAME, i, `param`)}`;
        }).join(`,\n`);

        // Expected OUT/INOUT initializations
        const expectedInits = outParams.map(p => {
            const varName = toRpgVarName(p.PARAMETER_NAME, routineSignature.parms.indexOf(p), `param`);
            const detail = sqlDataTypeToRpgDetail(p);
            return `  expected_${varName} = ${detail.defaultValue};`;
        });

        const assertions = outParams.map(p => {
            const varName = toRpgVarName(p.PARAMETER_NAME, routineSignature.parms.indexOf(p), `param`);
            const detail = sqlDataTypeToRpgDetail(p);
            return `  ${buildAssertion(detail.assertion, `expected_${varName}`, varName, varName)}`;
        });

        return [
            `dcl-proc test_${safeName} export;`,
            `  dcl-pi *n extproc(*dclcase) end-pi;`,
            ``,
            ...paramDecls,
            ...expectedDecls,
            ``,
            ...(addStubComments ? [`  // Input`] : []),
            ...paramInits,
            ``,
            ...(addStubComments ? [`  // Call`] : []),
            `  exec sql`,
            `    CALL ${qualifiedName}(`,
            callArgs,
            `    );`,
            ``,
            `  if (SQLCODE <> 0);`,
            `    fail('Failed to call ${qualifiedName}. SQLCODE: ' + %char(SQLCODE));`,
            `  endif;`,
            ``,
            ...(addStubComments ? [`  // Expected results`] : []),
            ...expectedInits,
            ``,
            ...(addStubComments ? [`  // Assertions`] : []),
            ...assertions,
            `end-proc;`
        ];
    }

    /**
     * 1. Supported DATA_TYPE: https://www.ibm.com/docs/en/i/7.6.0?topic=views-sysparms
     * 2. SQL data types mapped to typical RPG declarations: https://www.ibm.com/docs/en/i/7.6.0?topic=applications-determining-equivalent-sql-ile-rpg-data-types
     */
    export function sqlDataTypeToRpgDetail(row: SysParmRow): RpgVarDetail {
        const dt = row.DATA_TYPE.trim().toLocaleUpperCase();
        const prec = row.NUMERIC_PRECISION ?? 0;
        const scale = row.NUMERIC_SCALE ?? 0;
        const charLen = row.CHARACTER_MAXIMUM_LENGTH ?? 1;

        switch (dt) {
            case `BIGINT`:
                return { dataType: `int(20)`, defaultValue: `0`, assertion: `iEqual`, isSupported: true };
            case `INTEGER`:
                return { dataType: `int(10)`, defaultValue: `0`, assertion: `iEqual`, isSupported: true };
            case `SMALLINT`:
                return { dataType: `int(5)`, defaultValue: `0`, assertion: `iEqual`, isSupported: true };
            case `DECIMAL`:
                return { dataType: `packed(${prec}:${scale})`, defaultValue: `0`, assertion: `assertEqual`, isSupported: true };
            case `NUMERIC`:
                return { dataType: `zoned(${prec}:${scale})`, defaultValue: `0`, assertion: `assertEqual`, isSupported: true };
            case `DOUBLE PRECISION`:
                return { dataType: `float(8)`, defaultValue: `0.0`, assertion: `assertEqual`, isSupported: true };
            case `REAL`:
                return { dataType: `float(4)`, defaultValue: `0.0`, assertion: `assertEqual`, isSupported: true };
            case `CHARACTER`:
                return { dataType: `char(${charLen})`, defaultValue: `''`, assertion: `aEqual`, isSupported: true };
            case `CHARACTER VARYING`:
                return { dataType: `varchar(${charLen})`, defaultValue: `''`, assertion: `aEqual`, isSupported: true };
            case `GRAPHIC`:
                return { dataType: `graph(${charLen})`, defaultValue: `''`, assertion: `assertEqual`, isSupported: true };
            case `GRAPHIC VARYING`:
                return { dataType: `vargraph(${charLen})`, defaultValue: `''`, assertion: `assertEqual`, isSupported: true };
            case `DATE`:
                return { dataType: `date`, defaultValue: `d'0001-01-01'`, assertion: `assertEqual`, isSupported: true };
            case `TIME`:
                return { dataType: `time`, defaultValue: `t'00.00.00'`, assertion: `assertEqual`, isSupported: true };
            case `TIMESTAMP`:
                return { dataType: `timestamp`, defaultValue: `z'0001-01-01-00.00.00.000000'`, assertion: `assertEqual`, isSupported: true };
            case `BOOLEAN`:
                return { dataType: `ind`, defaultValue: `*off`, assertion: `nEqual`, isSupported: true };

            case `CHARACTER LARGE OBJECT`:
                // return { dataType: `SQLTYPE(CLOB:${charLen})`, defaultValue: `// TODO`, assertion: `assertEqual`, isSupported: true };
            case `DOUBLE-BYTE CHARACTER LARGE OBJECT`:
                // return { dataType: `SQLTYPE(DBCLOB:${charLen})`, defaultValue: `// TODO`, assertion: `assertEqual`, isSupported: true };
            case `BINARY`:
                // return { dataType: `SQLTYPE(BINARY:${charLen})`, defaultValue: `// TODO`, assertion: `assertEqual`, isSupported: true };
            case `BINARY VARYING`:
                // return { dataType: `SQLTYPE(VARBINARY:${charLen})`, defaultValue: `// TODO`, assertion: `assertEqual`, isSupported: true };
            case `BINARY LARGE OBJECT`:
                // return { dataType: `SQLTYPE(BLOB:${charLen})`, defaultValue: `// TODO`, assertion: `assertEqual`, isSupported: true };
            case `ROWID`:
                // return { dataType: `SQLTYPE(ROWID)`, defaultValue: `// TODO`, assertion: `assertEqual`, isSupported: true };
            case `XML`:
                // return { dataType: `SQLTYPE(XML)`, defaultValue: `// TODO`, assertion: `assertEqual`, isSupported: true };
            case `DATALINK`:
            case `DECFLOAT`:
            case `DISTINCT`:
            case `ARRAY`:
            default:
                return { dataType: `NOT_SUPPORTED`, defaultValue: `NOT_SUPPORTED`, assertion: `assertEqual`, isSupported: false };
        }
    }

    /**
     * Lowercase and sanitise a name for use as an RPG variable.
     * Falls back to `<prefix><index+1>` (e.g. `param1`, `col2`) when the name is null.
     */
    export function toRpgVarName(name: string | null, index: number, prefix: `param` | `col`): string {
        return name ?
            name.replace(/[^a-zA-Z0-9_]/g, '_').toLocaleLowerCase() :
            `${prefix}${index + 1}`;
    }

    function buildAssertion(assertion: string, expected: string, actual: string, fieldName: string): string {
        if (assertion === `assert`) {
            return `assert(${expected} = ${actual} : '${fieldName}');`;
        }
        return `${assertion}(${expected} : ${actual} : '${fieldName}');`;
    }
}
