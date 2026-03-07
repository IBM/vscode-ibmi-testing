import { TestStubGenerator } from "./codeActions/testStubGenerator";
import { IBMiTestManager } from "./manager";

export interface TestRunResult {
    testResultLogs: string[];
    testOutputLogs: string[];
}

export interface IBMiTesting {
    getTestManager: () => IBMiTestManager | undefined;
    testStubGenerator: typeof TestStubGenerator;
}