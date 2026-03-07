import { Uri, window, workspace } from "vscode";
import Declaration from "vscode-rpgle/language/models/declaration";
import Cache from "vscode-rpgle/language/models/cache";
import { getInstance } from "../extensions/ibmi";
import { LspUtils, RpgleTypeDetail, RpgleVariableType } from "./lspUtils";
import * as path from "path";
import { ApiUtils } from "../../api/apiUtils";
import { Configuration, Section, TestStubPreferences } from "../configuration";
import IBMi from "@halcyontech/vscode-ibmi-types/api/IBMi";

export interface TestCaseSpec {
    includes: { name: string, text: string }[];
    prototype: { name: string, text: string[] } | undefined;
    testCase: { name: string, text: string[] };
}

export namespace TestStubGenerator {
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

    export async function generateTestCaseSpec(docs: Cache, procedure: Declaration, addStubComments: boolean): Promise<TestCaseSpec> {
        // Get prototype
        const { prototype, prototypeInclude } = await getPrototype(procedure);

        // Get inputs
        const inputDecs: string[] = [];
        const inputInits: string[] = [];
        const inputIncludes: { name: string, text: string }[] = [];
        for (const subItem of procedure.subItems) {
            const subItemType = LspUtils.resolveType(docs, subItem);

            const subItemDec = getDeclaration(subItemType, `${subItem.name}`);
            inputDecs.push(...subItemDec);

            const subItemInits = getInitializations(docs, subItemType, `${subItem.name}`);
            inputInits.push(...subItemInits);

            const subItemIncludes = getIncludes(subItemType);
            inputIncludes.push(...subItemIncludes);
        }

        // Get return
        const resolvedType = LspUtils.resolveType(docs, procedure);
        const actualDec = getDeclaration(resolvedType, 'actual');
        const expectedDec = getDeclaration(resolvedType, 'expected');
        const expectedInits = getInitializations(docs, resolvedType, 'expected');
        const returnIncludes = getIncludes(resolvedType);

        // Get unique includes
        const rpgUnitInclude = `qinclude,TESTCASE`;
        const rpgUnitIncludeText = `/include ${rpgUnitInclude}`;
        const allIncludes = [{ name: rpgUnitInclude, text: rpgUnitIncludeText }, ...prototypeInclude, ...inputIncludes, ...returnIncludes];
        const includes = Array.from(new Map(allIncludes.map(item => [item.name, item])).values());

        // Get assertions
        const assertions = getAssertions(docs, resolvedType, 'expected', 'actual');

        const testCase = {
            name: procedure.name,
            text: [
                `dcl-proc test_${procedure.name} export;`,
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
            includes,
            prototype,
            testCase
        };
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
                    const subItemType = LspUtils.resolveType(docs, subItem);
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
            const docs = await LspUtils.getDocs(Uri.parse(reference.uri));
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
                    `dcl-pr ${procedure.name} ${LspUtils.prettyKeywords(procedure.keyword, true)} extproc('${procedure.name.toLocaleUpperCase()}');`,
                    ...procedure.subItems.map(s => `  ${s.name} ${LspUtils.prettyKeywords(s.keyword, true)};`),
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
                if (assertion === `assert`) {
                    assertions.push(`${assertion}(${expected} = ${actual}${fieldName ? ` : '${fieldName}'` : ``});`);
                } else {
                    assertions.push(`${assertion}(${expected} : ${actual}${fieldName ? ` : '${fieldName}'` : ``});`);
                }
            } else if (detail.reference) {
                for (const subItem of detail.reference.subItems) {
                    const subItemType = LspUtils.resolveType(docs, subItem);
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
                return `assert`;
        }
    }

    function asPosix(inPath?: string) {
        return inPath ? inPath.split(path.sep).join(path.posix.sep) : ``;
    }
}