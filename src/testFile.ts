import { commands, DocumentSymbol, SymbolKind, TestItem, workspace } from "vscode";
import { TestCase } from "./testCase";
import { IBMiTestManager } from "./manager";

export class TestFile {
    didLoadTestCases: boolean = false;

    async loadTestCases(manager: IBMiTestManager, item: TestItem) {
        this.didLoadTestCases = true;

        const childItems: TestItem[] = [];

        const documentSymbols = await commands.executeCommand<DocumentSymbol[]>(`vscode.executeDocumentSymbolProvider`, item.uri) || [];
        for (const documentSymbol of documentSymbols) {
            if (documentSymbol.kind === SymbolKind.Function && documentSymbol.name.startsWith('test')) {
                const childItem = manager.controller.createTestItem(`${item.uri}/${documentSymbol.name}`, documentSymbol.name, item.uri);
                childItem.range = documentSymbol.range;
                const data = new TestCase();

                manager.testData.set(childItem, data);
                childItems.push(childItem);
            }
        }

        item.children.replace(childItems);
    }
}