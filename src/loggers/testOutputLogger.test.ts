import { window } from "vscode";
import { TestOutputLogger } from "./testOutputLogger";
import { LogLevel } from "../../api/types";

// Mock the vscode module
jest.mock("vscode", () => ({
    window: {
        createOutputChannel: jest.fn(),
        showErrorMessage: jest.fn().mockResolvedValue(undefined),
        showWarningMessage: jest.fn().mockResolvedValue(undefined),
        showInformationMessage: jest.fn().mockResolvedValue(undefined),
    },
}));

// Mock the LogOutputChannel interface
const mockLogOutputChannel = {
    trace: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    show: jest.fn(),
};

describe("TestOutputLogger", () => {
    let testOutputLogger: TestOutputLogger;

    beforeEach(() => {
        // Reset mocks before each test
        jest.clearAllMocks();

        // Mock the createOutputChannel function to return our mock channel
        (window.createOutputChannel as jest.Mock).mockReturnValue(mockLogOutputChannel);

        testOutputLogger = new TestOutputLogger();
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe("constructor", () => {
        it("should create an output channel named 'IBM i Testing'", () => {
            expect(window.createOutputChannel).toHaveBeenCalledWith("IBM i Testing", { log: true });
        });
    });

    describe("append", () => {
        it("should call log with Info level", async () => {
            const message = "test message";
            
            await testOutputLogger.append(message);
            
            expect(mockLogOutputChannel.info).toHaveBeenCalledWith(message);
        });
    });

    describe("log", () => {
        it("should call trace for Trace level", async () => {
            const message = "trace message";
            await testOutputLogger.log(LogLevel.Trace, message);
            expect(mockLogOutputChannel.trace).toHaveBeenCalledWith(message);
        });

        it("should call debug for Debug level", async () => {
            const message = "debug message";
            await testOutputLogger.log(LogLevel.Debug, message);
            expect(mockLogOutputChannel.debug).toHaveBeenCalledWith(message);
        });

        it("should call info for Info level", async () => {
            const message = "info message";
            await testOutputLogger.log(LogLevel.Info, message);
            expect(mockLogOutputChannel.info).toHaveBeenCalledWith(message);
        });

        it("should call warn for Warning level", async () => {
            const message = "warning message";
            await testOutputLogger.log(LogLevel.Warning, message);
            expect(mockLogOutputChannel.warn).toHaveBeenCalledWith(message);
        });

        it("should call error for Error level", async () => {
            const message = "error message";
            await testOutputLogger.log(LogLevel.Error, message);
            expect(mockLogOutputChannel.error).toHaveBeenCalledWith(message);
        });
    });

    describe("appendWithNotification", () => {
        let message: string;
        let details: string;

        beforeEach(() => {
            message = "test message";
            details = "test details";
        });

        it("should call log with Info level and combined message when details provided", async () => {
            await testOutputLogger.appendWithNotification(LogLevel.Info, message, details);
            
            expect(mockLogOutputChannel.info).toHaveBeenCalledWith(`${message}: ${details}`);
        });

        it("should call log with Info level and just message when no details provided", async () => {
            await testOutputLogger.appendWithNotification(LogLevel.Info, message);
            
            expect(mockLogOutputChannel.info).toHaveBeenCalledWith(message);
        });

        it("should show error message for Error level", async () => {
            const mockShowErrorMessage = (window.showErrorMessage as jest.Mock).mockResolvedValue(undefined);
            
            await testOutputLogger.appendWithNotification(LogLevel.Error, message);
            
            expect(mockShowErrorMessage).toHaveBeenCalledWith(message, "View Output");
        });

        it("should show warning message for Warning level", async () => {
            const mockShowWarningMessage = (window.showWarningMessage as jest.Mock).mockResolvedValue(undefined);
            
            await testOutputLogger.appendWithNotification(LogLevel.Warning, message);
            
            expect(mockShowWarningMessage).toHaveBeenCalledWith(message, "View Output");
        });

        it("should show information message for Info level", async () => {
            const mockShowInfoMessage = (window.showInformationMessage as jest.Mock).mockResolvedValue(undefined);
            
            await testOutputLogger.appendWithNotification(LogLevel.Info, message);
            
            expect(mockShowInfoMessage).toHaveBeenCalledWith(message, "View Output");
        });

        it("should show output channel when 'View Output' is clicked", async () => {
            (window.showInformationMessage as jest.Mock).mockResolvedValueOnce("View Output");

            await testOutputLogger.appendWithNotification(LogLevel.Info, message);

            expect(mockLogOutputChannel.show).toHaveBeenCalled();
        });

        it("should call button function when a button is clicked", async () => {
            const buttonFunc = jest.fn().mockResolvedValue(undefined);

            (window.showInformationMessage as jest.Mock).mockResolvedValueOnce("Custom Button");

            const buttons = [
                { label: "Custom Button", func: buttonFunc }
            ];

            await testOutputLogger.appendWithNotification(LogLevel.Info, message, undefined, buttons);

            // Wait a tick for the callback to happen
            await new Promise(resolve => setTimeout(resolve, 0));

            expect(buttonFunc).toHaveBeenCalled();
        });

        it("should handle all log levels", async () => {
            const testCases = [
                { level: LogLevel.Trace, expectedMethod: "trace" },
                { level: LogLevel.Debug, expectedMethod: "debug" },
                { level: LogLevel.Info, expectedMethod: "info" },
                { level: LogLevel.Warning, expectedMethod: "warn" },
                { level: LogLevel.Error, expectedMethod: "error" },
            ];

            for (const testCase of testCases) {
                // Clear mocks for each test case
                jest.clearAllMocks();

                await testOutputLogger.appendWithNotification(
                    testCase.level,
                    message,
                    details
                );

                // Use a switch statement to properly access the mock methods
                switch(testCase.expectedMethod) {
                    case "trace":
                        expect(mockLogOutputChannel.trace).toHaveBeenCalledWith(`${message}: ${details}`);
                        break;
                    case "debug":
                        expect(mockLogOutputChannel.debug).toHaveBeenCalledWith(`${message}: ${details}`);
                        break;
                    case "info":
                        expect(mockLogOutputChannel.info).toHaveBeenCalledWith(`${message}: ${details}`);
                        break;
                    case "warn":
                        expect(mockLogOutputChannel.warn).toHaveBeenCalledWith(`${message}: ${details}`);
                        break;
                    case "error":
                        expect(mockLogOutputChannel.error).toHaveBeenCalledWith(`${message}: ${details}`);
                        break;
                }
            }
        });
    });

    describe("show", () => {
        it("should call the show method on the output channel", () => {
            testOutputLogger.show();
            
            expect(mockLogOutputChannel.show).toHaveBeenCalled();
        });
    });
});