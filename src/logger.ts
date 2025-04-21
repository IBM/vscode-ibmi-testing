import { LogLevel, LogOutputChannel, window } from "vscode";

export class Logger {
    private static logOutputChannel: LogOutputChannel = window.createOutputChannel('IBM i Testing', { log: true });

    public static log(level: LogLevel, message: string): void {
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

    public static logWithNotification(level: LogLevel, message: string, details?: string): void {
        this.log(level, details ? `${message}: ${details}` : message);

        let showMessage;
        switch (level) {
            case LogLevel.Error:
                showMessage = window.showErrorMessage;
                break;
            case LogLevel.Warning:
                showMessage = window.showWarningMessage;
                break;
            default:
                showMessage = window.showInformationMessage;
        }

        showMessage(message, 'View Output').then((value) => {
            if (value === 'View Output') {
                this.logOutputChannel.show();
            }
        });
    }
}