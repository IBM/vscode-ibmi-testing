import { MergedCoverageData, TestMetrics } from "../api/types";
import * as fs from "fs";
import * as path from "path";
import { GREEN_THRESHOLD, YELLOW_THRESHOLD } from "..";

export class SummaryLogger {
    private logFile: string | undefined;

    constructor(logFile: string | undefined) {
        this.logFile = logFile;

        if (this.logFile) {
            fs.mkdirSync(path.dirname(this.logFile), { recursive: true });
            fs.writeFileSync(this.logFile, '');
        }
    }

    public async generateReport(testMetrics: TestMetrics, finalCoverageDatasets: MergedCoverageData[], coverageThresholds: string[]) {
        if (this.logFile) {
            // Get test results
            const passed = testMetrics.testFiles.passed;
            const failed = testMetrics.testFiles.failed;
            const errored = testMetrics.testFiles.errored;
            const totalTests = passed + failed + errored;
            const assertions = testMetrics.assertions;
            const duration = testMetrics.duration;
            const hasFailuresOrErrors = (testMetrics.testFiles.failed > 0 || testMetrics.testCases.failed > 0) ||
                (testMetrics.testFiles.errored || testMetrics.testCases.errored) > 0;
            const testStatus = hasFailuresOrErrors ? 'failing' : 'passing';
            const testColor = hasFailuresOrErrors ? 'red' : 'brightgreen';

            // Get code coverage results
            const yellow = coverageThresholds.length > 1 ? Number(coverageThresholds[0]) : Number(YELLOW_THRESHOLD);
            const green = coverageThresholds.length > 0 ? Number(coverageThresholds[1]) : Number(GREEN_THRESHOLD);
            let totalCoveredLines = 0;
            let totalExecutableLines = 0;
            const codeCoverageLines: string[] = finalCoverageDatasets.map(coverageData => {
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
                totalExecutableLines += executableLines;

                // Calculate coverage percentage
                const coverageStatus = executableLines > 0 ? Math.round((coveredLines / executableLines) * 100).toFixed(0) : 0;
                const coverageColor = Number(coverageStatus) >= green ? 'brightgreen' :
                    Number(coverageStatus) >= yellow ? 'yellow' : 'red';

                return `|${file}|![Coverage](https://img.shields.io/badge/${coverageStatus}%25-${coverageColor})|${uncoveredLines}|${coveredLines}|${executableLines}|`;
            });
            const totalCoverageStatus = totalExecutableLines > 0 ? Math.round((totalCoveredLines / totalExecutableLines) * 100).toFixed(0) : 0;
            const totalCoverageColor = Number(totalCoverageStatus) >= green ? 'brightgreen' :
                Number(totalCoverageStatus) >= yellow ? 'yellow' : 'red';

            const lines: string[] = [
                `## 📋 Test and Code Coverage Report`,
                ``,
                `![test](https://img.shields.io/badge/test-${testStatus}-${testColor}) ![coverage](https://img.shields.io/badge/coverage-${totalCoverageStatus}%25-${totalCoverageColor})`,
                ``,
                `### Test Result`,
                `|Total Tests|✅ Passed|❌ Failed|⚠️ Errored|🎯 Assertions|⏳ Duration|`,
                `|-|-|-|-|-|-|`,
                `|${totalTests}|${passed}|${failed}|${errored}|${assertions}|${duration}s|`,
                ``,
                `### Code Coverage`,
                `|File|Coverage|Uncovered Lines|Covered Lines|Executable Lines|`,
                `|-|-|-|-|-|`,
                ...codeCoverageLines
            ];
            await fs.promises.appendFile(this.logFile, lines.join(`\n`));
        }
    }
}