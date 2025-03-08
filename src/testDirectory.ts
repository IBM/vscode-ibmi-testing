import { TestItem } from "vscode";

export class TestDirectory {
    item: TestItem;

    constructor(item: TestItem) {
        this.item = item;
    }
}