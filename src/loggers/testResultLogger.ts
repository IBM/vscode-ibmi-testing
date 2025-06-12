import { TestRun } from "vscode";
import { Logger, LogLevel } from "../api/types";

export class TestResultLogger implements Logger {
    private testRun: TestRun;

    constructor(testRun: TestRun) {
        this.testRun = testRun;
    }

    async append(message: string): Promise<void> {
        this.testRun.appendOutput(message);
    }

    async log(level: LogLevel, message: string): Promise<void> {
        //  Not used
    }

    async logWithNotification(level: LogLevel, message: string, details?: string, buttons?: { label: string; func: () => Promise<void>; }[]): Promise<void> {
        // Not used
    }
}