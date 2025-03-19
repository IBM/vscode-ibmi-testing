import { TestRunRequest, TestItem, TestMessage, Location, CancellationToken, TestRun, workspace, LogLevel, TestRunProfileKind, Uri } from "vscode";
import { IBMiTestData, IBMiTestManager } from "./manager";
import { TestFile } from "./testFile";
import { getDeployTools, getInstance } from "./api/ibmi";
import * as path from "path";
import { parseStringPromise } from "xml2js";
import { CODECOV, RUCALLTST, TestQueue, TestStorage } from "./types";
import { Configuration, defaultConfigurations, Section } from "./configuration";
import { TestCase } from "./testCase";
import { TestDirectory } from "./testDirectory";
import { Logger } from "./outputChannel";
import { CodeCoverage } from "./codeCoverage";
import { IBMiFileCoverage } from "./fileCoverage";

export class IBMiTestRunner {
    private static TEST_OUTPUT_DIRECTORY: string = 'vscode-ibmi-testing';
    private static RPGUNIT_DIRECTORY: string = `RPGUNIT`;
    private static CODECOV_DIRECTORY: string = `CODECOV`;
    private manager: IBMiTestManager;
    private request: TestRunRequest;
    private token: CancellationToken; // TODO: This is should be accounted for during test execution

    constructor(manager: IBMiTestManager, request: TestRunRequest, token: CancellationToken) {
        this.manager = manager;
        this.request = request;
        this.token = token;
    }

    async getTestQueue(run: TestRun): Promise<TestQueue> {
        const queue: TestQueue = [];

        // Gather initial set of requested test items to run
        let requestedItems: any = [];
        if (this.request.include) {
            requestedItems = this.request.include;
        } else {
            this.manager.controller.items.forEach((item) => {
                requestedItems.push(item);
            });
        }

        for (const requestItem of requestedItems) {
            await this.processRequest(requestItem, run, queue);
        }

        return queue;
    }

    async processRequest(item: TestItem, run: TestRun, queue: TestQueue): Promise<void> {
        if (this.request.exclude?.includes(item)) {
            return;
        }

        const data = this.manager.testData.get(item)!;
        if (data instanceof TestDirectory) {
            // Request is a test directory so process children
            const childRequestItems: any = [];
            item.children.forEach((item) => {
                childRequestItems.push(item);
            });
            for (const childRequestItem of childRequestItems) {
                await this.processRequest(childRequestItem, run, queue);
            }
        } else if (data instanceof TestFile) {
            // Request is a test file so load data and add to queue
            await data.load();
            queue.push({ item, data });
        } else if (data instanceof TestCase) {
            // Request is a test case so add to queue
            queue.push({ item, data });
        }

        // Add item to test run queue
        run.enqueued(item);
    }

    async runHandler(): Promise<void> {
        const run = this.manager.controller.createTestRun(this.request);

        // Get test queue
        const queue: { item: TestItem, data: IBMiTestData }[] = await this.getTestQueue(run);
        Logger.getInstance().log(LogLevel.Info, `${queue.length} test item(s) queued: ${queue.map((item) => item.item.label).join(', ')}`);

        const attemptedDeployments: { workspaceItem: TestItem, isDeployed: boolean }[] = [];
        const compiledTestFileItems: TestItem[] = [];
        for (const { item, data } of queue) {
            const testFileItem = data instanceof TestFile ? item : item.parent!;
            const testFileData = data instanceof TestFile ? data : this.manager.testData.get(testFileItem)! as TestFile;

            // Deploy workspace folder associated with test file if not already attemptted
            // TODO: Handle remote case where deploy is ignored (maybe track remote or local in TestFile?)
            const workspaceFolder = workspace.getWorkspaceFolder(testFileData.workspaceItem.uri!);
            let attempt = attemptedDeployments.find((attempt) => attempt.workspaceItem.uri?.toString() === workspaceFolder!.uri.toString());
            if (!attempt) {
                IBMiTestRunner.updateTestRunStatus(run, 'workspaceFolder', { item: testFileData.workspaceItem });

                const deployTools = getDeployTools();
                const deployResult = await deployTools!.launchDeploy(workspaceFolder!.index);
                attempt = { workspaceItem: testFileData.workspaceItem, isDeployed: deployResult ? true : false };
                attemptedDeployments.push(attempt);
                IBMiTestRunner.updateTestRunStatus(run, 'deployment', { item: testFileData.workspaceItem, success: deployResult ? true : false });
            }

            // Error out children if workspace folder not deployed
            // TODO: Fix test file name and directory not being displayed in test results view
            if (!attempt.isDeployed) {
                if (data instanceof TestFile) {
                    item.children.forEach((childItem) => {
                        if (!this.request.exclude?.includes(childItem)) {
                            IBMiTestRunner.updateTestRunStatus(run, 'testCase', { item: childItem, errored: true, messages: ['Source must be deployed'] });
                        }
                    });
                } else {
                    IBMiTestRunner.updateTestRunStatus(run, 'testCase', { item: item, errored: true, messages: ['Source must be deployed'] });
                }

                continue;
            }

            // Compile test file if not already compiled
            const compiledTestFileItem = compiledTestFileItems.find((testFile) => testFile.id === testFileItem.id);
            if (!compiledTestFileItem) {
                IBMiTestRunner.updateTestRunStatus(run, 'testFile', { item: testFileItem });

                if (testFileData.isCompiled) {
                    IBMiTestRunner.updateTestRunStatus(run, 'compilation', { item: testFileItem, skipped: true });
                } else {
                    await testFileData.compileMember(run);
                    compiledTestFileItems.push(testFileItem);
                }
            }

            // Error out children if test file is not compiled
            if (!testFileData.isCompiled) {
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

    async runTest(run: TestRun, item: TestItem): Promise<void> {
        const ibmi = getInstance();
        const connection = ibmi!.getConnection();
        const content = connection.getContent();
        const config = connection.getConfig();

        const library = item.uri?.scheme === 'file' ? config.currentLibrary : connection.parserMemberPath(item.uri!.path).library;
        const data = this.manager.testData.get(item);
        const isTestCase = data instanceof TestCase;
        let programName =
            isTestCase ?
                item.parent!.label :
                item.label;
        programName = programName
            .replace(new RegExp(IBMiTestManager.RPGLE_TEST_SUFFIX, 'i'), '')
            .replace(new RegExp(IBMiTestManager.SQLRPGLE_TEST_SUFFIX, 'i'), '')
            .replace(new RegExp(IBMiTestManager.COBOL_TEST_SUFFIX, 'i'), '')
            .replace(new RegExp(IBMiTestManager.SQLCOBOL_TEST_SUFFIX, 'i'), '')
            .toLocaleUpperCase();

        const tstpgm = `${library}/${programName}`;
        const tstprc = isTestCase ? item.label : undefined;
        const testStorage = IBMiTestRunner.getTestStorage(`${programName}${tstprc ? `_${tstprc}` : ``}`);
        Logger.getInstance().log(LogLevel.Info, `Test storage for ${item.label}: ${JSON.stringify(testStorage)}`);
        const xmlStmf = testStorage.RPGUNIT;

        const testParams: RUCALLTST = {
            tstPgm: tstpgm,
            tstPrc: tstprc,
            order: Configuration.get<string>(Section.runOrder),
            detail: Configuration.get<string>(Section.reportDetail),
            output: Configuration.get<string>(Section.createReport),
            libl: Configuration.get<string>(Section.libraryList),
            jobD: Configuration.get<string>(Section.jobDescription),
            rclRsc: Configuration.get<string>(Section.reclaimResources),
            xmlStmf: xmlStmf
        };

        // Build RUCALLTST command
        const productLibrary = Configuration.get<string>(Section.productLibrary) || defaultConfigurations[Section.productLibrary];
        let testCommand = content.toCl(`${productLibrary}/RUCALLTST`, testParams as any);

        // Build CODECOV command if code coverage is enabled
        const isCodeCoverageEnabled = this.request.profile?.kind === TestRunProfileKind.Coverage;
        let coverageParams: CODECOV | undefined;
        if (isCodeCoverageEnabled) {
            const ccLvl = this.request.profile!.label === IBMiTestManager.LINE_COVERAGE_PROFILE_LABEL ?
                '*LINE' :
                '*PROC';
            coverageParams = {
                cmd: testCommand,
                module: `(${tstpgm} *SRVPGM *ALL)`,
                ccLvl: ccLvl,
                outStmf: testStorage.CODECOV
            };
            testCommand = `QDEVTOOLS/CODECOV CMD(${coverageParams.cmd}) MODULE(${coverageParams.module}) CCLVL(${coverageParams.ccLvl}) OUTSTMF('${coverageParams.outStmf}')`;
        }
        Logger.getInstance().log(LogLevel.Info, `Running ${item.label}: ${testCommand}`);

        // TODO: Check stdout as it looks like it has some useful information that should maybe be displayed?
        const testResult = await connection.runCommand({ command: testCommand, environment: `ile` });
        if (testResult.stdout.length > 0) {
            Logger.getInstance().log(LogLevel.Info, `${item.label} execution output:\n${testResult.stdout}`);
        }
        if (testResult.stderr.length > 0) {
            Logger.getInstance().log(LogLevel.Error, `${item.label} execution error(s):\n${testResult.stderr}`);
        }

        if (isCodeCoverageEnabled) {
            const codeCoverageResults = await CodeCoverage.getCoverage(coverageParams!.outStmf);
            if (codeCoverageResults) {
                const isStatementCoverage = this.request.profile!.label === IBMiTestManager.LINE_COVERAGE_PROFILE_LABEL;

                for (const fileCoverage of codeCoverageResults) {
                    // Get relative remote path to test
                    const workspaceFolder = workspace.getWorkspaceFolder(item.uri!)!;
                    const deployTools = getDeployTools()!;
                    const deployDirectory = deployTools.getRemoteDeployDirectory(workspaceFolder)!;
                    const relativePathToTest = path.posix.relative(deployDirectory, `/${fileCoverage.path}`);

                    // Construct local path to test
                    const localPath = path.join(workspaceFolder.uri.fsPath, relativePathToTest);
                    const localUri = Uri.file(localPath);

                    run.addCoverage(new IBMiFileCoverage(localUri, fileCoverage, isStatementCoverage));
                }
            }
        }

        // TODO: Can we get an interface for the xml?
        let xml: any | undefined;
        try {
            const xmlStmfContent = (await content.downloadStreamfileRaw(testParams.xmlStmf));
            xml = await parseStringPromise(xmlStmfContent);
        } catch (error: any) {
            if (isTestCase) {
                IBMiTestRunner.updateTestRunStatus(run, 'testCase', { item: item, errored: true, messages: ['Failed to parse XML test file results'] });
            } else {
                item.children.forEach((childItem) => {
                    IBMiTestRunner.updateTestRunStatus(run, 'testCase', { item: childItem, errored: true, messages: ['Failed to parse XML test file results'] });
                });
            }

            Logger.getInstance().logWithErrorNotification(LogLevel.Error, `Failed to parse XML test file results`, error);
            return;
        }

        // TODO: How to get actual and expected value for failed test cases to show diff style output message
        xml.testsuite.testcase.forEach((testcase: any) => {
            const duration: number = 0;// TODO: Get duration from XML

            let mappedItem: TestItem;
            if (isTestCase) {
                mappedItem = item;
            } else {
                mappedItem = item.children.get(`${item.uri}/${testcase.$.name.toLocaleUpperCase()}`)!;
            }

            // TODO: Need to handle test case errors
            if (testcase.failure) {
                IBMiTestRunner.updateTestRunStatus(run, 'testCase', { item: mappedItem, failed: true, duration: duration, messages: testcase.failure.map((failure: any) => failure.$.message) });
            } else {
                IBMiTestRunner.updateTestRunStatus(run, 'testCase', { item: mappedItem, success: true, duration: duration });
            }
        });
    }

    static async setupTestStorage(): Promise<void> {
        // Setup test output directory
        const ibmi = getInstance();
        const connection = ibmi!.getConnection();
        const config = connection.getConfig();
        const testStorage = [
            `${config.tempDir}/${IBMiTestRunner.TEST_OUTPUT_DIRECTORY}/${IBMiTestRunner.RPGUNIT_DIRECTORY}`,
            `${config.tempDir}/${IBMiTestRunner.TEST_OUTPUT_DIRECTORY}/${IBMiTestRunner.CODECOV_DIRECTORY}`
        ];
        for (const storage of testStorage) {
            await connection.sendCommand({ command: `mkdir -p ${storage}` });
        }
    }

    static getTestStorage(prefix: string): TestStorage {
        const ibmi = getInstance();
        const connection = ibmi!.getConnection();
        const config = connection.getConfig();

        const time = new Date().getTime();

        return {
            RPGUNIT: `${config.tempDir}/${IBMiTestRunner.TEST_OUTPUT_DIRECTORY}/${IBMiTestRunner.RPGUNIT_DIRECTORY}/${prefix}_${time}.xml`,
            CODECOV: `${config.tempDir}/${IBMiTestRunner.TEST_OUTPUT_DIRECTORY}/${IBMiTestRunner.CODECOV_DIRECTORY}/${prefix}_${time}.cczip`
        };
    }

    // TODO: Fix data to have a type instead of any
    static updateTestRunStatus(run: TestRun, type: 'workspaceFolder' | 'testFile' | 'deployment' | 'compilation' | 'testCase' | 'metrics', data?: any): void {
        switch (type) {
            case 'workspaceFolder':
                run.appendOutput(data.item.label);
                Logger.getInstance().log(LogLevel.Info, `Deploying ${data.item.label}`);
                break;
            case 'testFile':
                run.appendOutput(data.item.label);
                break;
            case 'deployment':
                if (data.success) {
                    run.appendOutput(` (Deployment Successful)\r\n`);
                    Logger.getInstance().log(LogLevel.Info, `Successfully deployed ${data.item.label}`);
                } else {
                    run.appendOutput(` (Deployment Failed)\r\n`);
                    Logger.getInstance().log(LogLevel.Error, `Failed to deploy ${data.item.label}`);
                }
                break;
            case 'compilation':
                if (data.success) {
                    run.appendOutput(` (Compilation Successful)\r\n`);
                    Logger.getInstance().log(LogLevel.Info, `Successfully compiled ${data.item.label}`);
                } else if (data.failed) {
                    run.appendOutput(` (Compilation Failed)\r\n`);
                    Logger.getInstance().log(LogLevel.Error, `Failed to compile ${data.item.label}`);
                } else if (data.skipped) {
                    run.appendOutput(` (Compilation Skipped)\r\n`);
                    Logger.getInstance().log(LogLevel.Warning, `Skipped compilation for ${data.item.label}`);
                }
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
                    Logger.getInstance().log(LogLevel.Info, `Test case ${data.item.label} passed in ${data.duration}ms`);
                } else if (data.failed) {
                    const testMessage = new TestMessage(data.messages.join('. '));
                    testMessage.expectedOutput = data.messages.join('. '); // TODO: Fix this to show proper actual and expected values
                    testMessage.location = new Location(data.item.uri!, data.item.range!);
                    run.failed(data.item, testMessage, data.duration);
                    run.appendOutput(`\t✘ ${data.item.label} (${data.duration}ms)\r\n`);
                    for (const message of data.messages) {
                        run.appendOutput(`\t\t• ${message}\r\n`);
                    }
                    Logger.getInstance().log(LogLevel.Error, `Test case ${data.item.label} failed in ${data.duration}ms`);
                } else if (data.errored) {
                    const testMessage = new TestMessage(data.messages.join('. '));
                    testMessage.expectedOutput = data.messages.join('. ');
                    testMessage.location = new Location(data.item.uri!, data.item.range!);
                    run.errored(data.item, testMessage);
                    run.appendOutput(`\t⚠ ${data.item.label}\r\n`);
                    for (const message of data.messages) {
                        run.appendOutput(`\t\t• ${message}\r\n`);
                    }
                    Logger.getInstance().log(LogLevel.Error, `Test case ${data.item.label} errored`);
                } else if (data.skipped) {
                    run.skipped(data.item);
                    run.appendOutput(`\t⊘ ${data.item.label}\r\n`);
                    Logger.getInstance().log(LogLevel.Warning, `Test case ${data.item.label} skipped`);
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