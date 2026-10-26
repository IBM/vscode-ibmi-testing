import { TestRun } from "vscode";
import { Logger, LogLevel, LogStorage } from "../../api/types";
import c from "ansi-colors";

export class TestResultLogger implements Logger {
    private testRun: TestRun;
    private logStorage: LogStorage;

    constructor(testRun: TestRun) {
        this.testRun = testRun;
        this.logStorage = {
            shouldStore: true,
            logs: []
        };
    }

    async append(message: string): Promise<void> {
        this.testRun.appendOutput(message);

        if(this.logStorage.shouldStore) {
            this.logStorage.logs.push(c.unstyle(message));
        }
    }

    async log(level: LogLevel, message: string): Promise<void> {
        //  Not used
    }

    async appendWithNotification(level: LogLevel, message: string, details?: string, buttons?: { label: string; func: () => Promise<void>; }[]): Promise<void> {
        // Not used
    }

    public getStoredLogs(): LogStorage {
        return this.logStorage;
    }
}