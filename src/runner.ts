import { TestRunRequest, TestItem, TestMessage, Location, CancellationToken, TestRun } from "vscode";
import { IBMiTestData, IBMiTestManager } from "./manager";
import { TestFile } from "./testFile";
import { getInstance } from "./api/ibmi";
import * as path from "path";
import { parseStringPromise } from "xml2js";
import { RUCALLTST } from "./types";
import { Configuration, defaultConfigurations, Section } from "./configuration";

export class IBMiTestRunner {
    public static TEST_OUTPUT_DIRECTORY: string = 'vscode-ibmi-testing';
    private manager: IBMiTestManager;
    private request: TestRunRequest;
    private token: CancellationToken; // TODO: This is should be accounted for during test execution

    constructor(manager: IBMiTestManager, request: TestRunRequest, token: CancellationToken) {
        this.manager = manager;
        this.request = request;
        this.token = token;
    }

    async runHandler() {
        const run = this.manager.controller.createTestRun(this.request);

        // Setup test output directory
        const ibmi = getInstance();
        const connection = ibmi!.getConnection();
        const config = ibmi!.getConfig();
        const testOutputPath = path.posix.join(config.tempDir, IBMiTestRunner.TEST_OUTPUT_DIRECTORY);
        await connection.sendCommand({ command: `mkdir -p ${testOutputPath}` });

        const queue: { item: TestItem, data: IBMiTestData }[] = await this.getTestQueue(run);

        const compiledTestFiles: TestItem[] = [];
        for (const { item, data } of queue) {
            const testFileItem = data instanceof TestFile ? item : item.parent!;
            const testFileData = data instanceof TestFile ? data : this.manager.testData.get(testFileItem)! as TestFile;

            let compiledTestFile = compiledTestFiles.find((testFile) => testFile.id === testFileItem.id);
            if (!compiledTestFile) {
                IBMiTestRunner.updateTestRunStatus(run, 'testFile', { item: testFileItem });

                if (testFileData.didCompile) {
                    IBMiTestRunner.updateTestRunStatus(run, 'compilation', { compilationResult: 'Compilation Skipped' });
                } else {
                    await testFileData.compileMember(run);
                    compiledTestFiles.push(testFileItem);
                }
            }

            if (!testFileData.didCompile) {
                if (data instanceof TestFile) {
                    item.children.forEach((childItem) => {
                        if (!this.request.exclude?.includes(childItem)) {
                            IBMiTestRunner.updateTestRunStatus(run, 'testCase', { item: childItem, errored: true, messages: ['Source must be compiled'] });
                        }
                    });
                } else {
                    IBMiTestRunner.updateTestRunStatus(run, 'testCase', { item: item, errored: true, messages: ['Source must be compiled'] });
                }
                continue;
            }

            // Run test case
            if (run.token.isCancellationRequested) {
                run.skipped(item);
            } else {
                run.started(item);
                await this.runTest(run, item);
            }
        }

        // TODO: Add metrics
        IBMiTestRunner.updateTestRunStatus(run, 'metrics', { numSuitesPassed: 0, numSuites: 0, numTestsPassed: 0, numTests: 0, duration: 0 });

        run.end();
    }

    async getTestQueue(run: TestRun) {
        const queue: { item: TestItem, data: IBMiTestData }[] = [];

        let items: any = [];
        if (this.request.include) {
            items = this.request.include;
        } else {
            this.manager.controller.items.forEach((item) => {
                items.push(item);
            });
        }

        for (const item of items) {
            if (this.request.exclude?.includes(item)) {
                continue;
            }

            const data = this.manager.testData.get(item)!;
            if (data instanceof TestFile && !data.didLoad) {
                await data.load();
            }

            run.enqueued(item);
            queue.push({ item, data });
        }

        return queue;
    }

    async runTest(run: TestRun, item: TestItem) {
        const ibmi = getInstance();
        const connection = ibmi!.getConnection();
        const content = ibmi!.getContent();
        const config = ibmi!.getConfig();

        // TODO: Again, RPGUNIT library must be on the library list
        const library = item.uri?.scheme === 'file' ? config.currentLibrary : connection.parserMemberPath(item.uri!.path).library;
        const programName = (item.parent?.label || item.label).replace(new RegExp(IBMiTestManager.RPGLE_TEST_SUFFIX, 'i'), IBMiTestManager.TEST_SUFFIX).toLocaleUpperCase();

        const tstpgm = `${library}/${programName}`;
        const tstprc = item.parent ? item.label : undefined;
        const xmlstmf = path.posix.join(config.tempDir, IBMiTestRunner.TEST_OUTPUT_DIRECTORY, `${programName}${tstprc ? `-${tstprc}` : ``}.xml`) // TODO: Where to put the xml file? Need to delete it eventually?

        const testParams: RUCALLTST = {
            tstPgm: tstpgm,
            tstPrc: tstprc,
            order: Configuration.get<string>(Section.runOrder),
            detail: Configuration.get<string>(Section.reportDetail),
            output: Configuration.get<string>(Section.createReport),
            libl: Configuration.get<string>(Section.libraryList),
            jobD: Configuration.get<string>(Section.jobDescription),
            rclRsc: Configuration.get<string>(Section.reclaimResources),
            xmlStmf: xmlstmf
            // TODO: Replace with xmlstmf from configurations, but need to figure out how to get the name with resolved variables
            // xmlStmf: Configuration.get<string>(Section.xmlStreamFile) || defaultConfigurations[Section.xmlStreamFile]
        };

        const productLibrary = Configuration.get<string>(Section.productLibrary) || defaultConfigurations[Section.productLibrary];
        const testCommand = content.toCl(`${productLibrary}/RUCALLTST`, testParams as any);
        // TODO: Check stdout as it looks like it has some useful information that should maybe be displayed?
        const testResult = await connection.runCommand({ command: testCommand, environment: `ile` });

        // TODO: Can we get an interface for the parsedXml?
        let parsedXml: any | undefined;
        try {
            const rawXml = (await content.downloadStreamfileRaw(testParams.xmlStmf));
            parsedXml = await parseStringPromise(rawXml);
        } catch (error) {
            // TODO: Need to call updateTestRunStatus on TestItem, but what to log (xml parse error or stdout from testResult)?
        }

        // TODO: How to get actual and expected value for failed test cases to show diff style output message
        parsedXml.testsuite.testcase.forEach((testcase: any) => {
            const duration: number = 0;// TODO: Get duration from XML

            let mappedItem: TestItem;
            if (!item.parent) {
                mappedItem = item.children.get(`${item.uri}/${testcase.$.name}`)!;
            } else {
                mappedItem = item;
            }

            // TODO: Need to handle test case errors
            if (testcase.failure) {
                IBMiTestRunner.updateTestRunStatus(run, 'testCase', { item: mappedItem, failed: true, duration: duration, messages: testcase.failure.map((failure: any) => failure.$.message) });
            } else {
                IBMiTestRunner.updateTestRunStatus(run, 'testCase', { item: mappedItem, success: true, duration: duration });
            }
        });
    }

    // TODO: Fix data to have a type instead of any
    static updateTestRunStatus(run: TestRun, type: 'testFile' | 'upload' | 'compilation' | 'testCase' | 'metrics', data?: any) {
        switch (type) {
            case 'testFile':
                run.appendOutput(data.item.label);
                break;
            case 'upload':
            case 'compilation':
                run.appendOutput(` (${data.compilationResult})\r\n`);
                if (data.messages) {
                    for (const message of data.messages) {
                        run.appendOutput(`\t• ${message}\r\n`);
                    }
                }
                break;
            case 'testCase':
                if (data.success) {
                    run.passed(data.item, data.duration);
                    run.appendOutput(`\t✔ ${data.item.label} (${data.duration}ms)\r\n`);
                } else if (data.failed) {
                    const testMessage = new TestMessage(data.messages.join('. '));
                    testMessage.expectedOutput = data.messages.join('. '); // TODO: Fix this to show proper actual and expected values
                    testMessage.location = new Location(data.item.uri!, data.item.range!);
                    run.failed(data.item, testMessage, data.duration);
                    run.appendOutput(`\t✘ ${data.item.label} (${data.duration}ms)\r\n`);
                    for (const message of data.messages) {
                        run.appendOutput(`\t\t• ${message}\r\n`);
                    }
                } else if (data.errored) {
                    const testMessage = new TestMessage(data.messages.join('. '));
                    testMessage.expectedOutput = data.messages.join('. ');
                    testMessage.location = new Location(data.item.uri!, data.item.range!);
                    run.errored(data.item, testMessage);
                    run.appendOutput(`\t⚠ ${data.item.label}\r\n`);
                    for (const message of data.messages) {
                        run.appendOutput(`\t\t• ${message}\r\n`);
                    }
                } else if (data.skipped) {
                    run.skipped(data.item);
                    run.appendOutput(`\t⊘ ${data.item.label}\r\n`);
                }
                break;
            case 'metrics':
                run.appendOutput(`\r\n`);
                run.appendOutput(`Test Suites: ${data.numSuitesPassed} passed, ${data.numSuites} total\r\n`);
                run.appendOutput(`Tests:       ${data.numTestsPassed} passed, ${data.numTests} total\r\n`);
                run.appendOutput(`Duration:    ${data.duration}s\r\n`);
        }
    }
}