import { Logger, LogLevel } from "../../../api/types";
import * as fs from "fs";
import * as path from "path";
import c from "ansi-colors";

export class TestResultLogger implements Logger {
    private logFile: string | undefined;

    constructor(logFile: string | undefined) {
        this.logFile = logFile;

        if (this.logFile) {
            fs.mkdirSync(path.dirname(logFile), { recursive: true });
            fs.writeFileSync(logFile, '');
        }
    }

    async append(message: string): Promise<void> {
        process.stdout.write(message);

        if (this.logFile) {
            const strippedMessage = c.stripColor(message);
            await fs.promises.appendFile(this.logFile, strippedMessage);
        }
    }

    async log(level: LogLevel, message: string): Promise<void> {
        //  Not used
    }

    async appendWithNotification(level: LogLevel, message: string, details?: string, buttons?: { label: string; func: () => Promise<void>; }[]): Promise<void> {
        // Not used
    }
}