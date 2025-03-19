import { DeclarationCoverage, FileCoverage, Position, StatementCoverage, TestCoverageCount, Uri } from "vscode";
import { CoverageData } from "./types";

export class IBMiFileCoverage extends FileCoverage {
    public isStatementCoverage: boolean;
    public readonly lines: StatementCoverage[] = [];
    public readonly procedures: DeclarationCoverage[] = [];
    constructor(uri: Uri, coverageData: CoverageData, isStatementCoverage: boolean) {
        super(uri, new TestCoverageCount(0, 0));
        this.isStatementCoverage = isStatementCoverage;

        for (const [line, executed] of Object.entries(coverageData.coverage.activeLines)) {
            if (isStatementCoverage) {
                this.lines.push(new StatementCoverage(Boolean(executed), new Position(Number(line) - 1, 0)));
                this.statementCoverage.covered += executed ? 1 : 0;
                this.statementCoverage.total++;
            } else {
                if (!this.declarationCoverage) {
                    this.declarationCoverage = new TestCoverageCount(0, 0);
                }

                // TODO: What to set for declaration coverage name - maybe use coverageData.coverage.signitures[Number(line) - 1]
                this.procedures.push(new DeclarationCoverage(line, Boolean(executed), new Position(Number(line) - 1, 0)));
                this.declarationCoverage.covered += executed ? 1 : 0;
                this.declarationCoverage.total++;
            }
        }
    }
}