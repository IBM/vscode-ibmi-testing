import { CodeAction, CodeActionKind, commands, Disposable, ExtensionContext, languages, Position, Range, TextDocument, Uri, window, workspace, WorkspaceEdit } from "vscode";
import Declaration from "vscode-rpgle/language/models/declaration";
import Cache from "vscode-rpgle/language/models/cache";
import { getInstance } from "../extensions/ibmi";
import { LspUtils, RpgleTypeDetail, RpgleVariableType } from "./lspUtils";
import * as path from "path";
import { ApiUtils } from "../api/apiUtils";

export namespace TestStubCodeActions {
    interface TestCaseSpec {
        includes: string[];
        prototype: { name: string, text: string[] } | undefined;
        testCase: { name: string, text: string[] };
    }

    export function registerTestStubCodeActions(context: ExtensionContext) {
        context.subscriptions.push(
            languages.registerCodeActionsProvider({ language: 'rpgle' },
                {
                    async provideCodeActions(document, range, context, token) {
                        const codeActions: CodeAction[] = [];

                        if (document) {
                            const docs = await getDocs(document.uri);
                            if (docs) {
                                const testStubCodeActions = await getTestStubCodeActions(document, docs, range);
                                if (testStubCodeActions) {
                                    codeActions.push(...testStubCodeActions);
                                }
                            }
                        }

                        return codeActions;
                    }
                }
            ),
            commands.registerCommand('vscode-rpgle.generateTestStub', async (document: TextDocument, docs: Cache, exportProcedures: Declaration[]) => {
                const ibmi = getInstance();
                const connection = ibmi!.getConnection();
                const content = ibmi!.getContent();

                // Build test file name and URI
                let testFileName: string;
                let testFileUri: Uri;
                if (document.uri.scheme === 'file') {
                    const workspaceFolder = workspace.getWorkspaceFolder(document.uri);
                    if (workspaceFolder) {
                        const parsedPath = path.parse(document.uri.fsPath);
                        testFileName = `${parsedPath.name}.test${parsedPath.ext}`;
                        const testFilePath = path.posix.join(workspaceFolder.uri.fsPath, 'qtestsrc', testFileName);
                        testFileUri = Uri.file(testFilePath);
                    } else {
                        window.showErrorMessage(`No workspace folder found for the document.`);
                        return;
                    }
                } else if (document.uri.scheme === 'member') {
                    const parsedPath = connection.parserMemberPath(document.uri.path);
                    testFileName = `${ApiUtils.getSystemNameFromPath(`${parsedPath.name}.test`)}.${parsedPath.extension}`;
                    const testFilePath = parsedPath.asp ?
                        path.posix.join(parsedPath.asp, parsedPath.library, 'QTESTSRC', testFileName) :
                        path.posix.join(parsedPath.library, 'QTESTSRC', testFileName);
                    testFileUri = Uri.from({ scheme: 'member', path: `/${testFilePath}` });
                } else {
                    window.showErrorMessage(`Unsupported URI scheme: ${document.uri.scheme}`);
                    return;
                }

                // Create test file if it does not exist
                let testDocument: TextDocument;
                try {
                    testDocument = await workspace.openTextDocument(testFileUri);
                } catch (error) {
                    if (testFileUri.scheme === 'member') {
                        const parsedPath = connection.parserMemberPath(document.uri.path);
                        const sourceFileExists = await content.checkObject({ library: parsedPath.library, name: 'QTESTSRC', type: '*FILE' });
                        if (!sourceFileExists) {
                            const createFile = await connection.runCommand({
                                command: `CRTSRCPF FILE(${parsedPath.library}/QTESTSRC) RCDLEN(112)`,
                                noLibList: true
                            });
                            if (createFile.code !== 0) {
                                window.showErrorMessage(`Failed to create ${parsedPath.library}/QTESTSRC: ${createFile.stderr}`);
                                return;
                            }
                        }
                    }

                    const createTestEdit = new WorkspaceEdit();
                    createTestEdit.createFile(
                        testFileUri,
                        {
                            ignoreIfExists: true
                        }
                    );
                    await workspace.applyEdit(createTestEdit);
                    testDocument = await workspace.openTextDocument(testFileUri);
                }

                // Generate test case spec
                const testCaseSpecs = await Promise.all(exportProcedures.map(async proc => await getTestCaseSpec(docs, proc)));
                let newIncludes: string[] = [...new Set([`/include qinclude,TESTCASE`, ...testCaseSpecs.map(tcs => tcs.includes).flat()])];
                let newPrototypes: { name: string, text: string[] }[] = testCaseSpecs.flatMap(tcs => tcs.prototype ? tcs.prototype : []);
                let newTestCases: { name: string, text: string[] }[] = testCaseSpecs.flatMap(tcs => tcs.testCase ? tcs.testCase : []);

                // Build test stub edit
                let testStubEdit = new WorkspaceEdit();
                try {
                    const testDocs = await getDocs(testFileUri);

                    // Add directive and control options
                    const text = testDocument.getText();
                    if (text === '') {
                        const directiveAndControlOptions = [
                            `**free`,
                            ``,
                            `ctl-opt nomain;`
                        ];

                        testStubEdit.insert(
                            testFileUri,
                            new Position(testDocument.lineCount - 1, 0),
                            directiveAndControlOptions.join(`\n`)
                        );
                    }

                    // Add includes
                    let newIncludesInsert: { line: number, character: number } = { line: testDocument.lineCount - 1, character: testDocument.lineAt(testDocument.lineCount - 1).text.length };
                    let newIncludesTextWrap: { prefix: string, suffix: string } = { prefix: '\n\n', suffix: '' };
                    if (testDocs) {
                        // Filter out includes that already exist
                        newIncludes = newIncludes.filter(include => !text.includes(include));

                        if (testDocs.includes.length > 0) {
                            // Insert include after the last existing resolved include
                            newIncludesInsert.line = Math.max(...testDocs.includes.map(i => i.line));
                            newIncludesInsert.character = testDocument.lineAt(newIncludesInsert.line).text.length
                            newIncludesTextWrap.prefix = `\n`;
                        } else if (text.toLocaleUpperCase().includes('/COPY') || text.toLocaleUpperCase().includes('/INCLUDE')) {
                            // Insert include after the last existing unresolved include
                            const splitText = text.split(/\r?\n/);
                            for (let i = splitText.length - 1; i >= 0; i--) {
                                const line = splitText[i].toLocaleUpperCase().trim();
                                if (line.startsWith('/COPY') || line.startsWith('/INCLUDE')) {
                                    newIncludesInsert.line = i;
                                    newIncludesInsert.character = testDocument.lineAt(newIncludesInsert.line).text.length
                                    break;
                                }
                            }
                            newIncludesTextWrap.prefix = `\n`;
                        } else if (testDocs.procedures.length > 0) {
                            // Insert include before the first procedure or prototype
                            const existingProcedures = testDocs.procedures.filter(proc => proc.position?.path === testDocument.uri.toString());
                            newIncludesInsert.line = Math.min(...existingProcedures.map(proc => proc.range.start!));
                            newIncludesTextWrap.prefix = ``;
                            newIncludesTextWrap.suffix = `\n\n`;
                        }
                    }
                    if (newIncludes.length > 0) {
                        const newIncludesPosition = new Position(newIncludesInsert.line, newIncludesInsert.character);
                        const newIncludesText = `${newIncludesTextWrap.prefix}${newIncludes.join(`\n`)}${newIncludesTextWrap.suffix}`
                        testStubEdit.insert(
                            testFileUri,
                            newIncludesPosition,
                            newIncludesText
                        );
                    }

                    // Add prototypes
                    let newPrototypesInsert: { line: number, character: number } = { line: testDocument.lineCount - 1, character: testDocument.lineAt(testDocument.lineCount - 1).text.length };
                    let newPrototypesTextWrap: { prefix: string, suffix: string } = { prefix: '\n\n', suffix: '' };
                    if (testDocs) {
                        // Filter out prototypes that already exist
                        const existingPrototypes = testDocs.procedures.filter(proc => proc.position?.path === testDocument.uri.toString() && proc.keyword[`EXTPROC`]);
                        newPrototypes = newPrototypes.filter(proto => !existingPrototypes.some(existingProto => existingProto.name === proto.name));

                        if (existingPrototypes.length > 0) {
                            // Insert prototypes after the last existing prototype
                            newPrototypesInsert.line = Math.max(...existingPrototypes.map(proc => proc.range.end!));
                            newPrototypesInsert.character = testDocument.lineAt(newPrototypesInsert.line).text.length
                        } else if (testDocs.procedures.length > 0) {
                            // Insert prototypes before the first procedure
                            const existingProcedures = testDocs.procedures.filter(proc => proc.position?.path === testDocument.uri.toString());
                            newPrototypesInsert.line = Math.min(...existingProcedures.map(proc => proc.range.start!));
                            newPrototypesTextWrap.prefix = ``;
                            newPrototypesTextWrap.suffix = `\n\n`;
                        }
                    }
                    if (newPrototypes.length > 0) {
                        const newPrototypesPosition = new Position(newPrototypesInsert.line, newPrototypesInsert.character);
                        const newPrototypesText = `${newPrototypesTextWrap.prefix}${newPrototypes.map(proto => proto.text.join('\n')).join('\n\n')}${newPrototypesTextWrap.suffix}`;
                        testStubEdit.insert(
                            testFileUri,
                            newPrototypesPosition,
                            newPrototypesText
                        );
                    }

                    // Add test cases
                    let newTestCasesInsert: { line: number, character: number } = { line: testDocument.lineCount - 1, character: testDocument.lineAt(testDocument.lineCount - 1).text.length };
                    let newTestCasesTextWrap: { prefix: string, suffix: string } = { prefix: '\n\n', suffix: '' };
                    if (testDocs) {
                        if (testDocs.procedures.length > 0) {
                            // Insert test case after the last procedure
                            const existingProcedures = testDocs.procedures.filter(proc => proc.position?.path === testDocument.uri.toString());
                            newTestCasesInsert.line = Math.max(...existingProcedures.map(proc => proc.range.end!));
                            newPrototypesInsert.character = testDocument.lineAt(newTestCasesInsert.line).text.length
                        }
                    }
                    if (newTestCases.length > 0) {
                        const newTestCasesPosition = new Position(newTestCasesInsert.line, newTestCasesInsert.character);
                        const newTestCasesText = `${newTestCasesTextWrap.prefix}${newTestCases.map(testCase => testCase.text.join('\n')).join('\n\n')}${newTestCasesTextWrap.suffix}`;
                        testStubEdit.insert(
                            testFileUri,
                            newTestCasesPosition,
                            newTestCasesText
                        );
                    }
                } catch (error) {
                    // Fallback to inserting stub at the end of the file (this may happen if the cache is outdated)
                    const testStubPosition = new Position(testDocument.lineCount - 1, 0);
                    const testStubText = [
                        `**free`,
                        ``,
                        `ctl-opt nomain;`,
                        ``,
                        newIncludes.join(`\n`),
                        ``,
                        newPrototypes.map(proto => proto.text.join('\n')).join('\n\n'),
                        ``,
                        newTestCases.map(testCase => testCase.text.join('\n')).join('\n\n')
                    ].join('\n');

                    testStubEdit = new WorkspaceEdit();
                    testStubEdit.insert(
                        testFileUri,
                        testStubPosition,
                        testStubText
                    );
                }

                await workspace.applyEdit(testStubEdit);
                await window.showTextDocument(testDocument);
            })
        );
    }

    async function getDocs(uri: Uri): Promise<Cache | undefined> {
        return await commands.executeCommand('vscode-rpgle.server.getCache', uri);
    }

    export async function getTestStubCodeActions(document: TextDocument, docs: Cache, range: Range): Promise<CodeAction[] | undefined> {
        const codeActions: CodeAction[] = [];

        const exportProcedures = docs.procedures.filter(proc => proc.keyword[`EXPORT`]);
        if (exportProcedures.length > 0) {
            // Build test file name
            const parsedPath = path.parse(document.uri.fsPath);
            const fileName = parsedPath.base;

            // Test case generation
            const currentProcedure = exportProcedures.find(sub => sub.range.start && sub.range.end && range.start.line >= sub.range.start && range.end.line <= sub.range.end);
            if (currentProcedure) {
                const title = `Generate test case for '${currentProcedure.name}'`;
                const testCaseAction = new CodeAction(title, CodeActionKind.RefactorExtract);
                testCaseAction.command = {
                    title: title,
                    command: `vscode-rpgle.generateTestStub`,
                    arguments: [document, docs, [currentProcedure]]
                };
                codeActions.push(testCaseAction);
            }

            // Test suite generation
            const title = `Generate test suite for '${fileName}'`;
            const testSuiteAction = new CodeAction(title, CodeActionKind.RefactorExtract);
            testSuiteAction.command = {
                title: title,
                command: `vscode-rpgle.generateTestStub`,
                arguments: [document, docs, exportProcedures]
            }
            codeActions.push(testSuiteAction);
        }

        return codeActions;
    }

    async function getTestCaseSpec(docs: Cache, procedure: Declaration): Promise<TestCaseSpec> {
        // Get procedure prototype
        const prototype = await getPrototype(procedure);

        // Get inputs
        const inputDecs: string[] = [];
        const inputInits: string[] = [];
        const inputIncludes: string[] = [];
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
        const includes = [...new Set([...inputIncludes, ...returnIncludes])];

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
                `  // Input`,
                ...inputInits.map(init => `  ${init}`),
                ``,
                `  // Actual results`,
                `  actual = ${procedure.name}(${procedure.subItems.map(s => s.name).join(` : `)});`,
                ``,
                `  // Expected results`,
                ...expectedInits.map(init => `  ${init}`),
                ``,
                `  // Assertions`,
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
                declarations.push(`dcl-s ${name} ${detail.type.name}${detail.type.value ? `(${detail.type.value})` : ``};`);
            } else if (detail.reference) {
                declarations.push(`dcl-ds ${name} likeDs(${detail.reference.name});`);
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

    async function getPrototype(procedure: Declaration): Promise<{ name: string, text: string[] } | undefined> {
        for (const reference of procedure.references) {
            const docs = await getDocs(Uri.parse(reference.uri));
            if (docs) {
                const prototype = docs.procedures.some(proc => proc.name === procedure.name && proc.keyword['EXTPROC'])
                if (prototype) {
                    return;
                }
            }
        }

        return {
            name: procedure.name,
            text: [
                `dcl-pr ${procedure.name} ${LspUtils.prettyKeywords(procedure.keyword, true)} extproc('${procedure.name.toLocaleUpperCase()}');`,
                ...procedure.subItems.map(s => `  ${s.name} ${LspUtils.prettyKeywords(s.keyword, true)};`),
                `end-pr;`
            ]
        };
    }

    function getIncludes(detail: RpgleTypeDetail): string[] {
        const includes: string[] = [];

        if (detail.reference) {
            const structUri = Uri.parse(detail.reference.position.path);

            if (structUri.scheme === 'file') {
                const workspaceFolder = workspace.getWorkspaceFolder(structUri);
                if (workspaceFolder) {
                    const newInclude = asPosix(path.relative(workspaceFolder.uri.fsPath, structUri.fsPath));

                    if (!includes.includes(newInclude)) {
                        includes.push(`/include '${newInclude}'`);
                    }
                }
            } else {
                const ibmi = getInstance();
                const connection = ibmi!.getConnection();
                const parsedPath = connection.parserMemberPath(structUri.path);
                const newInclude = `${parsedPath.file},${parsedPath.name}`;

                if (!includes.includes(newInclude)) {
                    includes.push(`/include ${newInclude}`);
                }
            }
        }

        return includes;
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
                return `%date('0001-01-01' : *iso)`;
            case `time`:
                return `%time('00.00.00' : *iso)`;
            case `timestamp`:
                return `%timestamp('0001-01-01-00.00.00.000000' : *iso)`;
            case `pointer`:
                return `*null`;
            default:
                return 'unknown';
        }
    }

    function getAssertion(type: RpgleVariableType): string {
        switch (type) {
            case `char`:
            case `varchar`:
            case `graph`:
            case `vargraph`:
                return `aEqual`;
            case `int`:
            case `uns`:
                return `iEqual`;
            case `packed`:
            case `zoned`:
            case `float`:
                return `assert`;
            case `ind`:
                return `nEqual`;
            case `date`:
                return `assert`;
            case `time`:
                return `assert`;
            case `timestamp`:
                return `assert`;
            case `pointer`:
                return `assert`;
            default:
                return 'unknown';
        }
    }

    function asPosix(inPath?: string) {
        return inPath ? inPath.split(path.sep).join(path.posix.sep) : ``;
    }
}