import { TestCaseResult } from "./types";

export namespace XMLParser {
    export function parseTestResults(xml: any): TestCaseResult[] {
        const results: TestCaseResult[] = [];

        xml.testsuite.testcase.forEach((testcase: any) => {
            const testCaseName = testcase.$.name.toLocaleUpperCase();
            const duration: number = parseFloat(testcase.$.time);

            const result: TestCaseResult = {
                name: testCaseName,
                status: 'passed',
                time: duration
            };

            // Parse failure messages
            if (testcase.failure) {
                result.status = 'failed';

                testcase.failure.forEach((failure: any) => {
                    const match = failure._.match(/:(\d+)\)/);
                    const line = match ? parseInt(match[1]) : undefined;

                    if (!result.failure) {
                        result.failure = [];
                    }

                    result.failure.push({
                        line: line,
                        message: failure.$.type ? `${failure.$.type}: ${failure.$.message}` : failure.$.message
                    });
                });
            }

            // Parse error messages
            if (testcase.error) {
                result.status = 'errored';

                testcase.error.forEach((error: any) => {
                    const match = error._.match(/:(\d+)\)/);
                    const line = match ? parseInt(match[1]) : undefined;

                    if (!result.error) {
                        result.error = [];
                    }

                    result.error.push({
                        line: line,
                        message: error.$.type ? `${error.$.type}: ${error.$.message}` : error.$.message
                    });
                });
            }

            results.push(result);
        });

        return results;
    }
}