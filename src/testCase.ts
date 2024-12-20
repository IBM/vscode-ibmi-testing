import { TestItem } from "vscode";

export class TestCase {
    item: TestItem;

    constructor(item: TestItem) {
        this.item = item;
    }
}