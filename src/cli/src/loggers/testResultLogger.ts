import { Logger, LogLevel } from "../api/types";

export class TestResultLogger implements Logger {
    constructor() { }

    async append(message: string): Promise<void> {
        if (message.endsWith('\r\n')) {
            message = message.slice(0, -2);
        } else if (message.endsWith('\n')) {
            message = message.slice(0, -1);
        }

        console.log(message);
    }

    async log(level: LogLevel, message: string): Promise<void> {
        //  Not used
    }

    async appendWithNotification(level: LogLevel, message: string, details?: string, buttons?: { label: string; func: () => Promise<void>; }[]): Promise<void> {
        // Not used
    }
}