import { AssertionResult, CompilationStatus, DeploymentStatus, Logger, LogLevel, MergedCoverageData, TestMetrics } from "./types";
import c from "ansi-colors";
import * as path from "path";
import { table, TableUserConfig } from "table";

export class TestLogger {
    public testOutputLogger: Logger;
    public testResultLogger: Logger;

    constructor(testOutputLogger: Logger, testResultLogger: Logger) {
        this.testOutputLogger = testOutputLogger;
        this.testResultLogger = testResultLogger;
    }

    async logComponentError(error: string) {
        await this.testResultLogger.append(c.red(error));
    }

    async logRunTimeWarning(error: string) {
        await this.testResultLogger.append(`\t${c.yellow(`⚠  ${error}`)}`);
    }

    async logWorkspace(workspaceName: string, numTestSuites: number) {
        await this.testResultLogger.append(`${c.bgBlue(` WORKSPACE `)} ${workspaceName} ${c.grey(`(${numTestSuites})`)}`);
        await this.testOutputLogger.log(LogLevel.Info, `Running tests in ${workspaceName}`);
    }

    async logDeployment(workspaceName: string, status: DeploymentStatus) {
        if (status === 'success') {
            await this.testResultLogger.append(` ${c.grey(`[ Deployment Successful ]`)}\r\n`);
            await this.testOutputLogger.log(LogLevel.Info, `Deployment successful for ${workspaceName}`);
        } else if (status === 'errored') {
            await this.testResultLogger.append(` ${c.yellow(`[ Deployment Error ]`)}\r\n`);
            await this.testOutputLogger.log(LogLevel.Error, `Deployment error for ${workspaceName}`);
        } else if (status === 'skipped') {
            await this.testResultLogger.append(` ${c.grey(`[ Deployment Skipped ]`)}\r\n`);
            await this.testOutputLogger.log(LogLevel.Error, `Deployment skipped for ${workspaceName}`);
        } else if (status === 'cancelled') {
            await this.testResultLogger.append(` ${c.magenta(`[ Deployment Cancelled ]`)}\r\n`);
            await this.testOutputLogger.log(LogLevel.Warning, `Deployment cancelled for ${workspaceName}`);
        }
    }

    async logLibrary(libraryName: string, numTestSuites: number) {
        await this.testResultLogger.append(`${c.bgBlue(` LIBRARY `)} ${libraryName} ${c.grey(`(${numTestSuites})`)}\r\n`);
        await this.testOutputLogger.log(LogLevel.Info, `Running tests in ${libraryName}`);
    }

    async logIfsDirectory(directoryName: string, numTestSuites: number) {
        await this.testResultLogger.append(`${c.bgBlue(` IFS `)} ${directoryName} ${c.grey(`(${numTestSuites})`)}\r\n`);
        await this.testOutputLogger.log(LogLevel.Info, `Running tests in ${directoryName}`);
    }

    async logTestSuite(testSuiteName: string, testSuiteSystemName: string, numTestCases: number) {
        await this.testResultLogger.append(`${c.blue(`❯`)} ${testSuiteName} → ${testSuiteSystemName}.SRVPGM ${c.grey(`(${numTestCases})`)}`);
        await this.testOutputLogger.log(LogLevel.Info, `Running tests in ${testSuiteName} (${testSuiteSystemName}.SRVPGM)`);
    }

    async logCompilation(testSuiteName: string, status: CompilationStatus, messages: string[]) {
        if (status === 'success') {
            await this.testResultLogger.append(` ${c.grey(`[ Compilation Successful ]`)}\r\n`);
            await this.testOutputLogger.log(LogLevel.Info, `Compilation successful for ${testSuiteName}`);
        } else if (status === 'errored') {
            await this.testResultLogger.append(` ${c.yellow(`[ Compilation Error ]`)}\r\n`);
            await this.testOutputLogger.log(LogLevel.Error, `Compilation error for ${testSuiteName}`);
        } else if (status === 'skipped') {
            await this.testResultLogger.append(` ${c.grey(`[ Compilation Skipped ]`)}\r\n`);
            await this.testOutputLogger.log(LogLevel.Warning, `Compilation skipped for ${testSuiteName}`);
        } else if (status === 'cancelled') {
            await this.testResultLogger.append(` ${c.magenta(`[ Compilation Cancelled ]`)}\r\n`);
            await this.testOutputLogger.log(LogLevel.Warning, `Compilation cancelled for ${testSuiteName}`);
        }

        for (const message of messages) {
            await this.testResultLogger.append(`\t${c.yellow(`${message}`)}\r\n`);
        }
    }

    async logTestCasePassed(testCaseName: string, assertionCount: number, duration?: number) {
        await this.testResultLogger.append(`\t${c.green(`✔`)}  ${testCaseName} ${c.grey(`(${assertionCount}) ${duration !== undefined ? `${duration}s` : ``}`)}\r\n`);
        await this.testOutputLogger.log(LogLevel.Info, `Test case ${testCaseName} passed${duration !== undefined ? ` in ${duration}s` : ``}`);
    }

    async logTestCaseFailed(testCaseName: string, assertionCount: number, duration?: number) {
        await this.testResultLogger.append(`\t${c.red(`✘`)}  ${testCaseName} ${c.grey(`(${assertionCount}) ${duration !== undefined ? `${duration}s` : ``}`)}\r\n`);
        await this.testOutputLogger.log(LogLevel.Error, `Test case ${testCaseName} failed${duration !== undefined ? ` in ${duration}s` : ``}`);
    }

    async logTestCaseErrored(testCaseName: string, assertionCount: number, duration?: number) {
        await this.testResultLogger.append(`\t${c.yellow(`⚠`)}  ${testCaseName} ${c.grey(`(${assertionCount}) ${duration !== undefined ? `${duration}s` : ``}`)}\r\n`);
        await this.testOutputLogger.log(LogLevel.Error, `Test case ${testCaseName} errored${duration !== undefined ? ` in ${duration}s` : ``}`);
    }

    async logTestCaseSkipped(testCaseName: string) {
        await this.testResultLogger.append(`\t${c.grey(`○`)}  ${testCaseName}\r\n`);
        await this.testOutputLogger.log(LogLevel.Warning, `Test case ${testCaseName} skipped`);
    }

    async logTestCaseCancelled(testCaseName: string) {
        await this.testResultLogger.append(`\t${c.magenta(`○`)}  ${testCaseName}\r\n`);
        await this.testOutputLogger.log(LogLevel.Warning, `Test case ${testCaseName} cancelled`);
    }

    async logAssertionResult(assertionResults: AssertionResult[]) {
        for (const assertionResult of assertionResults) {
            if (assertionResult.outcome === 'success') {
                // TODO: Uncomment this line when line numbers are properly mapped
                // await this.testResultLogger.append(`\t\t${c.green(`✔`)}  ${assertionResult.name}()${assertionResult.line ? ` [Line ${assertionResult.line}]` : ``}\r\n`);

                await this.testOutputLogger.log(LogLevel.Info, `Assertion ${assertionResult.name}()${assertionResult.line ? ` [Line ${assertionResult.line}]` : ``} passed`);
            } else if (assertionResult.outcome === 'failure') {
                await this.testResultLogger.append(`\t\t${c.red(`✘  ${c.bold(`${assertionResult.name}()`)}${assertionResult.line ? ` [Line ${assertionResult.line}]` : ``}${assertionResult.message ? ` - ${assertionResult.message}` : ``}`)}\r\n`);
                const callstackOutput = assertionResult.callstack?.map(callstackItem => {
                    return `${callstackItem.procedure} (${callstackItem.programLibrary}/${callstackItem.program}->${callstackItem.module}:${callstackItem.line})`;
                }).join(`\r\n`) ?? '';
                await this.testOutputLogger.log(LogLevel.Error, `Assertion ${assertionResult.name}()${assertionResult.line ? ` [Line ${assertionResult.line}]` : ``} failed:\r\n${callstackOutput}`);
            } else if (assertionResult.outcome === 'error') {
                await this.testResultLogger.append(`\t\t${c.yellow(`⚠  ${assertionResult.errorType ? `${c.bold(`${assertionResult.errorType}:`)} ` : ``}${assertionResult.message}`)}\r\n`);
                let receiverSenderOutput = '';
                if (assertionResult.messageReceiver && assertionResult.messageSender) {
                    const receiverOutput = `Receiver: ${assertionResult.messageReceiver.procedure} (${assertionResult.messageReceiver.programLibrary}/${assertionResult.messageReceiver.program}->${assertionResult.messageReceiver.module}:${assertionResult.messageReceiver.line})`;
                    const senderOutput = `Sender: ${assertionResult.messageSender.procedure} (${assertionResult.messageSender.programLibrary}/${assertionResult.messageSender.program}->${assertionResult.messageSender.module}:${assertionResult.messageSender.line})`;
                    await this.testResultLogger.append(`\t\t\t${c.yellow(receiverOutput)}\r\n`);
                    await this.testResultLogger.append(`\t\t\t${c.yellow(senderOutput)}\r\n`);
                    receiverSenderOutput = `${receiverOutput}\r\n${senderOutput}`;
                }
                await this.testOutputLogger.log(LogLevel.Error, `${assertionResult.errorType ? `${assertionResult.errorType}: ` : ``}${assertionResult.message}:\r\n${receiverSenderOutput}`);
            }
        }
    }

    async logMetrics(metrics: TestMetrics) {
        const isCancellationRequested =
            metrics.deployments.cancelled > 0 || metrics.compilations.cancelled > 0 ||
            metrics.testFiles.cancelled > 0 || metrics.testCases.cancelled > 0;

        const hasFailures =
            metrics.testFiles.failed > 0 || metrics.testCases.failed > 0;

        const hasErrors =
            metrics.deployments.errored > 0 || metrics.compilations.errored > 0 ||
            metrics.testFiles.errored > 0 || metrics.testCases.errored > 0;

        const totalDeployments =
            metrics.deployments.success + metrics.deployments.errored +
            metrics.deployments.skipped + metrics.deployments.cancelled;

        const totalCompilations =
            metrics.compilations.success + metrics.compilations.errored +
            metrics.compilations.skipped + metrics.compilations.cancelled;

        const totalTestFiles =
            metrics.testFiles.passed + metrics.testFiles.failed +
            metrics.testFiles.errored + metrics.testFiles.skipped +
            metrics.testFiles.cancelled;

        const totalTestCases =
            metrics.testCases.passed + metrics.testCases.failed +
            metrics.testCases.errored + metrics.testCases.skipped +
            metrics.testCases.cancelled;

        // Format text with ansi colors
        const testExecutionHeading = `${c.bgBlue(` EXECUTION `)}`;

        let deploymentResult =
            `Deployments:  ${c.green(`${metrics.deployments.success} successful`)} | ` +
            `${c.yellow(`${metrics.deployments.errored} errored`)} | ` +
            `${metrics.deployments.skipped} skipped | `;
        if (isCancellationRequested) {
            deploymentResult += `${c.magenta(`${metrics.deployments.cancelled} cancelled`)} `;
        }
        deploymentResult += `${c.grey(`(${totalDeployments})`)}`;

        let compilationResult =
            `Compilations: ${c.green(`${metrics.compilations.success} successful`)} | ` +
            `${c.yellow(`${metrics.compilations.errored} errored`)} | ` +
            `${metrics.compilations.skipped} skipped | `;
        if (isCancellationRequested) {
            compilationResult += `${c.magenta(`${metrics.compilations.cancelled} cancelled`)} `;
        }
        compilationResult += `${c.grey(`(${totalCompilations})`)}`;

        const testResultsHeading = `${c.bgBlue(` RESULTS `)}`;

        let testFileResult =
            `Test Files:   ${c.green(`${metrics.testFiles.passed} passed`)} | ` +
            `${c.red(`${metrics.testFiles.failed} failed`)} | ` +
            `${c.yellow(`${metrics.testFiles.errored} errored`)} | ` +
            `${c.grey(`${metrics.testFiles.skipped} skipped`)} | `;

        if (isCancellationRequested) {
            testFileResult += `${c.magenta(`${metrics.testFiles.cancelled} cancelled`)} `;
        }
        testFileResult += `${c.grey(`(${totalTestFiles})`)}`;

        let testCaseResult =
            `Test Cases:   ${c.green(`${metrics.testCases.passed} passed`)} | ` +
            `${c.red(`${metrics.testCases.failed} failed`)} | ` +
            `${c.yellow(`${metrics.testCases.errored} errored`)} | ` +
            `${c.grey(`${metrics.testCases.skipped} skipped`)} | `;
        if (isCancellationRequested) {
            testCaseResult += `${c.magenta(`${metrics.testCases.cancelled} cancelled`)} `;
        }
        testCaseResult += `${c.grey(`(${totalTestCases})`)}`;

        const assertionResult = `Assertions:   ${metrics.assertions}`;
        const durationResult = `Duration:     ${metrics.duration.toFixed(2)}s`;
        const finalResult =
            isCancellationRequested ? c.bgMagenta(` CANCELLED `) :
                hasErrors ? c.bgYellow(` ERROR `) :
                    hasFailures ? c.bgRed(` FAIL `) :
                        c.bgGreen(` PASS `);

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
        const message = [
            ``,
            `${borderTop}`,
            `${addPadding(testExecutionHeading)}`,
            `${addPadding(deploymentResult)}`,
            `${addPadding(compilationResult)}`,
            `${addPadding('')}`,
            `${addPadding(testResultsHeading)}`,
            `${addPadding(testFileResult)}`,
            `${addPadding(testCaseResult)}`,
            `${addPadding(assertionResult)}`,
            `${addPadding(durationResult)}`,
            `${addPadding('')}`,
            `${addPadding(finalResult)}`,
            borderBottom
        ].join(`\r\n`);
        await this.testResultLogger.append(message);
    }

    async logCoverage(finalCoverageDatasets: MergedCoverageData[], coverageThresholds: string[]) {
        const yellow = coverageThresholds.length > 1 ? Number(coverageThresholds[0]) : Number(60);
        const green = coverageThresholds.length > 0 ? Number(coverageThresholds[1]) : Number(90);
        let totalUncoveredLines = 0;
        let totalCoveredLines = 0;
        let totalExecutableLines = 0;

        const data: (string | number)[][] = [
            ['File', 'Coverage', 'Uncovered Lines', 'Covered Lines', 'Executable Lines']
        ];

        for (const coverageData of finalCoverageDatasets) {
            const file = path.basename(coverageData.uri.fsPath);

            // Calculate line counts
            let coveredLines = 0;
            let uncoveredLines = 0;
            for (const info of Object.values(coverageData.activeLines)) {
                if (info.executed) {
                    coveredLines++;
                } else {
                    uncoveredLines++;
                }
            }
            const executableLines = Object.keys(coverageData.activeLines).length;
            totalCoveredLines += coveredLines;
            totalUncoveredLines += uncoveredLines;
            totalExecutableLines += executableLines;

            // Calculate coverage percentage
            const coverageStatus = executableLines > 0 ? Math.round((coveredLines / executableLines) * 100).toFixed(0) : 0;
            const coverageColor = Number(coverageStatus) >= green ? c.green :
                Number(coverageStatus) >= yellow ? c.yellow :
                    c.red;

            data.push([
                file,
                coverageColor(`${coverageStatus}%`),
                uncoveredLines,
                coveredLines,
                executableLines
            ]);
        }

        const totalCoverageStatus = totalExecutableLines > 0 ? Math.round((totalCoveredLines / totalExecutableLines) * 100).toFixed(0) : 0;
        const totalCoverageColor = Number(totalCoverageStatus) >= green ? c.green :
            Number(totalCoverageStatus) >= yellow ? c.yellow :
                c.red;

        data.push([
            c.bold('TOTAL'),
            totalCoverageColor(`${totalCoverageStatus}%`),
            totalUncoveredLines,
            totalCoveredLines,
            totalExecutableLines
        ]);

        const config: TableUserConfig = {
            border: {
                topBody: c.blue(`─`),
                topJoin: c.blue(`┬`),
                topLeft: c.blue(`┌`),
                topRight: c.blue(`┐`),
                bottomBody: c.blue(`─`),
                bottomJoin: c.blue(`┴`),
                bottomLeft: c.blue(`└`),
                bottomRight: c.blue(`┘`),
                bodyLeft: c.blue(`│`),
                bodyRight: c.blue(`│`),
                bodyJoin: c.blue(`│`),
                joinBody: c.blue(`─`),
                joinLeft: c.blue(`├`),
                joinRight: c.blue(`┤`),
                joinJoin: c.blue(`┼`)
            },
            columns: [
                { alignment: 'left' },   // File
                { alignment: 'right' },  // Coverage
                { alignment: 'right' },  // Uncovered Lines
                { alignment: 'right' },  // Covered Lines
                { alignment: 'right' }   // Executable Lines
            ],
            drawHorizontalLine: (index: number, size: number) => {
                // Draw top, header separator, and bottom
                return index === 0 || index === 1 || index === size - 1 || index === size;
            }
        };

        const output = table(data, config);
        const message = [
            ``,
            ...output.split('\n')
        ].join(`\r\n`);
        await this.testResultLogger.append(message);

        for (const coverageData of finalCoverageDatasets) {
            let parsedCoverageOutput: any;
            if (coverageData.ccLvl === "*LINE") {
                const covered: number[] = [];
                const uncovered: number[] = [];

                for (const [lineStr, info] of Object.entries(coverageData.activeLines)) {
                    if (info.executed) {
                        covered.push(Number(lineStr));
                    } else {
                        uncovered.push(Number(lineStr));
                    }
                }

                parsedCoverageOutput = {
                    coveredLines: this.compressCoverageRanges(covered),
                    uncoveredLines: this.compressCoverageRanges(uncovered)
                };
            } else {
                const coveredProcedures: { name: string; line: number }[] = [];
                const uncoveredProcedures: { name: string; line: number }[] = [];

                for (const [lineStr, info] of Object.entries(coverageData.activeLines)) {
                    const proc = { name: info.name, line: Number(lineStr) };

                    if (info.executed) {
                        coveredProcedures.push(proc);
                    } else {
                        uncoveredProcedures.push(proc);
                    }
                }

                parsedCoverageOutput = {
                    coveredProcedures,
                    uncoveredProcedures
                };
            }

            await this.testOutputLogger.log(
                LogLevel.Info,
                `Code coverage for ${coverageData.uri.fsPath}:\n${JSON.stringify(parsedCoverageOutput, null, 2)}`
            );
        }
    }

    private compressCoverageRanges(lines: number[]): string {
        if (!lines.length) {
            return ``;
        }

        const sorted = [...lines].sort((a, b) => a - b);
        const ranges: string[] = [];

        let start = sorted[0];
        let prev = sorted[0];

        for (let i = 1; i < sorted.length; i++) {
            const current = sorted[i];

            if (current === prev + 1) {
                prev = current;
                continue;
            }

            ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
            start = current;
            prev = current;
        }

        ranges.push(start === prev ? `${start}` : `${start}-${prev}`);

        return ranges.join(", ");
    }
}