import { CodeAction, CodeActionKind, commands, ExtensionContext, languages, Position, ProgressLocation, Range, TextDocument, ThemeIcon, Uri, window, workspace, WorkspaceEdit } from "vscode";
import Declaration from "vscode-rpgle/language/models/declaration";
import Cache from "vscode-rpgle/language/models/cache";
import { getInstance } from "../extensions/ibmi";
import { LspUtils } from "./lspUtils";
import * as path from "path";
import { Configuration, Section, TestStubPreferences } from "../configuration";
import { TestStubGenerator } from "./testStubGenerator";

export namespace TestStubCodeActions {
    export function registerTestStubCodeActions(context: ExtensionContext) {
        context.subscriptions.push(
            languages.registerCodeActionsProvider({ language: 'rpgle' },
                {
                    async provideCodeActions(document, range, context, token) {
                        const codeActions: CodeAction[] = [];

                        if (document) {
                            const docs = await LspUtils.getDocs(document.uri);
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
            commands.registerCommand('vscode-ibmi-testing.generateTestStub', generateTestStub)
        );
    }

    async function generateTestStub(document: TextDocument, docs: Cache, exportProcedures: Declaration[], forcePreferences?: Partial<TestStubPreferences>): Promise<Uri | undefined> {
        const ibmi = getInstance();
        const connection = ibmi!.getConnection()!;

        // Get test stub generation preferences
        const testStubPreferences = {
            ...Configuration.getOrFallback<TestStubPreferences>(Section.testStubPreferences),
            ...forcePreferences
        };

        // Build test file name, parent name (directory or source file) and URI
        const testFileLocation = await TestStubGenerator.generateTestStubLocation(document.uri, connection);
        if (!testFileLocation) {
            return;
        }

        if (testFileLocation.testFileUri.scheme === 'member') {
            const content = connection.getContent();

            // Check if test source file exists
            const parsedPath = connection.parserMemberPath(document.uri.path);
            const sourceFileExists = await content.checkObject({ library: parsedPath.library, name: testFileLocation.testFileParentName, type: '*FILE' });

            // Prompt user to create test source file if in preview mode
            if (testStubPreferences["Show Test Stub Preview"]) {
                if (!sourceFileExists) {
                    const value = await window.showErrorMessage(`The source file ${parsedPath.library}/${testFileLocation.testFileParentName} does not exist. Can it be created?`, { modal: true }, 'Yes', 'No');
                    if (value === 'No') {
                        return;
                    }
                }
            }

            // Create test source file if it does not exist
            if (!sourceFileExists) {
                const createFile = await connection.runCommand({
                    command: `CRTSRCPF FILE(${parsedPath.library}/${testFileLocation.testFileParentName}) RCDLEN(112)`,
                    noLibList: true
                });
                if (createFile.code !== 0) {
                    window.showErrorMessage(`Failed to create ${parsedPath.library}/${testFileLocation.testFileParentName}: ${createFile.stderr}`);
                    return;
                }
            }
        }

        // Check if the test file URI is amongst the opened text documents
        const openedTextDocuments = workspace.textDocuments;
        const openedTestDocument = openedTextDocuments.find(document => document.uri.fsPath === testFileLocation.testFileUri.fsPath);
        if (openedTestDocument) {
            testFileLocation.testFileUri = openedTestDocument.uri;
        }

        // Generate test case spec
        const testCaseSpecs = await Promise.all(exportProcedures.map(async proc => await TestStubGenerator.generateTestCaseSpec(docs, proc, testStubPreferences["Add Stub Comments"])));

        // Build test stub edit and insert code in appropriate places
        const testStubEdit = new WorkspaceEdit();
        const testDocs = await LspUtils.getDocs(testFileLocation.testFileUri);
        let testDocument: TextDocument | undefined;

        // Create test file if it does not exist
        try {
            testDocument = await workspace.openTextDocument(testFileLocation.testFileUri);
        } catch (error) {
            testStubEdit.createFile(
                testFileLocation.testFileUri,
                {
                    ignoreIfExists: true
                },
                {
                    label: `Create '${testFileLocation.testFileName}'`,
                    needsConfirmation: testStubPreferences["Show Test Stub Preview"],
                    iconPath: new ThemeIcon('file')
                }
            );
        }

        const text = testDocument ? testDocument.getText() : '';
        const lastLine = testDocument ? testDocument.lineCount - 1 : 0;
        function lineAt(line: number): string {
            return testDocument ? testDocument.lineAt(line).text : '';
        }

        // Add directive and control options
        if (testStubPreferences["Add Control Options and Directives"] && text === '') {
            const directiveAndControlOptions = [
                `**free`,
                ``,
                `ctl-opt nomain ccsidcvt(*excp) ccsid(*char : *jobrun);`
            ];

            testStubEdit.insert(
                testFileLocation.testFileUri,
                new Position(lastLine, 0),
                directiveAndControlOptions.join(`\n`),
                {
                    label: `Add directive and control option(s)`,
                    needsConfirmation: testStubPreferences["Show Test Stub Preview"],
                    iconPath: new ThemeIcon('symbol-misc')
                }
            );
        }

        // Add includes
        if (testStubPreferences["Add Includes"]) {
            const allIncludes = testCaseSpecs.flatMap(tcs => tcs.includes);
            let newIncludes = Array.from(new Map(allIncludes.map(item => [item.name, item])).values());
            let newIncludesInsert: { line: number, character: number } = { line: lastLine, character: lineAt(lastLine).length };
            let newIncludesTextWrap: { prefix: string, suffix: string } = { prefix: '\n\n', suffix: '' };
            if (testDocs) {
                try {
                    // Filter out includes that already exist
                    newIncludes = newIncludes.filter(include =>
                        !(text.toLocaleLowerCase().includes(`/include ${include.name}`.toLocaleLowerCase()) || text.toLocaleLowerCase().includes(`/copy ${include.name}`.toLocaleLowerCase())));

                    if (testDocs.includes.length > 0) {
                        // Insert include after the last existing resolved include
                        newIncludesInsert.line = Math.max(...testDocs.includes.filter(i => i.fromPath === testFileLocation.testFileUri.toString()).map(i => i.line));
                        newIncludesInsert.character = lineAt(newIncludesInsert.line).length;
                        newIncludesTextWrap.prefix = `\n`;
                    } else if (text.toLocaleLowerCase().includes('/copy') || text.toLocaleLowerCase().includes('/include')) {
                        // Insert include after the last existing unresolved include
                        const splitText = text.split(/\r?\n/);
                        for (let i = splitText.length - 1; i >= 0; i--) {
                            const line = splitText[i].toLocaleLowerCase().trim();
                            if (line.startsWith('/copy') || line.startsWith('/include')) {
                                newIncludesInsert.line = i;
                                newIncludesInsert.character = lineAt(newIncludesInsert.line).length;
                                break;
                            }
                        }
                        newIncludesTextWrap.prefix = `\n`;
                    } else if (testDocs.procedures.length > 0) {
                        // Insert include before the first procedure or prototype
                        const existingProcOrProto = testDocs.procedures.filter(proc => proc.position?.path === testFileLocation.testFileUri.toString());
                        newIncludesInsert.line = Math.min(...existingProcOrProto.map(proc => proc.range.start!));
                        newIncludesInsert.character = 0;
                        newIncludesTextWrap.prefix = ``;
                        newIncludesTextWrap.suffix = `\n\n`;
                    }
                } catch (error) { }
            }
            if (newIncludes.length > 0) {
                const newIncludesPosition = new Position(newIncludesInsert.line, newIncludesInsert.character);
                function insertInclude(text: string) {
                    testStubEdit.insert(
                        testFileLocation!.testFileUri,
                        newIncludesPosition,
                        text,
                        {
                            label: `Add include(s)`,
                            needsConfirmation: testStubPreferences["Show Test Stub Preview"],
                            iconPath: new ThemeIcon('file-code')
                        }
                    );
                }

                // Insert newline prefix
                if (newIncludes.length === 1) {
                    const newIncludeText = `${newIncludesTextWrap.prefix}${newIncludes[0].text}${newIncludesTextWrap.suffix}`;
                    insertInclude(newIncludeText);
                } else {
                    if (newIncludesTextWrap.prefix !== '') {
                        insertInclude(newIncludesTextWrap.prefix);
                    }

                    // Insert includes
                    for (let i = 0; i < newIncludes.length; i++) {
                        const newIncludeText = i !== 0 ? `\n${newIncludes[i].text}` : newIncludes[i].text;
                        insertInclude(newIncludeText);
                    }

                    // Insert newline suffix
                    if (newIncludesTextWrap.suffix !== '') {
                        insertInclude(newIncludesTextWrap.suffix);
                    }
                }
            }
        }

        // Add prototypes
        if (testStubPreferences["Add Prototypes"]) {
            let newPrototypes: { name: string, text: string[] }[] = testCaseSpecs.flatMap(tcs => tcs.prototype ? tcs.prototype : []);
            let newPrototypesInsert: { line: number, character: number } = { line: lastLine, character: lineAt(lastLine).length };
            let newPrototypesTextWrap: { prefix: string, suffix: string } = { prefix: '\n\n', suffix: '' };
            if (testDocs) {
                try {
                    // Filter out prototypes that already exist
                    const existingPrototypes = testDocs.procedures.filter(proc => proc.prototype && proc.position?.path === testFileLocation.testFileUri.toString());
                    newPrototypes = newPrototypes.filter(proto => !existingPrototypes.some(existingProto => existingProto.name === proto.name));

                    if (existingPrototypes.length > 0) {
                        // Insert prototypes after the last existing prototype
                        newPrototypesInsert.line = Math.max(...existingPrototypes.map(proc => proc.range.end!));
                        newPrototypesInsert.character = lineAt(newPrototypesInsert.line).length;
                    } else if (testDocs.procedures.length > 0) {
                        // Insert prototypes before the first procedure
                        const existingProcedures = testDocs.procedures.filter(proc => !proc.prototype && proc.position?.path === testFileLocation.testFileUri.toString());
                        newPrototypesInsert.line = Math.min(...existingProcedures.map(proc => proc.range.start!));
                        newPrototypesInsert.character = 0;
                        newPrototypesTextWrap.prefix = ``;
                        newPrototypesTextWrap.suffix = `\n\n`;
                    }
                } catch (error) { }
            }
            if (newPrototypes.length > 0) {
                const newPrototypesPosition = new Position(newPrototypesInsert.line, newPrototypesInsert.character);
                function insertPrototype(text: string) {
                    testStubEdit.insert(
                        testFileLocation!.testFileUri,
                        newPrototypesPosition,
                        text,
                        {
                            label: `Add prototype(s)`,
                            needsConfirmation: testStubPreferences["Show Test Stub Preview"],
                            iconPath: new ThemeIcon('symbol-method')
                        }
                    );
                }

                if (newPrototypes.length === 1) {
                    const newPrototypeText = `${newPrototypesTextWrap.prefix}${newPrototypes[0].text.join('\n')}${newPrototypesTextWrap.suffix}`;
                    insertPrototype(newPrototypeText);
                } else {
                    // Insert newline prefix
                    if (newPrototypesTextWrap.prefix !== '') {
                        insertPrototype(newPrototypesTextWrap.prefix);
                    }

                    // Insert prototypes
                    for (let i = 0; i < newPrototypes.length; i++) {
                        const newPrototypeText = i !== 0 ? `\n\n${newPrototypes[i].text.join('\n')}` : newPrototypes[i].text.join('\n');
                        insertPrototype(newPrototypeText);
                    }

                    // Insert newline suffix
                    if (newPrototypesTextWrap.suffix !== '') {
                        insertPrototype(newPrototypesTextWrap.suffix);
                    }
                }
            }
        }

        // Add test cases
        let newTestCases: { name: string, text: string[] }[] = testCaseSpecs.flatMap(tcs => tcs.testCase);
        let newTestCasesInsert: { line: number, character: number } = { line: lastLine, character: lineAt(lastLine).length };
        let newTestCasesTextWrap: { prefix: string, suffix: string } = { prefix: '\n\n', suffix: '' };
        if (testDocs) {
            try {
                if (testDocs.procedures.length > 0) {
                    // Insert test case after the last procedure or prototype
                    const existingProcOrProto = testDocs.procedures.filter(proc => proc.position?.path === testFileLocation.testFileUri.toString());
                    newTestCasesInsert.line = Math.max(...existingProcOrProto.map(proc => proc.range.end!));
                    newTestCasesInsert.character = lineAt(newTestCasesInsert.line).length;
                }
            } catch (error) { }
        }
        if (newTestCases.length > 0) {
            const newTestCasesPosition = new Position(newTestCasesInsert.line, newTestCasesInsert.character);
            function insertTestCase(text: string) {
                testStubEdit.insert(
                    testFileLocation!.testFileUri,
                    newTestCasesPosition,
                    text,
                    {
                        label: `Add test case(s)`,
                        needsConfirmation: testStubPreferences["Show Test Stub Preview"],
                        iconPath: new ThemeIcon('beaker')
                    }
                );
            }

            if (newTestCases.length === 1) {
                const newTestCaseText = `${newTestCasesTextWrap.prefix}${newTestCases[0].text.join('\n')}${newTestCasesTextWrap.suffix}`;
                insertTestCase(newTestCaseText);
            } else {
                // Insert newline prefix
                if (newTestCasesTextWrap.prefix !== '') {
                    insertTestCase(newTestCasesTextWrap.prefix);
                }

                // Insert test cases
                for (let i = 0; i < newTestCases.length; i++) {
                    const newTestCaseText = i !== 0 ? `\n\n${newTestCases[i].text.join('\n')}` : newTestCases[i].text.join('\n');
                    insertTestCase(newTestCaseText);
                }

                // Insert newline suffix
                if (newTestCasesTextWrap.suffix !== '') {
                    insertTestCase(newTestCasesTextWrap.suffix);
                }
            }
        }

        const isApplied = await workspace.applyEdit(testStubEdit);
        if (isApplied) {
            return await window.withProgress({ location: ProgressLocation.Window }, async () => {
                if (!testDocument) {
                    testDocument = await workspace.openTextDocument(testFileLocation.testFileUri);
                }

                if (testDocument.isDirty) {
                    await testDocument.save();
                }

                await window.showTextDocument(testDocument);

                if (document.uri.scheme === 'member') {
                    commands.executeCommand("code-for-ibmi.refreshObjectBrowser");
                }

                return testFileLocation.testFileUri;
            });
        }
    }

    async function getTestStubCodeActions(document: TextDocument, docs: Cache, range: Range): Promise<CodeAction[] | undefined> {
        const codeActions: CodeAction[] = [];

        const exportProcedures = docs.procedures.filter(proc => !proc.prototype && proc.keyword[`EXPORT`]);
        if (exportProcedures.length > 0) {
            // Build test file name
            const parsedPath = path.parse(document.uri.fsPath);
            const fileName = parsedPath.base;

            // Test case generation
            const currentProcedure = exportProcedures.find(proc => proc.range.start && proc.range.end && range.start.line >= proc.range.start && range.end.line <= proc.range.end);
            if (currentProcedure) {
                const title = `Generate test case for '${currentProcedure.name}'`;
                const testCaseAction = new CodeAction(title, CodeActionKind.RefactorExtract);
                testCaseAction.command = {
                    title: title,
                    command: `vscode-ibmi-testing.generateTestStub`,
                    arguments: [document, docs, [currentProcedure]]
                };
                codeActions.push(testCaseAction);
            }

            // Test suite generation
            const title = `Generate test suite for '${fileName}'`;
            const testSuiteAction = new CodeAction(title, CodeActionKind.RefactorExtract);
            testSuiteAction.command = {
                title: title,
                command: `vscode-ibmi-testing.generateTestStub`,
                arguments: [document, docs, exportProcedures]
            };
            codeActions.push(testSuiteAction);
        }

        return codeActions;
    }
}