import { DeclarationCoverage, FileCoverage, Position, StatementCoverage, TestCoverageCount, Uri } from "vscode";

export class IBMiFileCoverage extends FileCoverage {
    readonly lines: StatementCoverage[] = [];
    readonly procedures: DeclarationCoverage[] = [];
    constructor(uri: Uri, isStatementCoverage: boolean, codeCoverage: {
        basename: string;
        path: any;
        localPath: string;
        coverage: {
            signitures: any;
            lineString: any;
            activeLines: any;
            percentRan: string;
        };
    }[]) {
        super(uri, new TestCoverageCount(0, 0));
        for (const file of codeCoverage) {
            for (const [line, executed] of Object.entries(file.coverage.activeLines)) {
                if (isStatementCoverage) {
                    this.lines.push(new StatementCoverage(Boolean(executed), new Position(Number(line) - 1, 0)));
                    this.statementCoverage.covered += executed ? 1 : 0;
                    this.statementCoverage.total++;
                } else {
                    if (!this.declarationCoverage) {
                        this.declarationCoverage = new TestCoverageCount(0, 0);
                    }

                    this.procedures.push(new DeclarationCoverage(line, Boolean(executed), new Position(Number(line) - 1, 1)));
                    this.declarationCoverage.covered += executed ? 1 : 0;
                    this.declarationCoverage.total++;
                }
            }
        }
    }
}