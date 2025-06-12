import { CancellationToken, DeclarationCoverage, FileCoverage, Position, StatementCoverage, TestCoverageCount, TestRun, Uri } from "vscode";
import { BasicUri, CoverageData } from "./api/types";

export class IBMiFileCoverage extends FileCoverage {
    public isStatementCoverage: boolean;
    public readonly lines: StatementCoverage[] = [];
    public readonly procedures: DeclarationCoverage[] = [];

    constructor(uri: BasicUri, coverageData: CoverageData, isStatementCoverage: boolean) {
        super(Uri.from({ scheme: uri.scheme, path: uri.fsPath, fragment: uri.fragment }), new TestCoverageCount(0, 0));
        this.isStatementCoverage = isStatementCoverage;
        this.addCoverage(coverageData, isStatementCoverage);
    }

    addCoverage(coverageData: CoverageData, isStatementCoverage: boolean) {
        for (const [line, executed] of Object.entries(coverageData.coverage.activeLines)) {
            const linePosition = new Position(Number(line) - 1, 0);

            if (isStatementCoverage) {
                const existingLineIndex = this.lines.findIndex(line => (line.location as Position).isEqual(linePosition));
                if (existingLineIndex >= 0) {
                    const isPreviouslyExecuted = (this.lines[existingLineIndex].executed as boolean);
                    this.lines[existingLineIndex].executed = isPreviouslyExecuted || executed;
                    if (!isPreviouslyExecuted) {
                        this.statementCoverage.covered += executed ? 1 : 0;
                    }
                } else {
                    this.lines.push(new StatementCoverage(executed, linePosition));
                    this.statementCoverage.covered += executed ? 1 : 0;
                    this.statementCoverage.total++;
                }
            } else {
                if (!this.declarationCoverage) {
                    this.declarationCoverage = new TestCoverageCount(0, 0);
                }

                // TODO: What to set for declaration coverage name - maybe use coverageData.coverage.signitures[Number(line) - 1]
                const existingProcedureIndex = this.procedures.findIndex(procedure => (procedure.location as Position).isEqual(linePosition));
                if (existingProcedureIndex >= 0) {
                    const isPreviouslyExecuted = (this.procedures[existingProcedureIndex].executed as boolean);
                    this.procedures[existingProcedureIndex].executed = isPreviouslyExecuted || executed;
                    if (!isPreviouslyExecuted) {
                        this.declarationCoverage.covered += executed ? 1 : 0;
                    }
                } else {
                    this.procedures.push(new DeclarationCoverage(line, executed, linePosition));
                    this.declarationCoverage.covered += executed ? 1 : 0;
                    this.declarationCoverage.total++;
                }
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