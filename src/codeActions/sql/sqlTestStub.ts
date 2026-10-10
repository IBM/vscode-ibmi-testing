import {
    CodeAction,
    CodeActionKind,
    commands,
    ExtensionContext,
    languages,
    Position,
    ProgressLocation,
    Range,
    TextDocument,
    ThemeIcon,
    Uri,
    window,
    workspace,
    WorkspaceEdit
} from "vscode";
import Document from "vscode-db2i/src/language/sql/document";
import { StatementType } from "vscode-db2i/src/language/sql/types";
import { getInstance } from "../../extensions/ibmi";
import { SqlTestStubGenerator, FunctionType, RoutineSignature, RoutineType, SysRoutineRow } from "./sqlTestStubGenerator";
import { RpgLspUtils } from "../rpg/rpgLspUtils";
import { Configuration, Section, TestStubPreferences } from "../../configuration";
import IBMi from "@halcyontech/vscode-ibmi-types/api/IBMi";

export namespace SqlTestStub {
    export function registerCodeActions(context: ExtensionContext) {
        context.subscriptions.push(
            languages.registerCodeActionsProvider({ language: 'sql' },
                {
                    async provideCodeActions(document, range) {
                        const codeActions: CodeAction[] = [];

                        const ibmi = getInstance();
                        const connection = ibmi?.getConnection();
                        if (connection && document) {
                            const sqlCodeActions = await getCodeActions(connection, document, range);
                            if (sqlCodeActions) {
                                codeActions.push(...sqlCodeActions);
                            }
                        }

                        return codeActions;
                    }
                }
            ),
            commands.registerCommand('vscode-ibmi-testing.sqlGenerateTestStub', generateTestStub)
        );
    }

    async function getCodeActions(connection: IBMi, document: TextDocument, range: Range): Promise<CodeAction[] | undefined> {
        const codeActions: CodeAction[] = [];

        const documentText = document.getText();
        const sqlDocument = new Document(documentText);
        const offset = document.offsetAt(range.start);

        // Use statement groups so the full compound CREATE...BEGIN...END is treated as one unit
        const group = sqlDocument.getGroupByOffset(offset);
        if (!group || group.statements.length === 0) {
            return codeActions;
        }

        // The first statement in the group is the CREATE
        const createStatement = group.statements[0];
        if (createStatement.type !== StatementType.Create) {
            return codeActions;
        }

        const refs = createStatement.getObjectReferences();
        const ref = refs[0];
        if (!ref) {
            return codeActions;
        }

        const createType = ref.createType?.toLocaleUpperCase();
        if (createType !== `FUNCTION` && createType !== `PROCEDURE`) {
            return codeActions;
        }

        const schema = ref.object.schema;
        const name = ref.object.name;
        if (!name) {
            return codeActions;
        }

        const title = `Generate test case for '${name}'`;
        const testCaseAction = new CodeAction(title, CodeActionKind.RefactorExtract);
        testCaseAction.command = {
            title,
            command: `vscode-ibmi-testing.sqlGenerateTestStub`,
            arguments: [connection, document, schema, name, createType]
        };
        codeActions.push(testCaseAction);

        return codeActions;
    }

    async function generateTestStub(connection: IBMi, document: TextDocument, schema: string | undefined, name: string, routineType: RoutineType, forcePreferences?: Partial<TestStubPreferences>): Promise<Uri | undefined> {
        // Get test stub generation preferences
        const testStubPreferences = {
            ...Configuration.getOrFallback<TestStubPreferences>(Section.testStubPreferences),
            ...forcePreferences
        };

        schema = schema ? connection.upperCaseName(schema) : schema;
        name = connection.upperCaseName(name);

        // Prompt user for SCHEMA.NAME
        const prefill = schema
            ? `${schema}.${name}`
            : name;
        const userInput = await window.showInputBox({
            title: `Qualify object`,
            prompt: `Enter the qualified object as SCHEMA.NAME`,
            placeHolder: `MYSCHEMA.${name}`,
            value: prefill,
            validateInput: (value) => {
                const splitValue = value.split(`.`);
                if (splitValue.length === 2) {
                    const schema = splitValue[0];
                    const name = splitValue[0];
                    if (connection.validQsysName(schema) && connection.validQsysName(name)) {
                        return null;
                    }
                }

                const example = routineType === `FUNCTION` ? `MYFUNC` : `MYPROC`;
                return `Invalid format. Expected SCHEMA.NAME (e.g. MYSCHEMA.${example})`;
            }
        });
        if (!userInput) {
            return;
        }

        const splitValue = userInput.split(`.`);
        schema = connection.upperCaseName(splitValue[0]);
        name = connection.upperCaseName(splitValue[1]);

        // Build test file name, parent name (directory or source file) and URI
        const testFileLocation = await SqlTestStubGenerator.generateTestStubLocation(document.uri, name, connection);
        if (!testFileLocation) {
            return;
        }

        if (testFileLocation.testFileUri.scheme === 'member' && connection) {
            const content = connection.getContent();

            // Check if test source file exists
            const parsedPath = connection.parserMemberPath(document.uri.path);
            const sourceFileExists = await content.checkObject({
                library: parsedPath.library,
                name: testFileLocation.testFileParentName,
                type: '*FILE'
            });

            // Prompt user to create test source file if in preview mode
            if (testStubPreferences["Show Test Stub Preview"]) {
                if (!sourceFileExists) {
                    const value = await window.showErrorMessage(
                        `The source file ${parsedPath.library}/${testFileLocation.testFileParentName} does not exist. Can it be created?`,
                        { modal: true }, 'Yes', 'No'
                    );
                    if (value === 'No') {
                        return;
                    }
                }
            }

            // Create test source file if it does not exist
            if (!sourceFileExists) {
                const createFile = await connection.runCommand({
                    command: `QSYS/CRTSRCPF FILE(${parsedPath.library}/${testFileLocation.testFileParentName}) RCDLEN(112)`,
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

        // Check the routine exists
        let routineRows: SysRoutineRow[];
        try {
            routineRows = await SqlTestStubGenerator.getRoutineRows(connection, schema, name, routineType);
        } catch (error: any) {
            window.showErrorMessage(error?.message ?? String(error), { modal: true });
            return;
        }

        // If multiple overloads exist, let the user pick one using the specific name
        let specificName: string;
        if (routineRows.length === 0) {
            window.showErrorMessage(
                `${schema}.${name} does not exist as a ${routineType.toLocaleLowerCase()}. Create it and try again.`,
                { modal: true }
            );
            return;
        } else if (routineRows.length === 1) {
            specificName = routineRows[0].SPECIFIC_NAME;
        } else {
            const selectedRoutine = await window.showQuickPick(
                routineRows.map(r => ({ label: r.SPECIFIC_NAME, description: r.ROUTINE_CREATED })),
                {
                    title: `Select ${schema}.${name} overload`,
                    prompt: `Multiple overloads of ${schema}.${name} were found. Select one using the ${routineType.toLocaleLowerCase()}'s specific name`,
                    placeHolder: `Specific Name`
                }
            );
            if (!selectedRoutine) {
                return;
            }
            specificName = selectedRoutine.label;
        }

        // Fetch parameters and returns
        let routineSignature: RoutineSignature;
        try {
            routineSignature = await SqlTestStubGenerator.getSignaturesFor(connection, schema, specificName);
        } catch (error: any) {
            window.showErrorMessage(
                error?.message ?? String(error),
                { modal: true }
            );
            return;
        }

        // For functions, determine the function type
        let functionType: FunctionType | undefined;
        if (routineType === `FUNCTION`) {
            try {
                functionType = await SqlTestStubGenerator.getFunctionType(connection, schema, specificName);
            } catch (error: any) {
                window.showErrorMessage(
                    error?.message ?? String(error),
                    { modal: true }
                );
                return;
            }
        }

        // Generate test case spec
        const spec = SqlTestStubGenerator.generateTestCaseSpec(schema, name, routineType, routineSignature, functionType);

        // Build test stub edit and insert code in appropriate places
        const testStubEdit = new WorkspaceEdit();
        const testDocs = await RpgLspUtils.getDocs(testFileLocation.testFileUri);
        let testDocument: TextDocument | undefined;

        // Create test file if it does not exist
        try {
            await workspace.fs.stat(testFileLocation.testFileUri);
            testDocument = await workspace.openTextDocument(testFileLocation.testFileUri);
        } catch {
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

        // Create test configuration
        let testConfig: { uri: Uri; content: string } | undefined;
        if (testStubPreferences["Generate Default Test Configuration"]) {
            testConfig = await SqlTestStubGenerator.generateTestConfig(document.uri, testFileLocation.testFileUri, connection ?? undefined);
            if (testConfig) {
                testStubEdit.createFile(
                    testConfig.uri,
                    {
                        ignoreIfExists: true
                    },
                    {
                        label: `Create 'testing.json'`,
                        needsConfirmation: testStubPreferences["Show Test Stub Preview"],
                        iconPath: new ThemeIcon('settings-gear')
                    }
                );
                testStubEdit.insert(
                    testConfig.uri,
                    new Position(0, 0),
                    testConfig.content,
                    {
                        label: `Add default testing configuration`,
                        needsConfirmation: testStubPreferences["Show Test Stub Preview"],
                        iconPath: new ThemeIcon('settings-gear')
                    }
                );
            }
        }

        const text = testDocument ? testDocument.getText() : '';
        const lastLine = testDocument ? testDocument.lineCount - 1 : 0;
        const lastLineLen = testDocument ? testDocument.lineAt(lastLine).text.length : 0;
        function lineAt(line: number): string {
            return testDocument ? testDocument.lineAt(line).text : '';
        }

        // Add directive and control options
        if (testStubPreferences["Add Control Options and Directives"] && text === '') {
            const header = [
                `**free`,
                ``,
                `ctl-opt nomain ccsidcvt(*excp) ccsid(*char : *jobrun);`,
                ``,
                `exec sql`,
                `  set option commit = *none;`
            ].join(`\n`);

            testStubEdit.insert(
                testFileLocation.testFileUri,
                new Position(lastLine, 0),
                header,
                {
                    label: `Add directive and control option(s)`,
                    needsConfirmation: testStubPreferences["Show Test Stub Preview"],
                    iconPath: new ThemeIcon('symbol-misc')
                }
            );
        }

        // Add includes
        const testcaseInclude = { name: `qinclude,TESTCASE`, text: `/include qinclude,TESTCASE` };
        if (testStubPreferences["Add Includes"]) {
            const alreadyIncluded =
                text.toLocaleLowerCase().includes(`/include ${testcaseInclude.name}`.toLocaleLowerCase()) ||
                text.toLocaleLowerCase().includes(`/copy ${testcaseInclude.name}`.toLocaleLowerCase());

            if (!alreadyIncluded) {
                let insertLine = lastLine;
                let insertCharacter = lineAt(lastLine).length;
                let prefix = `\n\n`;
                let suffix = ``;

                if (testDocs) {
                    try {
                        if (testDocs.includes.length > 0) {
                            // Insert after the last existing resolved include
                            insertLine = Math.max(...testDocs.includes.filter(i => i.fromPath === testFileLocation.testFileUri.toString()).map(i => i.line));
                            insertCharacter = lineAt(insertLine).length;
                            prefix = `\n`;
                        } else if (text.toLocaleLowerCase().includes('/copy') || text.toLocaleLowerCase().includes('/include')) {
                            // Insert after the last existing unresolved include
                            const splitText = text.split(/\r?\n/);
                            for (let i = splitText.length - 1; i >= 0; i--) {
                                const line = splitText[i].toLocaleLowerCase().trim();
                                if (line.startsWith('/copy') || line.startsWith('/include')) {
                                    insertLine = i;
                                    insertCharacter = lineAt(insertLine).length;
                                    break;
                                }
                            }
                            prefix = `\n`;
                        } else if (testDocs.procedures.length > 0) {
                            // Insert before the first procedure or prototype
                            const existingProcOrProto = testDocs.procedures.filter(proc => proc.position?.path === testFileLocation.testFileUri.toString());
                            insertLine = Math.min(...existingProcOrProto.map(proc => proc.range.start!));
                            insertCharacter = 0;
                            prefix = ``;
                            suffix = `\n\n`;
                        }
                    } catch (error) { }
                }

                testStubEdit.insert(
                    testFileLocation.testFileUri,
                    new Position(insertLine, insertCharacter),
                    `${prefix}${testcaseInclude.text}${suffix}`,
                    {
                        label: `Add include(s)`,
                        needsConfirmation: testStubPreferences["Show Test Stub Preview"],
                        iconPath: new ThemeIcon('file-code')
                    }
                );
            }
        }

        // Add data structure if not already present
        if (spec.dataStructure) {
            const existingStructs = testDocs?.structs.filter(s => s.position?.path === testFileLocation.testFileUri.toString()) ?? [];
            const alreadyExists = existingStructs.some(s => s.name.toLocaleUpperCase() === spec.dataStructure!.name.toLocaleUpperCase());

            if (!alreadyExists) {
                let dsInsertLine = lastLine;
                let dsInsertCharacter = lastLineLen;
                let dsPrefix = `\n\n`;
                let dsSuffix = ``;

                if (testDocs) {
                    try {
                        if (existingStructs.length > 0) {
                            // Insert after the last existing data structure
                            dsInsertLine = Math.max(...existingStructs.map(s => s.range.end!));
                            dsInsertCharacter = lineAt(dsInsertLine).length;
                        } else if (testDocs.procedures.filter(p => p.position?.path === testFileLocation.testFileUri.toString()).length > 0) {
                            // Insert before the first procedure or prototype
                            const existingProcOrProto = testDocs.procedures.filter(p => p.position?.path === testFileLocation.testFileUri.toString());
                            dsInsertLine = Math.min(...existingProcOrProto.map(p => p.range.start!));
                            dsInsertCharacter = 0;
                            dsPrefix = ``;
                            dsSuffix = `\n\n`;
                        } else if (testDocs.includes.length > 0) {
                            // Insert after the last include
                            dsInsertLine = Math.max(...testDocs.includes.filter(i => i.fromPath === testFileLocation.testFileUri.toString()).map(i => i.line));
                            dsInsertCharacter = lineAt(dsInsertLine).length;
                        }
                    } catch (error) { }
                }

                testStubEdit.insert(
                    testFileLocation.testFileUri,
                    new Position(dsInsertLine, dsInsertCharacter),
                    `${dsPrefix}${spec.dataStructure.text.join('\n')}${dsSuffix}`,
                    {
                        label: `Add data structure(s)`,
                        needsConfirmation: testStubPreferences["Show Test Stub Preview"],
                        iconPath: new ThemeIcon('symbol-struct')
                    }
                );
            }
        }

        // Add test cases
        let testCaseInsertLine = lastLine;
        let testCaseInsertCharacter = lastLineLen;

        const baseProcName = `test_${spec.testCase.name.replace(/[^a-zA-Z0-9_]/g, '_').toLocaleLowerCase()}`;
        let finalProcName = baseProcName;
        if (testDocs) {
            try {
                if (testDocs.procedures.length > 0) {
                    // Insert test case after the last procedure or prototype
                    const existingProcOrProto = testDocs.procedures.filter(proc => proc.position?.path === testFileLocation.testFileUri.toString());
                    testCaseInsertLine = Math.max(...existingProcOrProto.map(proc => proc.range.end!));
                    testCaseInsertCharacter = lineAt(testCaseInsertLine).length;
                }

                // Rename if a proc with the same name already exists by appending _1, _2, _3, ...
                const existingProcNames = new Set(testDocs.procedures.map(proc => proc.name.toLocaleLowerCase()));
                if (existingProcNames.has(baseProcName.toLocaleLowerCase())) {
                    let suffix = 1;
                    while (existingProcNames.has(`${baseProcName}_${suffix}`.toLocaleLowerCase())) {
                        suffix++;
                    }
                    finalProcName = `${baseProcName}_${suffix}`;
                }
            } catch (error) { }
        }

        const testCaseLines = spec.testCase.text.map(line =>
            line === `dcl-proc ${baseProcName} export;` ? `dcl-proc ${finalProcName} export;` : line
        );
        const testCaseText = `\n\n${testCaseLines.join('\n')}`;

        testStubEdit.insert(
            testFileLocation.testFileUri,
            new Position(testCaseInsertLine, testCaseInsertCharacter),
            testCaseText,
            {
                label: `Add test case(s)`,
                needsConfirmation: testStubPreferences["Show Test Stub Preview"],
                iconPath: new ThemeIcon('beaker')
            }
        );

        const isApplied = await workspace.applyEdit(testStubEdit);
        if (isApplied) {
            return await window.withProgress({ location: ProgressLocation.Window }, async () => {
                if (testConfig) {
                    const testConfigDocument = await workspace.openTextDocument(testConfig.uri);
                    if (testConfigDocument.isDirty) {
                        await testConfigDocument.save();
                    }
                    await window.showTextDocument(testConfigDocument, { preview: false });
                }

                if (!testDocument) {
                    testDocument = await workspace.openTextDocument(testFileLocation.testFileUri);
                }
                if (testDocument.isDirty) {
                    await testDocument.save();
                }
                await window.showTextDocument(testDocument, { preview: false });

                if (document.uri.scheme === 'member') {
                    commands.executeCommand("code-for-ibmi.refreshObjectBrowser");
                }

                return testFileLocation.testFileUri;
            });
        }
    }
}
