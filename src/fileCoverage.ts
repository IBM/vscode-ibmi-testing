import { FileCoverage, Position, StatementCoverage, TestCoverageCount, Uri } from "vscode";

export class IBMiFileCoverage extends FileCoverage {
    readonly coveredLines: StatementCoverage[] = [];
    constructor(uri: Uri, codeCoverage: {
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
                this.coveredLines.push(new StatementCoverage(executed ? 1 : 0, new Position(Number(line) - 1, 0)));
                this.statementCoverage.covered += executed ? 1 : 0;
                this.statementCoverage.total++;
            }
        }
    }
}