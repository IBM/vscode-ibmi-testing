import { IBMiTestManager } from "./manager";

export interface TestRunResult {
    testResultLogs: string[];
    testOutputLogs: string[];
}

export interface IBMiTesting {
    getTestManager: () => IBMiTestManager | undefined;
}