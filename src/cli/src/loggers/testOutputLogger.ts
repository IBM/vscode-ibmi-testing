import { Logger, LogLevel } from "../api/types";
import * as fs from "fs";
import * as path from "path";

export class TestOutputLogger implements Logger {
    private logFile: string;

    constructor(logFile: string) {
        this.logFile = logFile;

        // Ensure the directory exists
        fs.mkdirSync(path.dirname(logFile), { recursive: true });

        // Clear log file if it exists (or create it if not)
        fs.writeFileSync(logFile, "");
    }

    async append(message: string): Promise<void> {
        await this.log(LogLevel.Info, message);
    }

    public async appendWithNotification(level: LogLevel, message: string, details?: string, buttons?: { label: string, func: () => Promise<void> }[]): Promise<void> {
        await this.log(level, details ? `${message}: ${details}` : message);
    }

    async log(level: LogLevel, message: string): Promise<void> {
        if (level === LogLevel.Off) {
            return;
        } else {
            const formattedTimestamp = (new Date()).toISOString().replace("T", " ").replace("Z", "");
            const formattedLevel = LogLevel[level].toLowerCase();
            const formattedMessage = `${formattedTimestamp} [${formattedLevel}] ${message}\n`;
            await fs.promises.appendFile(this.logFile, formattedMessage);
        }
    }

    public show() {
        // Not used
    }
}