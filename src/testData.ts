import { commands, DocumentSymbol, LogLevel, Position, Range, SymbolKind, TestItem, workspace } from "vscode";
import { testOutputLogger, manager } from "./extension";
import { ApiUtils } from "./cli/src/api/apiUtils";
import Parser from "vscode-rpgle/language/parser";
import { getInstance } from "./extensions/ibmi";
import * as fs from "fs";

export type TestType = 'directory' | 'object' | 'file' | 'case';

export class TestData {
    item: TestItem;
    type: TestType;

    constructor(item: TestItem, type: TestType) {
        this.item = item;
        this.type = type;
    }
}

export class TestFileData extends TestData {
    rootItem: TestItem;
    isLoaded: boolean;
    isCompiled: boolean;

    constructor(item: TestItem, rootItem: TestItem) {
        super(item, 'file');
        this.rootItem = rootItem;
        this.isLoaded = false;
        this.isCompiled = false;
    }

    async load(): Promise<void> {
        if (!this.isLoaded) {
            this.isLoaded = true;

            try {
                // Get test procedures for this file
                const testProcedures: { name: string, range: Range }[] = [];
                const isRPGLE = ApiUtils.isRPGLE(this.item.uri!.fsPath);
                if (isRPGLE) {
                    const ibmi = getInstance();
                    const connection = ibmi!.getConnection();

                    // Read file
                    let memberContent: string;
                    if (this.item.uri!.scheme === 'file') {
                        memberContent = fs.readFileSync(this.item.uri!.fsPath, 'utf8');
                    } else {
                        const parsedPath = connection.parserMemberPath(this.item.uri!.path);
                        memberContent = await ApiUtils.readMember(parsedPath.library, parsedPath.file, parsedPath.name);
                    }

                    // Parse file
                    const parser = new Parser();
                    const parsedContent = await parser.getDocs(this.item.uri!.path, memberContent, { collectReferences: false, withIncludes: false });

                    // Find RPGLE test procedures
                    const rpgleTestCaseRegex = /^TEST.*$/i;
                    for (const procedure of parsedContent.procedures) {
                        if (rpgleTestCaseRegex.test(procedure.name)) {
                            testProcedures.push({
                                name: procedure.name,
                                range: new Range(new Position(procedure.range.start, 0), new Position(procedure.range.end, 0))
                            });
                        }
                    }
                } else {
                    // Find COBOL test procedures
                    const documentSymbols = await commands.executeCommand<DocumentSymbol[]>(`vscode.executeDocumentSymbolProvider`, this.item.uri) || [];
                    const cobolTestCaseRegex = /^PROGRAM-ID\. +(TEST.+)$/i;
                    for (const documentSymbol of documentSymbols) {
                        if (documentSymbol.kind === SymbolKind.Class) {
                            const matches = documentSymbol.name.match(cobolTestCaseRegex);
                            if (matches && matches.length >= 1) {
                                testProcedures.push({
                                    name: matches[1],
                                    range: documentSymbol.range
                                });
                            }

                        }
                    }
                }

                const childItems: TestItem[] = [];
                for (const testProcedure of testProcedures) {
                    const childUri = this.item.uri!.with({ fragment: testProcedure.name });
                    const childItem = manager!.createTestItem(childUri.toString(), this.item.uri!, testProcedure.name, false);
                    childItem.range = testProcedure.range;

                    const childData = new TestCaseData(childItem, this.rootItem, this.item);
                    manager!.testMap.set(childItem, childData);
                    childItems.push(childItem);
                }
                this.item.children.replace(childItems);

                await testOutputLogger.log(LogLevel.Info, `Loaded test file ${this.item.label} with ${childItems.length} test cases: ${childItems.map(item => item.label).join(', ')}`);
            } catch (error) {
                await testOutputLogger.log(LogLevel.Error, `Failed to load test cases from ${this.item.label}: ${error}`);
            }
        }
    }
}

export class TestCaseData extends TestData {
    rootItem: TestItem;
    fileItem: TestItem;

    constructor(item: TestItem, rootItem: TestItem, fileItem: TestItem) {
        super(item, 'case');
        this.rootItem = rootItem;
        this.fileItem = fileItem;
    }
}