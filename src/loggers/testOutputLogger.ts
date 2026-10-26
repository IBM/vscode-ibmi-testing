import { LogOutputChannel, window } from "vscode";
import { Logger, LogLevel, LogStorage } from "../../api/types";

export class TestOutputLogger implements Logger {
    private logOutputChannel: LogOutputChannel;
    private logStorage: LogStorage;

    constructor() {
        this.logOutputChannel = window.createOutputChannel('IBM i Testing', { log: true });
        this.logStorage = {
            shouldStore: false,
            logs: []
        };
    }

    async append(message: string): Promise<void> {
        await this.log(LogLevel.Info, message);
    }

    public async appendWithNotification(level: LogLevel, message: string, details?: string, buttons?: { label: string, func: () => Promise<void> }[]): Promise<void> {
        await this.log(level, details ? `${message}: ${details}` : message);

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

        const buttonLabels = (buttons ? buttons.map((button) => button.label) : []);
        const items = ['View Output', ...buttonLabels];
        showMessage(message, ...items).then((value) => {
            if (value === 'View Output') {
                this.logOutputChannel.show();
            } else if (value !== undefined && buttons) {
                const selectedButton = buttons.find(button => button.label === value);
                if (selectedButton) {
                    selectedButton.func();
                }
            }
        });
    }

    async log(level: LogLevel, message: string): Promise<void> {

        let storedLog: string | undefined;
        switch (level) {
            case LogLevel.Trace:
                this.logOutputChannel.trace(message);
                storedLog = `[trace] ${message}`;
                break;
            case LogLevel.Debug:
                this.logOutputChannel.debug(message);
                storedLog = `[debug] ${message}`;
                break;
            case LogLevel.Info:
                this.logOutputChannel.info(message);
                storedLog = `[info] ${message}`;
                break;
            case LogLevel.Warning:
                this.logOutputChannel.warn(message);
                storedLog = `[warning] ${message}`;
                break;
            case LogLevel.Error:
                this.logOutputChannel.error(message);
                storedLog = `[error] ${message}`;
                break;
        }

        if (this.logStorage.shouldStore && storedLog) {
            this.logStorage.logs.push(storedLog);
        }
    }

    public show() {
        this.logOutputChannel.show();
    }

    public getStoredLogs(): LogStorage {
        return this.logStorage;
    }

    public setStoredLogs(logStorage: LogStorage) {
        this.logStorage = logStorage;
    }
}