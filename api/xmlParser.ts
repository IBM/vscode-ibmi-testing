import { Parser } from "./src";
import { AssertionResult, CallstackItem, TestCaseResult, ValueInfo } from "./types";

export class XMLParser {
    private xml: any;
    private isStreamFile: boolean;
    private parser: Parser;

    constructor(xml: any, isStreamFile: boolean, parser: Parser) {
        this.xml = xml;
        this.isStreamFile = isStreamFile;
        this.parser = parser;
    }

    parseTestResults(): TestCaseResult[] {
        const results: TestCaseResult[] = [];

        for (const testcase of this.xml.elements[0].elements) {
            if (testcase.name !== 'testcase') {
                continue;
            }

            const result: TestCaseResult = {
                name: testcase.attributes.name.toLocaleUpperCase(),
                outcome: testcase.attributes.outcome.toLocaleLowerCase(),
                time: Number((parseFloat(testcase.attributes.time) / 1000).toFixed(2)),
                assertions: parseInt(testcase.attributes.assertions),
                results: []
            };

            for (const assertion of testcase.elements) {
                if (assertion.name === 'success') {
                    const assertionResult = this.parseSuccess(assertion);
                    result.results!.push(assertionResult);
                } else if (assertion.name === 'failure') {
                    const assertionResult = this.parseFailure(assertion);
                    result.results!.push(assertionResult);
                } else if (assertion.name === 'error') {
                    const assertionResult = this.parseError(assertion);
                    result.results!.push(assertionResult);
                }
            }

            results.push(result);
        };

        return results;
    }

    private parseSuccess(success: any): AssertionResult {
        const assertionResult: AssertionResult = {
            name: success.attributes.name,
            outcome: success.name,
            line: this.convertLineNumbers(success.attributes.line)
        };

        for (const child of success.elements) {
            if (child.name === 'expected') {
                const expectedValue = this.parseValueInfo(child);
                if (expectedValue) {
                    assertionResult.expected = expectedValue;
                }
            }
        }

        return assertionResult;
    }

    private parseFailure(failure: any): AssertionResult {
        const assertionResult: AssertionResult = {
            name: failure.attributes.name,
            outcome: failure.name,
            line: this.convertLineNumbers(failure.attributes.line),
            message: failure.attributes.message
        };

        for (const child of failure.elements) {
            if (child.name === 'callstack') {
                const callstack = this.parseCallstack(child);
                if (callstack) {
                    assertionResult.callstack = callstack;
                }
            } else if (child.name === 'expected') {
                const expectedValue = this.parseValueInfo(child);
                if (expectedValue) {
                    assertionResult.expected = expectedValue;
                }
            } else if (child.name === 'actual') {
                const actualValue = this.parseValueInfo(child);
                if (actualValue) {
                    assertionResult.actual = actualValue;
                }
            } else if (child.name === 'diagnosticMessages') {
                const diagnosticMessages = this.parseDiagnosticMessages(child);
                if (diagnosticMessages) {
                    assertionResult.diagnosticMessages = diagnosticMessages;
                }
            }
        }

        return assertionResult;
    }

    private parseError(error: any): AssertionResult {
        const assertionResult: AssertionResult = {
            outcome: error.name,
            message: error.attributes.message,
            errorType: error.attributes.type
        };


        for (const child of error.elements) {
            if (child.name === 'messageSender') {
                const callstack = this.parseCallstackItem(child);
                if (callstack) {
                    assertionResult.messageSender = callstack;
                }
            } else if (child.name === 'messageReceiver') {
                const callstack = this.parseCallstackItem(child);
                if (callstack) {
                    assertionResult.messageReceiver = callstack;
                }
            }
        }

        return assertionResult;
    }

    private parseCallstack(callstack: any): CallstackItem[] | undefined {
        const callstackItems: CallstackItem[] = [];

        for (const child of callstack.elements) {
            callstackItems.push(this.parseCallstackItem(child));
        }

        if (callstackItems.length > 0) {
            return callstackItems;
        }
    }

    private parseCallstackItem(callstackItem: any): CallstackItem {
        return {
            program: callstackItem.attributes.program,
            programLibrary: callstackItem.attributes.programLibrary,
            module: callstackItem.attributes.module,
            moduleLibrary: callstackItem.attributes.moduleLibrary,
            procedure: callstackItem.attributes.procedure,
            line: this.convertLineNumbers(callstackItem.attributes.line)!
        };
    }

    private parseDiagnosticMessages(diagnosticMessages: any): string[] | undefined {
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


    private parseValueInfo(expectedOrActual: any): ValueInfo | undefined {
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

    private convertLineNumbers(rawLine: string | undefined): number | undefined {
        let line = rawLine ? parseInt(rawLine) : undefined;
        if (line) {
            if (this.isStreamFile) {
                // Resolve the expanded source line number to its true line number in the original source
                line = this.parser.resolveLineNumber(line);
            } else {
                // Stream files: Line numbers match line numbers of the source code
                // Source members: Line numbers must be divided by 100 because they are specified with 2 decimal positions
                // https://github.com/tools-400/irpgunit/issues/15#issuecomment-2871972032
                line = line / 100;
            }
        }

        return line;
    }
}