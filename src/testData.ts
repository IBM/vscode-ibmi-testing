import { commands, DocumentSymbol, LogLevel, SymbolKind, TestItem, workspace } from "vscode";
import { testOutputLogger, manager } from "./extension";
import { ApiUtils } from "./api/apiUtils";

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

            // TODO: Remove this?
            // Load test file content
            // try {
            //     const rawContent = await workspace.fs.readFile(this.item.uri!);
            //     const textDecoder = new TextDecoder('utf-8');
            //     this.content = textDecoder.decode(rawContent);
            // } catch (error: any) {
            //     await testOutputLogger.log(LogLevel.Error, `Failed to read test file ${this.item.label}: ${error}`);
            // }

            // Load test cases
            try {
                const rpgleTestCaseRegex = /^TEST.*$/i;
                const cobolTestCaseRegex = /^PROGRAM-ID\. +(TEST.+)$/i;

                const childItems: TestItem[] = [];
                const documentSymbols = await commands.executeCommand<DocumentSymbol[]>(`vscode.executeDocumentSymbolProvider`, this.item.uri) || [];
                for (const documentSymbol of documentSymbols) {
                    const isRPGLE = ApiUtils.isRPGLE(this.item.uri!.fsPath);
                    const isTestCase = isRPGLE ?
                        documentSymbol.kind === SymbolKind.Function && rpgleTestCaseRegex.test(documentSymbol.name) :
                        documentSymbol.kind === SymbolKind.Class && documentSymbol.name.match(cobolTestCaseRegex)?.[1];

                    if (isTestCase) {
                        const testCaseName = isRPGLE ?
                            documentSymbol.name :
                            documentSymbol.name.match(cobolTestCaseRegex)![1];
                        const childUri = this.item.uri!.with({ fragment: testCaseName });
                        const childItem = manager!.createTestItem(childUri.toString(), this.item.uri!, testCaseName, false);
                        childItem.range = documentSymbol.range;

                        const childData = new TestCaseData(childItem, this.rootItem, this.item);
                        manager!.testMap.set(childItem, childData);
                        childItems.push(childItem);
                    }
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