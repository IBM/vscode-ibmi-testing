import { CodeAction, CodeActionKind, commands, Disposable, ExtensionContext, languages, Position, Range, TextDocument, ThemeIcon, Uri, window, workspace, WorkspaceEdit } from "vscode";
import Declaration from "vscode-rpgle/language/models/declaration";
import Cache from "vscode-rpgle/language/models/cache";
import { getInstance } from "../extensions/ibmi";
import { LspUtils, RpgleTypeDetail, RpgleVariableType } from "./lspUtils";
import * as path from "path";
import { ApiUtils } from "../api/apiUtils";
import { Configuration, Section } from "../configuration";

export namespace TestStubCodeActions {
    interface TestCaseSpec {
        includes: { name: string, text: string }[];
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

                const showTestStubPreview = Configuration.getOrFallback<boolean>(Section.showTestStubPreview);

                if (testFileUri.scheme === 'member') {
                    // Check if QTESTSRC exists
                    const parsedPath = connection.parserMemberPath(document.uri.path);
                    const sourceFileExists = await content.checkObject({ library: parsedPath.library, name: 'QTESTSRC', type: '*FILE' });

                    // Prompt user to create QTESTSRC if in preview mode
                    if (showTestStubPreview) {
                        if (!sourceFileExists) {
                            const value = await window.showErrorMessage(`The source file ${parsedPath.library}/QTESTSRC does not exist. Can it be created?`, { modal: true }, 'Yes', 'No');
                            if (value === 'No') {
                                return;
                            }
                        }
                    }

                    // Create QTESTSRC if it does not exist
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

                // Generate test case spec
                const testCaseSpecs = await Promise.all(exportProcedures.map(async proc => await getTestCaseSpec(docs, proc)));

                // Build test stub edit and insert code in appropriate places
                const testStubEdit = new WorkspaceEdit();
                const testDocs = await LspUtils.getDocs(testFileUri);
                let testDocument: TextDocument | undefined;

                // Create test file if it does not exist
                try {
                    testDocument = await workspace.openTextDocument(testFileUri);
                } catch (error) {
                    testStubEdit.createFile(
                        testFileUri,
                        {
                            ignoreIfExists: true
                        },
                        {
                            label: `Create '${testFileName}'`,
                            needsConfirmation: showTestStubPreview,
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
                if (text === '') {
                    const directiveAndControlOptions = [
                        `**free`,
                        ``,
                        `ctl-opt nomain ccsidcvt(*excp) ccsid(*jobrun);`
                    ];

                    testStubEdit.insert(
                        testFileUri,
                        new Position(lastLine, 0),
                        directiveAndControlOptions.join(`\n`),
                        {
                            label: `Add directive and control option(s)`,
                            needsConfirmation: showTestStubPreview,
                            iconPath: new ThemeIcon('symbol-misc')
                        }
                    );
                }

                // Add includes
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
                            newIncludesInsert.line = Math.max(...testDocs.includes.filter(i => i.fromPath === testFileUri.toString()).map(i => i.line));
                            newIncludesInsert.character = lineAt(newIncludesInsert.line).length;
                            newIncludesTextWrap.prefix = `\n`;
                        } else
                        if (text.toLocaleLowerCase().includes('/copy') || text.toLocaleLowerCase().includes('/include')) {
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
                            const existingProcOrProto = testDocs.procedures.filter(proc => proc.position?.path === testFileUri.toString());
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
                            testFileUri,
                            newIncludesPosition,
                            text,
                            {
                                label: `Add include(s)`,
                                needsConfirmation: showTestStubPreview,
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

                // Add prototypes
                let newPrototypes: { name: string, text: string[] }[] = testCaseSpecs.flatMap(tcs => tcs.prototype ? tcs.prototype : []);
                let newPrototypesInsert: { line: number, character: number } = { line: lastLine, character: lineAt(lastLine).length };
                let newPrototypesTextWrap: { prefix: string, suffix: string } = { prefix: '\n\n', suffix: '' };
                if (testDocs) {
                    try {
                        // Filter out prototypes that already exist
                        const existingPrototypes = testDocs.procedures.filter(proc => proc.prototype && proc.position?.path === testFileUri.toString());
                        newPrototypes = newPrototypes.filter(proto => !existingPrototypes.some(existingProto => existingProto.name === proto.name));

                        if (existingPrototypes.length > 0) {
                            // Insert prototypes after the last existing prototype
                            newPrototypesInsert.line = Math.max(...existingPrototypes.map(proc => proc.range.end!));
                            newPrototypesInsert.character = lineAt(newPrototypesInsert.line).length;
                        } else if (testDocs.procedures.length > 0) {
                            // Insert prototypes before the first procedure
                            const existingProcedures = testDocs.procedures.filter(proc => !proc.prototype && proc.position?.path === testFileUri.toString());
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
                            testFileUri,
                            newPrototypesPosition,
                            text,
                            {
                                label: `Add prototype(s)`,
                                needsConfirmation: showTestStubPreview,
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

                // Add test cases
                let newTestCases: { name: string, text: string[] }[] = testCaseSpecs.flatMap(tcs => tcs.testCase);
                let newTestCasesInsert: { line: number, character: number } = { line: lastLine, character: lineAt(lastLine).length };
                let newTestCasesTextWrap: { prefix: string, suffix: string } = { prefix: '\n\n', suffix: '' };
                if (testDocs) {
                    try {
                        if (testDocs.procedures.length > 0) {
                            // Insert test case after the last procedure or prototype
                            const existingProcOrProto = testDocs.procedures.filter(proc => proc.position?.path === testFileUri.toString());
                            newTestCasesInsert.line = Math.max(...existingProcOrProto.map(proc => proc.range.end!));
                            newTestCasesInsert.character = lineAt(newTestCasesInsert.line).length;
                        }
                    } catch (error) { }
                }
                if (newTestCases.length > 0) {
                    const newTestCasesPosition = new Position(newTestCasesInsert.line, newTestCasesInsert.character);
                    function insertTestCase(text: string) {
                        testStubEdit.insert(
                            testFileUri,
                            newTestCasesPosition,
                            text,
                            {
                                label: `Add test case(s)`,
                                needsConfirmation: showTestStubPreview,
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
                    if (!testDocument) {
                        testDocument = await workspace.openTextDocument(testFileUri);
                    }
                    await window.showTextDocument(testDocument);
                }
            })
        );
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
            };
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
        const allIncludes = [{ name: rpgUnitInclude, text: rpgUnitIncludeText }, ...inputIncludes, ...returnIncludes];
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

    async function getPrototype(procedure: Declaration): Promise<{ name: string, text: string[] } | undefined> {
        for (const reference of procedure.references) {
            const docs = await LspUtils.getDocs(Uri.parse(reference.uri));
            if (docs) {
                const prototype = docs.procedures.some(proc => proc.prototype && proc.name === procedure.name);
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

    function getIncludes(detail: RpgleTypeDetail): { name: string, text: string }[] {
        const includes: { name: string, text: string }[] = [];

        if (detail.reference) {
            const structUri = Uri.parse(detail.reference.position.path);

            if (structUri.scheme === 'file') {
                const workspaceFolder = workspace.getWorkspaceFolder(structUri);
                if (workspaceFolder) {
                    const newInclude = `'${asPosix(path.relative(workspaceFolder.uri.fsPath, structUri.fsPath))}'`;
                    const newIncludeText = `/include ${newInclude}`;

                    if (!includes.some(include => include.text === newIncludeText)) {
                        includes.push({ name: newInclude, text: newIncludeText });
                    }
                }
            } else {
                const ibmi = getInstance();
                const connection = ibmi!.getConnection();
                const parsedPath = connection.parserMemberPath(structUri.path);
                const newInclude = `${parsedPath.file},${parsedPath.name}`;
                const newIncludeText = `/include ${newInclude}`;

                if (!includes.some(include => include.text === newIncludeText)) {
                    includes.push({ name: newInclude, text: newIncludeText });
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