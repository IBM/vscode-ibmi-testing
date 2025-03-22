import { TestRunRequest, TestItem, TestMessage, Location, CancellationToken, TestRun, workspace, LogLevel, TestRunProfileKind, Uri, Position } from "vscode";
import { IBMiTestData, IBMiTestManager } from "./manager";
import { TestFile } from "./testFile";
import { getDeployTools, getInstance } from "./api/ibmi";
import * as path from "path";
import { parseStringPromise } from "xml2js";
import { CODECOV, RUCALLTST, TestQueue } from "./types";
import { Configuration, defaultConfigurations, Section } from "./configuration";
import { TestCase } from "./testCase";
import { TestDirectory } from "./testDirectory";
import { Logger } from "./outputChannel";
import { CodeCoverage } from "./codeCoverage";
import { IBMiFileCoverage } from "./fileCoverage";
import { IBMiTestStorage } from "./storage";
import c from "ansi-colors";
import { Utils } from "./utils";

export class IBMiTestRunner {
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

        Logger.getInstance().log(LogLevel.Info, `${queue.length} test item(s) queued: ${queue.map((item) => item.item.label).join(', ')}`);
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

            if (data.item.children.size !== 0) {
                queue.push({ item, data });
            } else {
                Logger.getInstance().log(LogLevel.Warning, `Test file ${data.item.label} not queued (no test cases found)`);
            }
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
                IBMiTestRunner.updateTestRunStatus(run, 'workspaceFolder', {
                    item: testFileData.workspaceItem
                });

                const deployTools = getDeployTools();
                const deployResult = await deployTools!.launchDeploy(workspaceFolder!.index);
                attempt = { workspaceItem: testFileData.workspaceItem, isDeployed: deployResult ? true : false };
                attemptedDeployments.push(attempt);
                IBMiTestRunner.updateTestRunStatus(run, 'deployment', {
                    item: testFileData.workspaceItem,
                    success: deployResult ? true : false
                });
            }

            // Error out children if workspace folder not deployed
            // TODO: Fix test file name and directory not being displayed in test results view
            if (!attempt.isDeployed) {
                IBMiTestRunner.updateTestRunStatus(run, 'testFile', {
                    item: testFileItem
                });
                IBMiTestRunner.updateTestRunStatus(run, 'compilation', {
                    item: testFileItem,
                    status: 'skipped'
                });

                if (data instanceof TestFile) {
                    item.children.forEach((childItem) => {
                        if (!this.request.exclude?.includes(childItem)) {
                            IBMiTestRunner.updateTestRunStatus(run, 'testCase', {
                                item: childItem,
                                status: 'errored'
                            });
                        }
                    });
                } else {
                    IBMiTestRunner.updateTestRunStatus(run, 'testCase', {
                        item: item,
                        status: 'errored'
                    });
                }

                continue;
            }

            // Compile test file if not already compiled
            const compiledTestFileItem = compiledTestFileItems.find((testFile) => testFile.id === testFileItem.id);
            if (!compiledTestFileItem) {
                IBMiTestRunner.updateTestRunStatus(run, 'testFile', {
                    item: testFileItem
                });

                if (testFileData.isCompiled) {
                    IBMiTestRunner.updateTestRunStatus(run, 'compilation', {
                        item: testFileItem,
                        status: 'skipped'
                    });
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
                            IBMiTestRunner.updateTestRunStatus(run, 'testCase', {
                                item: childItem,
                                status: 'errored'
                            });
                        }
                    });
                } else {
                    IBMiTestRunner.updateTestRunStatus(run, 'testCase', {
                        item: item,
                        status: 'errored'
                    });
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
        IBMiTestRunner.updateTestRunStatus(run, 'metrics', {
            testFilesPassed: 0,
            testFilesFailed: 0,
            testFilesErroed: 0,
            testsPassed: 0,
            testsFailed: 0,
            testsErrored: 0,
            duration: 0
        });

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
        const originalProgramName = programName
            .replace(new RegExp(IBMiTestManager.RPGLE_TEST_SUFFIX, 'i'), '')
            .replace(new RegExp(IBMiTestManager.SQLRPGLE_TEST_SUFFIX, 'i'), '')
            .replace(new RegExp(IBMiTestManager.COBOL_TEST_SUFFIX, 'i'), '')
            .replace(new RegExp(IBMiTestManager.SQLCOBOL_TEST_SUFFIX, 'i'), '')
            .toLocaleUpperCase();
        programName = Utils.getSystemName(originalProgramName);

        const tstpgm = `${library}/${programName}`;
        const tstprc = isTestCase ? item.label : undefined;
        const testStorage = IBMiTestStorage.getTestStorage(`${programName}${tstprc ? `_${tstprc}` : ``}`);
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
                    const workspaceFolder = workspace.getWorkspaceFolder(item.uri!)!;
                    const deployTools = getDeployTools()!;
                    const deployDirectory = deployTools.getRemoteDeployDirectory(workspaceFolder)!;

                    let uri: Uri;
                    if (fileCoverage.path.startsWith(deployDirectory)) {
                        // Get relative remote path to test
                        const relativePathToTest = path.posix.relative(deployDirectory, `/${fileCoverage.path}`);

                        // Construct local path to test
                        const localPath = path.join(workspaceFolder.uri.fsPath, relativePathToTest);
                        uri = Uri.file(localPath);
                    } else {
                        uri = Uri.file(fileCoverage.localPath);
                    }

                    run.addCoverage(new IBMiFileCoverage(uri, fileCoverage, isStatementCoverage));
                }
            }
        }

        let xml: any | undefined;
        try {
            const xmlStmfContent = (await content.downloadStreamfileRaw(testParams.xmlStmf));
            xml = await parseStringPromise(xmlStmfContent);
        } catch (error: any) {
            if (isTestCase) {
                IBMiTestRunner.updateTestRunStatus(run, 'testCase', {
                    item: item,
                    status: 'errored',
                    messages: ['Failed to parse XML test file results']
                });
            } else {
                item.children.forEach((childItem) => {
                    IBMiTestRunner.updateTestRunStatus(run, 'testCase', {
                        item: childItem,
                        status: 'errored',
                        messages: ['Failed to parse XML test file results']
                    });
                });
            }

            Logger.getInstance().logWithErrorNotification(LogLevel.Error, `Failed to parse XML test file results`, error);
            return;
        }

        xml.testsuite.testcase.forEach((testcase: any) => {
            const duration: number = parseFloat(testcase.$.time);

            const testCaseName = testcase.$.name.toLocaleUpperCase();
            const parentItem = isTestCase ? item.parent! : item;
            const mappedItem = parentItem.children.get(`${item.uri}/${testCaseName}`)!;

            if (testcase.failure || testcase.error) {
                const messages: { line?: number, message: string }[] = [];

                if (testcase.failure) {
                    testcase.failure.forEach((failure: any) => {
                        const match = failure._.match(/:(\d+)\)/);
                        const line = match ? parseInt(match[1]) : undefined;

                        messages.push({
                            line: line,
                            message: failure.$.type ? `${failure.$.type}: ${failure.$.message}` : failure.$.message
                        });
                    });
                }

                if (testcase.error) {
                    testcase.error.forEach((error: any) => {
                        const match = error._.match(/:(\d+)\)/);
                        const errorLine = match ? parseInt(match[1]) : undefined;

                        messages.push({
                            line: errorLine,
                            message: error.$.type ? `${error.$.type}: ${error.$.message}` : error.$.message
                        });
                    });
                }

                IBMiTestRunner.updateTestRunStatus(run, 'testCase', {
                    item: mappedItem,
                    status: testcase.error ? 'errored' : 'failed',
                    duration: duration,
                    messages: messages,
                    fallbackTestFile: parentItem,
                    fallBackTestCaseName: testCaseName
                });
            } else {
                IBMiTestRunner.updateTestRunStatus(run, 'testCase', {
                    item: mappedItem,
                    status: 'passed',
                    duration: duration
                });
            }
        });
    }

    // TODO: Fix data to have a type instead of any
    static updateTestRunStatus(run: TestRun, type: 'workspaceFolder' | 'testFile' | 'deployment' | 'compilation' | 'testCase' | 'metrics', data?: any): void {
        switch (type) {
            case 'workspaceFolder':
                run.appendOutput(`${c.bgBlue(` WORKSPACE `)} ${data.item.label} ${c.grey(`(${data.item.children.size})`)}`);
                Logger.getInstance().log(LogLevel.Info, `Deploying ${data.item.label}`);
                break;
            case 'testFile':
                run.appendOutput(`${c.blue(`❯`)} ${data.item.label} ${c.grey(`(${data.item.children.size})`)}`);
                break;
            case 'deployment':
                if (data.success) {
                    run.appendOutput(` ${c.grey(`[ Deployment Successful ]`)}\r\n`);
                    Logger.getInstance().log(LogLevel.Info, `Successfully deployed ${data.item.label}`);
                } else {
                    run.appendOutput(` ${c.red(`[ Deployment Failed ]`)}\r\n`);
                    Logger.getInstance().log(LogLevel.Error, `Failed to deploy ${data.item.label}`);
                }
                break;
            case 'compilation':
                if (data.status === 'success') {
                    run.appendOutput(` ${c.grey(`[ Compilation Successful ]`)}\r\n`);
                    Logger.getInstance().log(LogLevel.Info, `Successfully compiled ${data.item.label}`);
                } else if (data.status === 'failed') {
                    run.appendOutput(` ${c.red(`[ Compilation Failed ]`)}\r\n`);
                    Logger.getInstance().log(LogLevel.Error, `Failed to compile ${data.item.label}`);
                } else if (data.status === 'skipped') {
                    run.appendOutput(` ${c.grey(`[ Compilation Skipped ]`)}\r\n`);
                    Logger.getInstance().log(LogLevel.Warning, `Skipped compilation for ${data.item.label}`);
                }
                if (data.messages) {
                    for (const message of data.messages) {
                        run.appendOutput(`\t${c.red(`${message}`)}\r\n`);
                    }
                }
                break;
            case 'testCase':
                if (data.status === 'passed') {
                    run.passed(data.item, data.duration * 1000);
                    run.appendOutput(`\t${c.green(`✔`)}  ${data.item.label} ${c.grey(`${data.duration}s`)}\r\n`);
                    Logger.getInstance().log(LogLevel.Info, `Test case ${data.item.label} passed in ${data.duration}s`);
                } else if (data.status === 'failed') {
                    run.appendOutput(`\t${c.red(`✘`)}  ${data.item?.label || data.fallBackTestCaseName} ${c.grey(data.duration !== undefined ? `${data.duration}s` : ``)}\r\n`);

                    const testMessages: TestMessage[] = [];
                    if (data.messages) {
                        for (const messageData of data.messages) {
                            run.appendOutput(`\t\t${c.red(`${c.bold(`Failure:`)} ${messageData.message}`)}\r\n`);

                            const testMessage = new TestMessage(messageData.message);
                            const range = messageData.line ? new Position(messageData.line - 1, 0) : data.item?.range;
                            testMessage.location = range ? new Location(data.item?.uri || data.fallbackTestFile.uri, range) : undefined;
                            testMessages.push(testMessage);
                        }
                    }

                    if (data.item) {
                        run.failed(data.item, testMessages, data.duration !== undefined ? data.duration * 1000 : undefined);
                        Logger.getInstance().log(LogLevel.Error, `Test case ${data.item.label} failed${data.duration !== undefined ? ` in ${data.duration}s` : ``}`);
                    } else {
                        run.failed(data.fallbackTestFile, testMessages, data.duration !== undefined ? data.duration * 1000 : undefined);
                    }
                } else if (data.status === 'errored') {
                    run.appendOutput(`\t${c.yellow(`⚠`)}  ${data.item?.label || data.fallBackTestCaseName} ${c.grey(data.duration !== undefined ? `${data.duration}s` : ``)}\r\n`);

                    const testMessages: TestMessage[] = [];
                    if (data.messages) {
                        for (const messageData of data.messages) {
                            run.appendOutput(`\t\t${c.yellow(`${c.bold(`Error:`)} ${messageData.message}`)}\r\n`);

                            const testMessage = new TestMessage(messageData.message);
                            const range = messageData.line ? new Position(messageData.line - 1, 0) : data.item?.range;
                            testMessage.location = range ? new Location(data.item?.uri || data.fallbackTestFile.uri, range) : undefined;
                            testMessages.push(testMessage);
                        }
                    }

                    if (data.item) {
                        run.errored(data.item, testMessages, data.duration !== undefined ? data.duration * 1000 : undefined);
                        Logger.getInstance().log(LogLevel.Error, `Test case ${data.item.label} errored${data.duration !== undefined ? ` in ${data.duration}s` : ``}`);
                    } else {
                        run.errored(data.fallbackTestFile, testMessages, data.duration !== undefined ? data.duration * 1000 : undefined);
                    }
                }
                break;
            case 'metrics':
                const totalTestFiles = data.testFilesFailed + data.testFilesPassed + data.testFilesErroed;
                const totalTests = data.testsFailed + data.testsPassed + data.testsErrored;

                run.appendOutput(`\r\n`);
                run.appendOutput(c.blue(`┌─────────────────────────────────────────────────┐\r\n`));
                run.appendOutput(`${c.blue(`│`)} Test Files: ${c.green(`${data.testFilesPassed} passed`)} | ${c.red(`${data.testFilesFailed} failed`)} | ${c.yellow(`${data.testFilesErroed} errored`)} (${totalTestFiles}) ${c.blue(`│`)}\r\n`);
                run.appendOutput(`${c.blue(`│`)} Tests:      ${c.green(`${data.testsPassed} passed`)} | ${c.red(`${data.testsFailed} failed`)} | ${c.yellow(`${data.testsErrored} errored`)} (${totalTests}) ${c.blue(`│`)}\r\n`);
                run.appendOutput(`${c.blue(`│`)} Duration:   ${data.duration}s                                  ${c.blue(`│`)}\r\n`);
                run.appendOutput(c.blue(`└─────────────────────────────────────────────────┘`));
        }
    }
}