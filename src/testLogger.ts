import { LogLevel, TestMessage, Position, Location, TestRun, TestItem } from "vscode";
import { Logger } from "./logger";
import { CompilationStatus, TestMetrics } from "./types";
import c from "ansi-colors";

export namespace TestLogger {
    export function logComponent(run: TestRun, message: string) {
        run.appendOutput(c.red(message));
    }

    export function logWorkspace(run: TestRun, item: TestItem) {
        run.appendOutput(`${c.bgBlue(` WORKSPACE `)} ${item.label} ${c.grey(`(${item.children.size})`)}`);
        Logger.log(LogLevel.Info, `Deploying ${item.label}`);
    }

    export function logDeployment(run: TestRun, item: TestItem, success: boolean, metrics: TestMetrics) {
        if (success) {
            metrics.deployments.success++;
            run.appendOutput(` ${c.grey(`[ Deployment Successful ]`)}\r\n`);
            Logger.log(LogLevel.Info, `Successfully deployed ${item.label}`);
        } else {
            metrics.deployments.failed++;
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

    export function logCompilation(run: TestRun, item: TestItem, status: CompilationStatus, metrics: TestMetrics, messages?: string[]) {
        if (status === 'success') {
            metrics.compilations.success++;
            run.appendOutput(` ${c.grey(`[ Compilation Successful ]`)}\r\n`);
            Logger.log(LogLevel.Info, `Successfully compiled ${item.label}`);
        } else if (status === 'failed') {
            metrics.compilations.failed++;
            run.appendOutput(` ${c.red(`[ Compilation Failed ]`)}\r\n`);
            Logger.log(LogLevel.Error, `Failed to compile ${item.label}`);
        } else if (status === 'skipped') {
            metrics.compilations.skipped++;
            run.appendOutput(` ${c.grey(`[ Compilation Skipped ]`)}\r\n`);
            Logger.log(LogLevel.Warning, `Skipped compilation for ${item.label}`);
        }

        if (messages) {
            for (const message of messages) {
                run.appendOutput(`\t${c.red(`${message}`)}\r\n`);
            }
        }
    }

    export function logTestCasePassed(run: TestRun, item: TestItem, metrics: TestMetrics, duration?: number, assertions?: number) {
        metrics.testCases.passed++;
        if (duration) {
            metrics.duration += duration;
        }
        if (assertions) {
            metrics.assertions += assertions;
        }

        run.appendOutput(`\t${c.green(`✔`)}  ${item.label} ${c.grey(duration !== undefined ? `${duration}s` : ``)}\r\n`);
        run.passed(item, duration !== undefined ? duration * 1000 : undefined);
        Logger.log(LogLevel.Info, `Test case ${item.label} passed${duration !== undefined ? ` in ${duration}s` : ``}`);
    }

    export function logTestCaseFailed(run: TestRun, item: TestItem, metrics: TestMetrics, duration?: number, assertions?: number, messages?: { line?: number, message: string }[]) {
        metrics.testCases.failed++;
        if (duration) {
            metrics.duration += duration;
        }
        if (assertions) {
            metrics.assertions += assertions;
        }

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

    export function logArbitraryTestCaseFailed(run: TestRun, testCaseName: string, testFileItem: TestItem, metrics: TestMetrics, duration?: number, assertions?: number, messages?: { line?: number, message: string }[]) {
        if (duration) {
            metrics.duration += duration;
        }
        if (assertions) {
            metrics.assertions += assertions;
        }

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
        Logger.log(LogLevel.Error, `Test case ${testCaseName} failed${duration !== undefined ? ` in ${duration}s` : ``} but was not mapped to a test item`);
    }

    export function logTestCaseErrored(run: TestRun, item: TestItem, metrics: TestMetrics, duration?: number, assertions?: number, messages?: { line?: number, message: string }[]) {
        metrics.testCases.errored++;
        if (duration) {
            metrics.duration += duration;
        }
        if (assertions) {
            metrics.assertions += assertions;
        }

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

    export function logArbitraryTestCaseErrored(run: TestRun, testCaseName: string, testFileItem: TestItem, metrics: TestMetrics, duration?: number, assertions?: number, messages?: { line?: number, message: string }[]) {
        if (duration) {
            metrics.duration += duration;
        }
        if (assertions) {
            metrics.assertions += assertions;
        }

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
        Logger.log(LogLevel.Error, `Test case ${testCaseName} errored${duration !== undefined ? ` in ${duration}s` : ``} but was not mapped to a test item`);
    }

    export function logMetrics(run: TestRun, metrics: TestMetrics): void {
        const totalDeployments = metrics.deployments.success + metrics.deployments.failed;
        const totalCompilations = metrics.compilations.success + metrics.compilations.failed + metrics.compilations.skipped;
        const totalTestFiles = metrics.testFiles.passed + metrics.testFiles.failed + metrics.testFiles.errored;
        const totalTestCases = metrics.testCases.passed + metrics.testCases.failed + metrics.testCases.errored;

        // Format text with ansi colors
        const testExecutionHeading = `${c.bgBlue(` EXECUTION `)}`;
        const deploymentResult = `Deployments:  ${c.green(`${metrics.deployments.success} successful`)} | ${c.red(`${metrics.deployments.failed} failed`)} ${c.grey(`(${totalDeployments})`)}`;
        const compilationResult = `Compilations: ${c.green(`${metrics.compilations.success} successful`)} | ${c.red(`${metrics.compilations.failed} failed`)} | ${metrics.compilations.skipped} skipped ${c.grey(`(${totalCompilations})`)}`;
        const testResultsHeading = `${c.bgBlue(` RESULTS `)}`;
        const testFileResult = `Test Files:   ${c.green(`${metrics.testFiles.passed} passed`)} | ${c.red(`${metrics.testFiles.failed} failed`)} | ${c.yellow(`${metrics.testFiles.errored} errored`)} ${c.grey(`(${totalTestFiles})`)}`;
        const testCaseResult = `Test Cases:   ${c.green(`${metrics.testCases.passed} passed`)} | ${c.red(`${metrics.testCases.failed} failed`)} | ${c.yellow(`${metrics.testCases.errored} errored`)} ${c.grey(`(${totalTestCases})`)}`;
        const assertionResult = `Assertions:   ${metrics.assertions}`;
        const durationResult = `Duration:     ${metrics.duration}s`;
        const finalResult = (metrics.testFiles.failed > 0 || metrics.testCases.failed > 0) ? c.bgRed(` FAIL `) : (metrics.testFiles.errored || metrics.testCases.errored) > 0 ? c.bgYellow(` ERROR `) : c.bgGreen(` PASS `);

        // Calculate box width
        const maxContentWidth = Math.max(
            c.stripColor(testExecutionHeading).length,
            c.stripColor(deploymentResult).length,
            c.stripColor(compilationResult).length,
            c.stripColor(testResultsHeading).length,
            c.stripColor(testFileResult).length,
            c.stripColor(testCaseResult).length,
            c.stripColor(assertionResult).length,
            c.stripColor(durationResult).length,
            c.stripColor(finalResult).length
        );
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
        run.appendOutput(`${addPadding(testExecutionHeading)}\r\n`);
        run.appendOutput(`${addPadding(deploymentResult)}\r\n`);
        run.appendOutput(`${addPadding(compilationResult)}\r\n`);
        run.appendOutput(`${addPadding('')}\r\n`);
        run.appendOutput(`${addPadding(testResultsHeading)}\r\n`);
        run.appendOutput(`${addPadding(testFileResult)}\r\n`);
        run.appendOutput(`${addPadding(testCaseResult)}\r\n`);
        run.appendOutput(`${addPadding(assertionResult)}\r\n`);
        run.appendOutput(`${addPadding(durationResult)}\r\n`);
        run.appendOutput(`${addPadding('')}\r\n`);
        run.appendOutput(`${addPadding(finalResult)}\r\n`);
        run.appendOutput(borderBottom);
    }
}