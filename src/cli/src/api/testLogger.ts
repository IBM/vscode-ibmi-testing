import { CompilationStatus, DeploymentStatus, Logger, LogLevel, MergedCoverageData, TestMetrics } from "./types";
import c from "ansi-colors";
import * as path from "path";
import { GREEN_THRESHOLD, YELLOW_THRESHOLD } from "..";
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
            await this.testOutputLogger.log(LogLevel.Info, `Successfully deployed ${workspaceName}`);
        } else if (status === 'failed') {
            await this.testResultLogger.append(` ${c.red(`[ Deployment Failed ]`)}\r\n`);
            await this.testOutputLogger.log(LogLevel.Error, `Failed to deploy ${workspaceName}`);
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
            await this.testOutputLogger.log(LogLevel.Info, `Successfully compiled ${testSuiteName}`);
        } else if (status === 'failed') {
            await this.testResultLogger.append(` ${c.red(`[ Compilation Failed ]`)}\r\n`);
            await this.testOutputLogger.log(LogLevel.Error, `Failed to compile ${testSuiteName}`);
        } else if (status === 'skipped') {
            await this.testResultLogger.append(` ${c.grey(`[ Compilation Skipped ]`)}\r\n`);
            await this.testOutputLogger.log(LogLevel.Warning, `Skipped compilation for ${testSuiteName}`);
        }

        for (const message of messages) {
            await this.testResultLogger.append(`\t${c.red(`${message}`)}\r\n`);
        }
    }

    async logTestCasePassed(testCaseName: string, duration?: number) {
        await this.testResultLogger.append(`\t${c.green(`✔`)}  ${testCaseName} ${c.grey(duration !== undefined ? `${duration}s` : ``)}\r\n`);
        await this.testOutputLogger.log(LogLevel.Info, `Test case ${testCaseName} passed${duration !== undefined ? ` in ${duration}s` : ``}`);
    }

    async logTestCaseFailed(testCaseName: string, messages: { line?: number, message: string }[], duration?: number) {
        await this.testResultLogger.append(`\t${c.red(`✘`)}  ${testCaseName} ${c.grey(duration !== undefined ? `${duration}s` : ``)}\r\n`);
        for (const message of messages) {
            await this.testResultLogger.append(`\t\t${c.red(`${c.bold(`Failure`)}${message.line ? ` (line ${message.line})` : ``}: ${message.message}`)}\r\n`);
        }
        await this.testOutputLogger.log(LogLevel.Error, `Test case ${testCaseName} failed${duration !== undefined ? ` in ${duration}s` : ``}`);
    }

    async logTestCaseErrored(testCaseName: string, messages: { line?: number, message: string }[], duration?: number) {
        await this.testResultLogger.append(`\t${c.yellow(`⚠`)}  ${testCaseName} ${c.grey(duration !== undefined ? `${duration}s` : ``)}\r\n`);
        for (const message of messages) {
            await this.testResultLogger.append(`\t\t${c.yellow(`${c.bold(`Error`)}${message.line ? ` (line ${message.line})` : ``}: ${message.message}`)}\r\n`);
        }
        await this.testOutputLogger.log(LogLevel.Error, `Test case ${testCaseName} errored${duration !== undefined ? ` in ${duration}s` : ``}`);
    }

    async logMetrics(metrics: TestMetrics) {
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
        const yellow = coverageThresholds.length > 1 ? Number(coverageThresholds[0]) : Number(YELLOW_THRESHOLD);
        const green = coverageThresholds.length > 0 ? Number(coverageThresholds[1]) : Number(GREEN_THRESHOLD);
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
            for (const lineStatus of Object.values(coverageData.activeLines)) {
                if (lineStatus) {
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
    }
}