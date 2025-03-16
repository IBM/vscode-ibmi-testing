import { LogLevel, LogOutputChannel, window } from "vscode";

export class Logger {
    private static instance: Logger;
    private logOutputChannel: LogOutputChannel;

    private constructor() {
        this.logOutputChannel = window.createOutputChannel('IBM i Testing', { log: true });
    }

    public static getInstance(): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }

        return Logger.instance;
    }

    public log(level: LogLevel, message: string): void {
        switch (level) {
            case LogLevel.Info:
                this.logOutputChannel.info(message);
                break;
            case LogLevel.Warning:
                this.logOutputChannel.warn(message);
                break;
            case LogLevel.Error:
                this.logOutputChannel.error(message);
                break;
        }
    }

    public logWithErrorNotification(level: LogLevel, message: string, error: string): void {
        this.log(level, `${message}: ${error}`);

        window.showErrorMessage(message, 'View Output').then((value) => {
            if (value === 'View Output') {
                this.logOutputChannel.show();
            }
        });
    }
}