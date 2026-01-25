import { CancellationToken, DeclarationCoverage, FileCoverage, Position, StatementCoverage, TestCoverageCount, TestRun, Uri } from "vscode";
import { MergedCoverageData } from "../api/types";

export class IBMiFileCoverage extends FileCoverage {
    public isStatementCoverage: boolean;
    public readonly lines: StatementCoverage[] = [];
    public readonly procedures: DeclarationCoverage[] = [];

    constructor(mergedCoverageData: MergedCoverageData) {
        const uri = Uri.from({ scheme: mergedCoverageData.uri.scheme, path: mergedCoverageData.uri.scheme === 'file' ? mergedCoverageData.uri.fsPath : mergedCoverageData.uri.path, fragment: mergedCoverageData.uri.fragment });
        super(uri, new TestCoverageCount(0, 0));
        this.isStatementCoverage = mergedCoverageData.ccLvl === '*LINE';

        for (const [line, info] of Object.entries(mergedCoverageData.activeLines)) {
            const linePosition = new Position(Number(line) - 1, 0);
            if (this.isStatementCoverage) {
                this.lines.push(new StatementCoverage(info.executed, linePosition));
                this.statementCoverage.covered += info.executed ? 1 : 0;
                this.statementCoverage.total++;
            } else {
                this.procedures.push(new DeclarationCoverage(info.name, info.executed, linePosition));
                if (!this.declarationCoverage) {
                    this.declarationCoverage = new TestCoverageCount(0, 0);
                }
                this.declarationCoverage.covered += info.executed ? 1 : 0;
                this.declarationCoverage.total++;
            }
        }
    }

    static async loadDetailedCoverage(testRun: TestRun, fileCoverage: FileCoverage, token: CancellationToken) {
        if (fileCoverage instanceof IBMiFileCoverage) {
            if (fileCoverage.isStatementCoverage) {
                return fileCoverage.lines;
            } else if (fileCoverage.procedures.length > 0) {
                return fileCoverage.procedures;
            }
        }

        return [];
    };
}