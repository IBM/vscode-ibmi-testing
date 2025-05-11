import { LogLevel, TestMessage, Position, Location, TestRun, TestItem } from "vscode";
import { Logger } from "./logger";
import c from "ansi-colors";
import { TestMetrics } from "./types";

export namespace TestLogger {
    export function logComponent(run: TestRun, message: string) {
        run.appendOutput(c.red(message));
    }

    export function logWorkspace(run: TestRun, item: TestItem) {
        run.appendOutput(`${c.bgBlue(` WORKSPACE `)} ${item.label} ${c.grey(`(${item.children.size})`)}`);
        Logger.log(LogLevel.Info, `Deploying ${item.label}`);
    }

    export function logDeployment(run: TestRun, item: TestItem, success: boolean) {
        if (success) {
            run.appendOutput(` ${c.grey(`[ Deployment Successful ]`)}\r\n`);
            Logger.log(LogLevel.Info, `Successfully deployed ${item.label}`);
        } else {
            run.appendOutput(` ${c.red(`[ Deployment Failed ]`)}\r\n`);
            Logger.log(LogLevel.Error, `Failed to deploy ${item.label}`);
        }
    }

    export function logLibrary(run: TestRun, item: TestItem) {
        run.appendOutput(`${c.bgBlue(` LIBRARY `)} ${item.label} ${c.grey(`(${item.children.size})`)}\r\n`);
        Logger.log(LogLevel.Info, `Running tests in ${item.label}`);
    }

    export function logTestFile(run: TestRun, item: TestItem) {
        run.appendOutput(`${c.blue(`❯`)} ${item.label} ${c.grey(`(${item.children.size})`)}`);
    }

    export function logCompilation(run: TestRun, item: TestItem, status: 'success' | 'failed' | 'skipped', messages?: string[]) {
        if (status === 'success') {
            run.appendOutput(` ${c.grey(`[ Compilation Successful ]`)}\r\n`);
            Logger.log(LogLevel.Info, `Successfully compiled ${item.label}`);
        } else if (status === 'failed') {
            run.appendOutput(` ${c.yellow(`[ Compilation Error ]`)}\r\n`);
            Logger.log(LogLevel.Error, `Failed to compile ${item.label}`);
        } else if (status === 'skipped') {
            run.appendOutput(` ${c.grey(`[ Compilation Skipped ]`)}\r\n`);
            Logger.log(LogLevel.Warning, `Skipped compilation for ${item.label}`);
        }
        if (messages) {
            for (const message of messages) {
                run.appendOutput(`\t${c.yellow(`${message}`)}\r\n`);
            }
        }
    }

    export function logTestCasePassed(run: TestRun, item: TestItem, duration?: number) {
        run.appendOutput(`\t${c.green(`✔`)}  ${item.label} ${c.grey(duration !== undefined ? `${duration}s` : ``)}\r\n`);
        run.passed(item, duration !== undefined ? duration * 1000 : undefined);
        Logger.log(LogLevel.Info, `Test case ${item.label} passed${duration !== undefined ? ` in ${duration}s` : ``}`);
    }

    export function logTestCaseFailed(run: TestRun, item: TestItem, duration?: number, messages?: { line?: number, message: string }[]) {
        run.appendOutput(`\t${c.red(`✘`)}  ${item?.label} ${c.grey(duration !== undefined ? `${duration}s` : ``)}\r\n`);

        const testMessages: TestMessage[] = [];
        if (messages) {
            for (const message of messages) {
                run.appendOutput(`\t\t${c.red(`${c.bold(`Failure:`)} ${message.message}`)}\r\n`);

                const testMessage = new TestMessage(message.message);
                const range = message.line ? new Position(message.line - 1, 0) : item.range;
                testMessage.location = range ? new Location(item.uri!, range) : undefined;
                testMessages.push(testMessage);
            }
        }

        run.failed(item, testMessages, duration !== undefined ? duration * 1000 : undefined);
        Logger.log(LogLevel.Error, `Test case ${item.label} failed${duration !== undefined ? ` in ${duration}s` : ``}`);
    }

    export function logArbitraryTestCaseFailed(run: TestRun, testCaseName: string, testFileItem: TestItem, duration?: number, messages?: { line?: number, message: string }[]) {
        run.appendOutput(`\t${c.red(`✘`)}  ${testCaseName} ${c.grey(duration !== undefined ? `${duration}s` : ``)}\r\n`);

        const testMessages: TestMessage[] = [];
        if (messages) {
            for (const message of messages) {
                run.appendOutput(`\t\t${c.red(`${c.bold(`Failure:`)} ${message.message}`)}\r\n`);

                const testMessage = new TestMessage(message.message);
                const range = message.line ? new Position(message.line - 1, 0) : testFileItem.range;
                testMessage.location = range ? new Location(testFileItem.uri!, range) : undefined;
                testMessages.push(testMessage);
            }
        }

        run.failed(testFileItem, testMessages, duration !== undefined ? duration * 1000 : undefined);
    }

    export function logTestCaseErrored(run: TestRun, item: TestItem, duration?: number, messages?: { line?: number, message: string }[]) {
        run.appendOutput(`\t${c.yellow(`⚠`)}  ${item?.label} ${c.grey(duration !== undefined ? `${duration}s` : ``)}\r\n`);

        const testMessages: TestMessage[] = [];
        if (messages) {
            for (const message of messages) {
                run.appendOutput(`\t\t${c.yellow(`${c.bold(`Error:`)} ${message.message}`)}\r\n`);

                const testMessage = new TestMessage(message.message);
                const range = message.line ? new Position(message.line - 1, 0) : item.range;
                testMessage.location = range ? new Location(item.uri!, range) : undefined;
                testMessages.push(testMessage);
            }
        }

        run.errored(item, testMessages, duration !== undefined ? duration * 1000 : undefined);
        Logger.log(LogLevel.Error, `Test case ${item.label} errored${duration !== undefined ? ` in ${duration}s` : ``}`);
    }

    export function logArbitraryTestCaseErrored(run: TestRun, testCaseName: string, testFileItem: TestItem, duration?: number, messages?: { line?: number, message: string }[]) {
        run.appendOutput(`\t${c.yellow(`⚠`)}  ${testCaseName} ${c.grey(duration !== undefined ? `${duration}s` : ``)}\r\n`);

        const testMessages: TestMessage[] = [];
        if (messages) {
            for (const message of messages) {
                run.appendOutput(`\t\t${c.yellow(`${c.bold(`Error:`)} ${message.message}`)}\r\n`);

                const testMessage = new TestMessage(message.message);
                const range = message.line ? new Position(message.line - 1, 0) : testFileItem.range;
                testMessage.location = range ? new Location(testFileItem.uri!, range) : undefined;
                testMessages.push(testMessage);
            }
        }

        run.errored(testFileItem, testMessages, duration !== undefined ? duration * 1000 : undefined);
    }

    export function logMetrics(run: TestRun, metrics: TestMetrics): void {
        const totalTests = metrics.testCasesFailed + metrics.testCasesPassed + metrics.testCasesErrored;

        // Format text with ansi colors
        const testCaseResult = `Test Cases: ${c.green(`${metrics.testCasesPassed} passed`)} | ${c.red(`${metrics.testCasesFailed} failed`)} | ${c.yellow(`${metrics.testCasesErrored} errored`)} (${totalTests})`;
        const durationResult = `Duration:   ${metrics.duration}s`;

        // Calculate box width
        const maxContentWidth = Math.max(c.stripColor(testCaseResult).length, c.stripColor(durationResult).length);
        const boxWidth = maxContentWidth + 2;

        // Generate dynamic border
        const borderTop = c.blue(`┌${'─'.repeat(boxWidth)}┐`);
        const borderBottom = c.blue(`└${'─'.repeat(boxWidth)}┘`);

        // Add padding to line
        function addPadding(content: string): string {
            const plainTextLength = c.stripColor(content).length;
            const padding = maxContentWidth - plainTextLength;
            return `${c.blue(`│`)} ${content}${' '.repeat(padding)} ${c.blue(`│`)}`;
        }

        // Output results
        run.appendOutput(`\r\n`);
        run.appendOutput(`${borderTop}\r\n`);
        run.appendOutput(`${addPadding(testCaseResult)}\r\n`);
        run.appendOutput(`${addPadding(durationResult)}\r\n`);
        run.appendOutput(borderBottom);
    }
}