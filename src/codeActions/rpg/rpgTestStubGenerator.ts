import { QuickInputButton, QuickInputButtonLocation, QuickInputButtons, ThemeColor, ThemeIcon, Uri, window, workspace } from "vscode";
import Declaration from "vscode-rpgle/language/models/declaration";
import Cache from "vscode-rpgle/language/models/cache";
import { getInstance } from "../../extensions/ibmi";
import { RpgLspUtils, RpgleTypeDetail, RpgleVariableType } from "./rpgLspUtils";
import * as path from "path";
import { ApiUtils } from "../../../api/apiUtils";
import { LocalConfigHandler, QsysConfigHandler } from "../../../api/config";
import { Configuration, Section, TestStubPreferences } from "../../configuration";
import { testOutputLogger } from "../../extension";
import IBMi from "@halcyontech/vscode-ibmi-types/api/IBMi";

export interface RpgTestCaseSpec {
    includes: { name: string, text: string }[];
    prototype: { name: string, text: string[] } | undefined;
    testCase: { name: string, text: string[] };
}

export interface RpgTestCaseSpecResult {
    spec: RpgTestCaseSpec;
    promptForInputValue: boolean;
    promptForExpectedValue: boolean;
}

export namespace RpgTestStubGenerator {
    export async function generateTestStubLocation(uri: Uri, connection?: IBMi, forcePreferences?: Partial<TestStubPreferences>) {
        // Get test stub generation preferences
        const testStubPreferences = {
            ...Configuration.getOrFallback<TestStubPreferences>(Section.testStubPreferences),
            ...forcePreferences
        };

        // Build test file name, parent name (directory or source file) and URI
        let testFileName: string;
        let testFileParentName: string;
        let testFileUri: Uri;
        if (uri.scheme === 'file') {
            const workspaceFolder = workspace.getWorkspaceFolder(uri);
            if (workspaceFolder) {
                const parsedPath = path.parse(uri.fsPath);
                testFileName = `${parsedPath.name}.test${parsedPath.ext}`;
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
            testFileName = `${ApiUtils.getSystemNameFromPath(`${parsedPath.name}.test`)}.${parsedPath.extension}`;
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

        return {
            testFileName,
            testFileParentName,
            testFileUri
        };
    }

    export async function generateTestConfig(uri: Uri, testFileUri: Uri, connection?: IBMi): Promise<{ uri: Uri, content: string } | undefined> {
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

    async function promptUserForTestName(testFileParentName: string, testFileName: string, isLocal: boolean): Promise<{ testFileParentName: string, testFileName: string } | undefined> {
        const errorMessage = isLocal ?
            'Invalid format. Valid example: qtestsrc/example.test.rpgle' :
            'Invalid format. Valid example: QTESTSRC/EXAMPLET.RPGLE';
        const testName = await window.showInputBox({
            prompt: 'Enter test name',
            placeHolder: 'Test name',
            value: `${testFileParentName}/${testFileName}`,
            validateInput: (value) => {
                if (!/^[^\s\/]+\/[^\s\/]+\.[^\s\/\.]+$/.test(value)) {
                    return errorMessage;
                } else {
                    return null;
                }
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

    export async function generateTestCaseSpec(docs: Cache, procedure: Declaration, existingProcedures: string[], addStubComments: boolean, promptForInputValue: boolean, promptForExpectedValue: boolean): Promise<RpgTestCaseSpecResult> {
        // Get unique procedure name
        const baseProcedureName = `test_${procedure.name}`;
        let procedureName = baseProcedureName;
        const uppercasedExistingProcedures = new Set(existingProcedures.map(p => p.toLocaleUpperCase()));
        let procSuffix = 1;
        while (uppercasedExistingProcedures.has(procedureName.toLocaleUpperCase())) {
            procedureName = `${baseProcedureName}_${procSuffix}`;
            procSuffix++;
        }

        // Get prototype
        const { prototype, prototypeInclude } = await getPrototype(procedure);

        // Get inputs
        const inputDecs: string[] = [];
        let inputInits: string[] = [];
        const inputIncludes: { name: string, text: string }[] = [];
        for (const subItem of procedure.subItems) {
            const subItemType = RpgLspUtils.resolveType(docs, subItem);

            const subItemDec = getDeclaration(subItemType, `${subItem.name}`);
            inputDecs.push(...subItemDec);

            const subItemInits = getInitializations(docs, subItemType, `${subItem.name}`);
            inputInits.push(...subItemInits);

            const subItemIncludes = getIncludes(subItemType);
            inputIncludes.push(...subItemIncludes);
        }

        // Get return
        const resolvedType = RpgLspUtils.resolveType(docs, procedure);
        const actualDec = getDeclaration(resolvedType, 'actual');
        const expectedDec = getDeclaration(resolvedType, 'expected');
        let expectedInits = getInitializations(docs, resolvedType, 'expected');
        const returnIncludes = getIncludes(resolvedType);

        // Prompt for input values
        let skipExpected = false;
        if (promptForInputValue && inputInits.length > 0) {
            const prompted = await promptForValues(inputInits, procedure.name, `Input`, false);
            if (prompted === undefined) {
                // User disabled prompting for input — caller will update the preference
                promptForInputValue = false;
                skipExpected = true;
            } else {
                inputInits = prompted.values;

                // If the user cancelled or skipped remaining during input, skip expected too
                skipExpected = prompted.skipped;
            }
        }

        // Prompt for expected values
        if (!skipExpected && promptForExpectedValue && expectedInits.length > 0) {
            const prompted = await promptForValues(expectedInits, procedure.name, `Expected`, true);
            if (prompted === undefined) {
                // User disabled prompting for expected — caller will update the preference
                promptForExpectedValue = false;
            } else {
                expectedInits = prompted.values;
            }
        }

        // Get unique includes
        const rpgUnitInclude = `qinclude,TESTCASE`;
        const rpgUnitIncludeText = `/include ${rpgUnitInclude}`;
        const allIncludes = [{ name: rpgUnitInclude, text: rpgUnitIncludeText }, ...prototypeInclude, ...inputIncludes, ...returnIncludes];
        const includes = Array.from(new Map(allIncludes.map(item => [item.name, item])).values());

        // Get assertions
        const assertions = getAssertions(docs, resolvedType, 'expected', 'actual');

        const testCase = {
            name: procedureName,
            text: [
                `dcl-proc ${procedureName} export;`,
                `  dcl-pi *n extproc(*dclcase) end-pi;`,
                ``,
                ...inputDecs.map(dec => `  ${dec}`),
                ...actualDec.map(dec => `  ${dec}`),
                ...expectedDec.map(dec => `  ${dec}`),
                ``,
                ...(addStubComments ? [`  // Input`] : []),
                ...inputInits.map(init => `  ${init}`),
                ``,
                ...(addStubComments ? [`  // Actual results`] : []),
                `  actual = ${procedure.name}(${procedure.subItems.map(s => s.name).join(` : `)});`,
                ``,
                ...(addStubComments ? [`  // Expected results`] : []),
                ...expectedInits.map(init => `  ${init}`),
                ``,
                ...(addStubComments ? [`  // Assertions`] : []),
                ...assertions.map(assert => `  ${assert}`),
                `end-proc;`
            ]
        };

        return {
            spec: {
                includes,
                prototype,
                testCase
            },
            promptForInputValue,
            promptForExpectedValue
        };
    }

    /**
     * Walks the user through a list of initialisation lines one at a time using
     * a custom InputBox that has Back, Next, Reset, Skip Remaining and Disable buttons.
     *
     * Return values:
     * - `{ values, skipped: false }` — Completed normally
     * - `{ values, skipped: true }` — Cancelled or skip remaining pressed
     * - `undefined` — Disable pressed
     */
    async function promptForValues(inits: string[], procedureName: string, kind: 'Input' | 'Expected', isExpected: boolean): Promise<{ values: string[], skipped: boolean } | undefined> {
        const results = [...inits];
        let index = 0;

        const backButton = QuickInputButtons.Back;
        const defaultColor = new ThemeColor('icon.foreground');
        const nextButton: QuickInputButton = {
            location: QuickInputButtonLocation.Inline,
            iconPath: new ThemeIcon('arrow-right', defaultColor),
            tooltip: 'Next Value'
        };
        const resetButton: QuickInputButton = {
            location: QuickInputButtonLocation.Inline,
            iconPath: new ThemeIcon('discard', defaultColor),
            tooltip: 'Reset Value to Default'
        };
        const skipRemainingButton: QuickInputButton = {
            location: QuickInputButtonLocation.Title,
            iconPath: new ThemeIcon('debug-step-over', defaultColor),
            tooltip: 'Skip Remaining Values'
        };
        const disableButton: QuickInputButton = {
            location: QuickInputButtonLocation.Title,
            iconPath: new ThemeIcon('circle-slash', defaultColor),
            tooltip: isExpected ? 'Disable Prompting For Expected Values' : 'Disable Prompting For Input Values'
        };

        while (index < results.length) {
            const current = results[index];

            // Lines are always generated as `name = value;` so split on the first `=`
            const equalIndex = current.indexOf('=');
            const varName = current.slice(0, equalIndex).trim();
            const varValueWithSemiColon = current.slice(equalIndex + 1).trim();
            const varValue = varValueWithSemiColon.endsWith(';') ? varValueWithSemiColon.slice(0, -1) : varValueWithSemiColon;

            const result = await new Promise<string | 'back' | 'next' | 'skipRemaining' | 'disable' | undefined>(resolve => {
                const basePrompt = isExpected
                    ? `Enter the expected value which ${varName} should be initialized to:`
                    : `Enter the input value which ${varName} should be initialized to:`;

                const inputBox = window.createInputBox();
                inputBox.title = `${procedureName} — ${kind} values (${index + 1}/${results.length})`;
                inputBox.placeholder = `${kind} value`;
                inputBox.prompt = `${basePrompt} ${varName} = ${varValue};`;
                inputBox.value = varValue;
                inputBox.buttons = index > 0
                    ? [backButton, nextButton, resetButton, skipRemainingButton, disableButton]
                    : [nextButton, resetButton, skipRemainingButton, disableButton];
                inputBox.ignoreFocusOut = true;

                inputBox.onDidChangeValue(value => {
                    inputBox.prompt = `${basePrompt} ${varName} = ${value};`;
                });

                inputBox.onDidAccept(() => {
                    resolve(inputBox.value);
                    inputBox.dispose();
                });

                inputBox.onDidTriggerButton((button: QuickInputButton) => {
                    if (button === backButton) {
                        resolve('back'); inputBox.dispose();
                    } else if (button === nextButton) {
                        resolve(inputBox.value); inputBox.dispose();
                    } else if (button === resetButton) {
                        inputBox.value = varValue;
                        inputBox.prompt = `${basePrompt} (${varName} = ${varValue};)`;
                    } else if (button === skipRemainingButton) {
                        resolve('skipRemaining'); inputBox.dispose();
                    } else if (button === disableButton) {
                        resolve('disable'); inputBox.dispose();
                    }
                });

                inputBox.onDidHide(() => {
                    resolve(undefined);
                    inputBox.dispose();
                });

                inputBox.show();
            });

            if (result === undefined) {
                // Cancelled — leave remaining inits as defaults and skip expected
                return { values: results, skipped: true };
            } else if (result === 'disable') {
                return undefined;
            } else if (result === 'back') {
                index = Math.max(0, index - 1);
            } else if (result === 'skipRemaining') {
                // Leave all remaining at their defaults and skip expected
                return { values: results, skipped: true };
            } else {
                // Next button or press enter — save the typed value and advance
                results[index] = `${varName} = ${result};`;
                index++;
            }
        }

        return { values: results, skipped: false };
    }

    function getDeclaration(detail: RpgleTypeDetail, name: string): string[] {
        const declarations: string[] = [];

        if (detail) {
            if (detail.type) {
                declarations.push(`dcl-s ${name} ${detail.type.name}${detail.type.value && detail.type.value as any !== true ? `(${detail.type.value})` : ``};`);
            } else if (detail.reference) {
                declarations.push(`dcl-ds ${name} likeDs(${detail.reference.name}) inz;`);
            }
        }

        return declarations;
    }

    function getInitializations(docs: Cache, detail: RpgleTypeDetail, name: string): string[] {
        const inits: string[] = [];

        if (detail) {
            if (detail.type) {
                const defaultValue = getDefaultValue(detail.type.name);
                inits.push(`${name} = ${defaultValue};`);
            } else if (detail.reference) {
                for (const subItem of detail.reference.subItems) {
                    const subItemType = RpgLspUtils.resolveType(docs, subItem);
                    const subItemInits = subItemType ?
                        getInitializations(docs, subItemType, `${name}.${subItem.name}`) : [];
                    inits.push(...subItemInits);
                }
            }
        }

        return inits;
    }

    async function getPrototype(procedure: Declaration): Promise<{ prototype?: { name: string, text: string[] }, prototypeInclude: { name: string, text: string }[] }> {
        for (const reference of procedure.references) {
            const docs = await RpgLspUtils.getDocs(Uri.parse(reference.uri));
            if (docs) {
                const prototype = docs.procedures.find(proc => proc.prototype && proc.prototype && proc.name === procedure.name);
                if (prototype) {
                    const prototypeInclude = constructInclude(Uri.parse(prototype.position.path));
                    return {
                        prototypeInclude: [prototypeInclude]
                    };
                }
            }
        }

        return {
            prototype: {
                name: procedure.name,
                text: [
                    `dcl-pr ${procedure.name} ${RpgLspUtils.prettyKeywords(procedure.keyword, true)} extproc('${procedure.name.toLocaleUpperCase()}');`,
                    ...procedure.subItems.map(s => `  ${s.name} ${RpgLspUtils.prettyKeywords(s.keyword, true)};`),
                    `end-pr;`
                ]
            },
            prototypeInclude: []
        };
    }

    function getIncludes(detail: RpgleTypeDetail): { name: string, text: string }[] {
        const includes: { name: string, text: string }[] = [];

        if (detail.reference) {
            const structUri = Uri.parse(detail.reference.position.path);

            const newInclude = constructInclude(structUri);
            if (!includes.some(include => include.text === newInclude.text)) {
                includes.push(newInclude);
            }
        }

        return includes;
    }

    function constructInclude(uri: Uri): { name: string, text: string } {
        if (uri.scheme === 'file') {
            const workspaceFolder = workspace.getWorkspaceFolder(uri)!;
            const newInclude = `'${asPosix(path.relative(workspaceFolder.uri.fsPath, uri.fsPath))}'`;
            const newIncludeText = `/include ${newInclude}`;

            return { name: newInclude, text: newIncludeText };
        } else {
            const ibmi = getInstance();
            const connection = ibmi!.getConnection()!;
            const parsedPath = connection.parserMemberPath(uri.path);
            const newInclude = `${parsedPath.file},${parsedPath.name}`;
            const newIncludeText = `/include ${newInclude}`;

            return { name: newInclude, text: newIncludeText };
        }
    }

    function getAssertions(docs: Cache, detail: RpgleTypeDetail, expected: string, actual: string): string[] {
        const assertions: string[] = [];

        if (detail) {
            if (detail.type) {
                const assertion = getAssertion(detail.type.name);
                const fieldName = actual.split(`.`).pop();
                if (assertion === `assertEqual`) {
                    assertions.push(`${assertion}(${expected} = ${actual}${fieldName ? ` : '${fieldName}'` : ``});`);
                } else {
                    assertions.push(`${assertion}(${expected} : ${actual}${fieldName ? ` : '${fieldName}'` : ``});`);
                }
            } else if (detail.reference) {
                for (const subItem of detail.reference.subItems) {
                    const subItemType = RpgLspUtils.resolveType(docs, subItem);
                    const subItemAssertions = subItemType ?
                        getAssertions(docs, subItemType, `${expected}.${subItem.name}`, `${actual}.${subItem.name}`) : [];
                    assertions.push(...subItemAssertions);
                }
            }
        }

        return assertions;
    }

    function getDefaultValue(type: RpgleVariableType): string {
        switch (type) {
            case `char`:
            case `varchar`:
            case `ucs2`:
            case `varucs2`:
            case `graph`:
            case `vargraph`:
                return `''`;
            case `int`:
            case `uns`:
                return `0`;
            case `packed`:
            case `zoned`:
            case `float`:
                return `0.0`;
            case `ind`:
                return `*off`;
            case `date`:
                return `d'0001-01-01'`;
            case `time`:
                return `t'00.00.00'`;
            case `timestamp`:
                return `z'0001-01-01-00.00.00.000000'`;
            case `pointer`:
                return `*null`;
            default:
                return 'unknown';
        }
    }

    function getAssertion(type: RpgleVariableType): string {
        switch (type) {
            case `int`:
                return `iEqual`;
            case `ind`:
                return `nEqual`;
            case `char`:
            case `varchar`:
            case `ucs2`:
            case `varucs2`:
            case `graph`:
            case `vargraph`:
            case `uns`:
            case `packed`:
            case `zoned`:
            case `float`:
            case `date`:
            case `time`:
            case `timestamp`:
            case `pointer`:
            default:
                return `assertEqual`;
        }
    }

    function asPosix(inPath?: string) {
        return inPath ? inPath.split(path.sep).join(path.posix.sep) : ``;
    }
}