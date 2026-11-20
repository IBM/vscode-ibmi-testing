import { RpgTestStubGenerator } from "./codeActions/rpg/rpgTestStubGenerator";
import { SqlTestStubGenerator } from "./codeActions/sql/sqlTestStubGenerator";
import { IBMiTestManager } from "./manager";

export interface TestRunResult {
    testResultLogs: string[];
    testOutputLogs: string[];
}

export interface IBMiTesting {
    getTestManager: () => IBMiTestManager | undefined;
    rpgTestStubGenerator: typeof RpgTestStubGenerator;
    sqlTestStubGenerator: typeof SqlTestStubGenerator;
}