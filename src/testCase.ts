import { Location, TestItem, TestMessage, TestRun } from "vscode";

export class TestCase {
    async run(item: TestItem, run: TestRun) {
        const start = Date.now();

        const actual: number = 1;
        const expected: number = 2;

        const end = Date.now();
        const duration = end - start;

        if (actual === expected) {
            run.passed(item, duration);
        } else {
            const message = TestMessage.diff(`Expected ${expected}`, String(expected), String(actual));
            message.location = new Location(item.uri!, item.range!);
            run.failed(item, message, duration);
        }
    }
}