import { TestRun } from "vscode";
import { TestResultLogger } from "./testResultLogger";
import { LogLevel } from "../../api/types";

// Mock VSCode TestRun object
const mockTestRun = {
    appendOutput: jest.fn()
};

describe("TestResultLogger", () => {
    let testRun: TestRun;
    let logger: TestResultLogger;

    beforeEach(() => {
        jest.clearAllMocks();
        testRun = mockTestRun as unknown as TestRun;
        logger = new TestResultLogger(testRun);
    });

    describe("constructor", () => {
        it("should initialize with a TestRun instance", () => {
            expect((logger as any).testRun).toBe(testRun);
        });
    });

    describe("append", () => {
        it("should call testRun.appendOutput with the message", async () => {
            const message = "Test message";
            
            await logger.append(message);
            
            expect(mockTestRun.appendOutput).toHaveBeenCalledWith(message);
        });

        it("should handle empty string message", async () => {
            const message = "";
            
            await logger.append("");
            
            expect(mockTestRun.appendOutput).toHaveBeenCalledWith("");
        });

        it("should handle null-like values properly", async () => {
            const message = "null";
            
            await logger.append(message);
            
            expect(mockTestRun.appendOutput).toHaveBeenCalledWith("null");
        });
    });

    describe("log", () => {
        it("should not throw an error when called", async () => {
            const level = LogLevel.Info;
            const message = "Log message";
            
            await expect(logger.log(level, message)).resolves.not.toThrow();
        });

        it("should not call any external methods (method is not used)", async () => {
            const level = LogLevel.Error;
            const message = "Log message";
            
            await logger.log(level, message);
            
            // Verify that appendOutput was not called since log method is not used
            expect(mockTestRun.appendOutput).not.toHaveBeenCalled();
        });
    });

    describe("appendWithNotification", () => {
        it("should not throw an error when called", async () => {
            const level = LogLevel.Info;
            const message = "Notification message";
            const details = "Additional details";
            const buttons = [
                { label: "Button 1", func: jest.fn() }
            ];
            
            await expect(
                logger.appendWithNotification(level, message, details, buttons)
            ).resolves.not.toThrow();
        });

        it("should not call any external methods (method is not used)", async () => {
            const level = LogLevel.Warning;
            const message = "Notification message";
            
            await logger.appendWithNotification(level, message);
            
            // Verify that appendOutput was not called since appendWithNotification method is not used
            expect(mockTestRun.appendOutput).not.toHaveBeenCalled();
        });
    });

    describe("integration", () => {
        it("should only use append method for output, not log or appendWithNotification", async () => {
            const appendMessage = "Append message";
            const logMessage = "Log message";
            const notificationMessage = "Notification message";
            
            await logger.append(appendMessage);
            await logger.log(LogLevel.Info, logMessage);
            await logger.appendWithNotification(LogLevel.Info, notificationMessage);
            
            // Only append should have triggered appendOutput
            expect(mockTestRun.appendOutput).toHaveBeenCalledTimes(1);
            expect(mockTestRun.appendOutput).toHaveBeenCalledWith(appendMessage);
        });
    });
});