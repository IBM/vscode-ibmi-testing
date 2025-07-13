import { Logger, LogLevel } from "../api/types";
import * as fs from "fs";
import * as path from "path";

export class TestOutputLogger implements Logger {
    private logPath: string;

    constructor(logPath: string) {
        this.logPath = logPath;
        fs.mkdirSync(path.dirname(logPath), { recursive: true });
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
            await fs.promises.appendFile(this.logPath, formattedMessage);
        }
    }

    public show() {
        // Not used
    }
}