import { AssertionResult, CallstackItem, TestCaseResult, ValueInfo } from "./types";

export namespace XMLParser {
    export function parseTestResults(xml: any, isStreamFile: boolean): TestCaseResult[] {
        const results: TestCaseResult[] = [];

        for (const testcase of xml.elements[0].elements) {
            if (testcase.name !== 'testcase') {
                continue;
            }

            const result: TestCaseResult = {
                name: testcase.attributes.name.toLocaleUpperCase(),
                outcome: testcase.attributes.outcome.toLocaleLowerCase(),
                time: parseFloat(testcase.attributes.time),
                assertions: parseInt(testcase.attributes.assertions),
                results: []
            };

            for (const assertion of testcase.elements) {
                if (assertion.name === 'success') {
                    const assertionResult = parseSuccess(assertion, isStreamFile);
                    result.results!.push(assertionResult);
                } else if (assertion.name === 'failure') {
                    const assertionResult = parseFailure(assertion, isStreamFile);
                    result.results!.push(assertionResult);
                } else if (assertion.name === 'error') {
                    const assertionResult = parseError(assertion, isStreamFile);
                    result.results!.push(assertionResult);
                }
            }

            results.push(result);
        };

        return results;
    }

    function parseSuccess(success: any, isStreamFile: boolean): AssertionResult {
        const assertionResult: AssertionResult = {
            name: success.attributes.name,
            outcome: success.name,
            line: convertLineNumbers(success.attributes.line, isStreamFile)
        };

        for (const child of success.elements) {
            if (child.name === 'expected') {
                const expectedValue = parseValueInfo(child);
                if (expectedValue) {
                    assertionResult.expected = expectedValue;
                }
            }
        }

        return assertionResult;
    }

    function parseFailure(failure: any, isStreamFile: boolean): AssertionResult {
        const assertionResult: AssertionResult = {
            name: failure.attributes.name,
            outcome: failure.name,
            line: convertLineNumbers(failure.attributes.line, isStreamFile),
            message: failure.attributes.message
        };

        for (const child of failure.elements) {
            if (child.name === 'callstack') {
                const callstack = parseCallstack(child, isStreamFile);
                if (callstack) {
                    assertionResult.callstack = callstack;
                }
            } else if (child.name === 'expected') {
                const expectedValue = parseValueInfo(child);
                if (expectedValue) {
                    assertionResult.expected = expectedValue;
                }
            } else if (child.name === 'actual') {
                const actualValue = parseValueInfo(child);
                if (actualValue) {
                    assertionResult.actual = actualValue;
                }
            } else if (child.name === 'diagnosticMessages') {
                const diagnosticMessages = parseDiagnosticMessages(child);
                if (diagnosticMessages) {
                    assertionResult.diagnosticMessages = diagnosticMessages;
                }
            }
        }

        return assertionResult;
    }

    function parseError(error: any, isStreamFile: boolean): AssertionResult {
        const assertionResult: AssertionResult = {
            outcome: error.name,
            message: error.attributes.message,
            errorType: error.attributes.type
        };


        for (const child of error.elements) {
            if (child.name === 'messageSender') {
                const callstack = parseCallstackItem(child, isStreamFile);
                if (callstack) {
                    assertionResult.messageSender = callstack;
                }
            } else if (child.name === 'messageReceiver') {
                const callstack = parseCallstackItem(child, isStreamFile);
                if (callstack) {
                    assertionResult.messageReceiver = callstack;
                }
            }
        }

        return assertionResult;
    }

    function parseCallstack(callstack: any, isStreamFile: boolean): CallstackItem[] | undefined {
        const callstackItems: CallstackItem[] = [];

        for (const child of callstack.elements) {
            callstackItems.push(parseCallstackItem(child, isStreamFile));
        }

        if (callstackItems.length > 0) {
            return callstackItems;
        }
    }

    function parseCallstackItem(callstackItem: any, isStreamFile: boolean): CallstackItem {
        return {
            program: callstackItem.attributes.program,
            programLibrary: callstackItem.attributes.programLibrary,
            module: callstackItem.attributes.module,
            moduleLibrary: callstackItem.attributes.moduleLibrary,
            procedure: callstackItem.attributes.procedure,
            line: convertLineNumbers(callstackItem.attributes.line, isStreamFile)!
        };
    }

    function parseDiagnosticMessages(diagnosticMessages: any): string[] | undefined {
        const messages: string[] = [];

        for (const child of diagnosticMessages.elements) {
            if (child.elements?.length > 0) {
                const text = child.elements[0].text;
                if (text) {
                    messages.push(text);
                }
            }
        }

        if (messages.length > 0) {
            return messages;
        }
    }


    function parseValueInfo(expectedOrActual: any): ValueInfo | undefined {
        const valueInfo: ValueInfo = {
            value: '',
            type: '',
            length: 0,
            originalLength: 0
        };

        for (const child of expectedOrActual.elements) {
            if (child.elements?.length > 0) {
                const childName = child.name as keyof ValueInfo;
                const text = child.elements[0].text;

                if (text) {
                    switch (childName) {
                        case 'length':
                        case 'originalLength':
                            valueInfo[childName] = parseInt(text);
                            break;
                        default:
                            valueInfo[childName] = text;
                    }
                }

            }
        }

        if (valueInfo.value && valueInfo.type && valueInfo.length && valueInfo.originalLength) {
            return valueInfo;
        }
    }

    function convertLineNumbers(rawLine: string | undefined, isStreamFile: boolean): number | undefined {
        let line = rawLine ? parseInt(rawLine) : undefined;
        if (!isStreamFile && line) {
            // Stream files: Line numbers match line numbers of the source code
            // Source members: Line numbers must be divided by 100 because they are specified with 2 decimal positions
            // https://github.com/tools-400/irpgunit/issues/15#issuecomment-2871972032
            line = line / 100;
        }

        return line;
    }
}