import { Logger, LogLevel } from "../api/types";

export class TestResultLogger implements Logger {
    constructor() { }

    async append(message: string): Promise<void> {
        console.log(message);
    }

    async log(level: LogLevel, message: string): Promise<void> {
        //  Not used
    }

    async appendWithNotification(level: LogLevel, message: string, details?: string, buttons?: { label: string; func: () => Promise<void>; }[]): Promise<void> {
        // Not used
    }
}