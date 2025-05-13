import { TestRunRequest, TestItem, CancellationToken, TestRun, workspace, LogLevel, TestRunProfileKind, Uri, window, ProgressLocation, commands, WorkspaceFolder } from "vscode";
import { IBMiTestManager } from "./manager";
import { TestFile } from "./testFile";
import { getDeployTools, getInstance } from "./api/ibmi";
import * as path from "path";
import { parseStringPromise } from "xml2js";
import { CODECOV, RUCALLTST, TestQueue, TestMetrics, TestCaseResult, TestStatus } from "./types";
import { Configuration, libraryListValidation, Section } from "./configuration";
import { TestCase } from "./testCase";
import { TestDirectory } from "./testDirectory";
import { Logger } from "./logger";
import { CodeCoverage } from "./codeCoverage";
import { IBMiFileCoverage } from "./fileCoverage";
import { IBMiTestStorage } from "./storage";
import { Utils } from "./utils";
import { TestObject } from "./testObject";
import { RPGUnit } from "./components/rpgUnit";
import { TestLogger } from "./testLogger";
import { XMLParser } from "./xmlParser";

export class IBMiTestRunner {
    private manager: IBMiTestManager;
    private request: TestRunRequest;
    public metrics: TestMetrics;
    private forceCompile: boolean;
    private token: CancellationToken; // TODO: This is should be accounted for during test execution

    constructor(manager: IBMiTestManager, request: TestRunRequest, forceCompile: boolean, token: CancellationToken) {
        this.manager = manager;
        this.request = request;
        this.forceCompile = forceCompile;
        this.token = token;
        this.metrics = {
            duration: 0,
            assertions: 0,
            deployments: { success: 0, failed: 0 },
            compilations: { success: 0, failed: 0, skipped: 0 },
            testFiles: { passed: 0, failed: 0, errored: 0 },
            testCases: { passed: 0, failed: 0, errored: 0 }
        };
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

        Logger.log(LogLevel.Info, `${queue.length} test item(s) queued: ${queue.map((item) => item.item.label).join(', ')}`);
        return queue;
    }

    async processRequest(item: TestItem, run: TestRun, queue: TestQueue): Promise<void> {
        if (this.request.exclude?.includes(item)) {
            return;
        }

        const data = this.manager.testData.get(item)!;
        if (data instanceof TestDirectory || data instanceof TestObject) {
            // Request is a test directory or test object so process children
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
                Logger.log(LogLevel.Warning, `Test file ${data.item.label} not queued (no test cases found)`);
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

        // Check if RPGUnit is installed
        const ibmi = getInstance();
        const connection = ibmi!.getConnection();
        const config = connection.getConfig();

        const componentManager = connection?.getComponentManager();
        const state = await componentManager?.getRemoteState(RPGUnit.ID);
        const productLibrary = Configuration.getOrFallback<string>(Section.productLibrary);
        const title = state === 'NeedsUpdate' ?
            'RPGUnit Update Required' :
            'RPGUnit Installation Required';
        const installMessage = state === 'NeedsUpdate' ?
            `RPGUnit must be updated to v${RPGUnit.MINIMUM_VERSION} on the IBM i.` :
            (state !== 'Installed' ? `RPGUnit must be installed with at least v${RPGUnit.MINIMUM_VERSION} on the IBM i.` : undefined);
        const installQuestion = state === 'NeedsUpdate' ?
            `Can it be updated in ${productLibrary}.LIB?` :
            (state !== 'Installed' ? `Can it be installed into ${productLibrary}.LIB?` : undefined);
        const installButton = state === 'NeedsUpdate' ?
            'Update' :
            (state !== 'Installed' ? 'Install' : undefined);

        if (installMessage && installQuestion && installButton) {
            // End test run
            TestLogger.logComponent(run, installMessage);
            run.end();

            // Prompt user to install or update RPGUnit
            window.showErrorMessage(title, { modal: true, detail: `${installMessage} ${installQuestion}` }, installButton, 'Configure Product Library').then(async (value) => {
                if (value === installButton) {
                    await window.withProgress({ title: `Components`, location: ProgressLocation.Notification }, async (progress) => {
                        progress.report({ message: `Installing ${RPGUnit.ID}` });
                        await componentManager.installComponent(RPGUnit.ID);
                    });
                } else if (value === 'Configure Product Library') {
                    await commands.executeCommand('workbench.action.openSettings', '@ext:IBM.vscode-ibmi-testing');
                }
            });
            return;
        }

        // Validate library list has RPGUNIT and QDEVTOOLS
        await this.validateLibraryList();

        // Setup RPGUNIT and CODECOV storage directories
        IBMiTestStorage.setupTestStorage();

        // Get test queue
        const queue: TestQueue = await this.getTestQueue(run);

        const clearErrorsBeforeBuild = workspace.getConfiguration('code-for-ibmi').get<boolean>('clearErrorsBeforeBuild');
        let isDiagnosticsCleared: boolean = clearErrorsBeforeBuild ? false : true;

        const attemptedDeployments: { workspaceItem: TestItem, isDeployed: boolean }[] = [];
        const attemptedLibraries: TestItem[] = [];

        const compiledTestFileItems: TestItem[] = [];
        for (const { item, data } of queue) {
            const testFileItem = data instanceof TestFile ? item : item.parent!;
            const testFileData = data instanceof TestFile ? data : this.manager.testData.get(testFileItem)! as TestFile;

            if (testFileData.workspaceItem) {
                // Deploy workspace folder associated with test file if not already attemptted
                const workspaceFolder = workspace.getWorkspaceFolder(testFileData.workspaceItem.uri!);
                let attempt = attemptedDeployments.find((attempt) => attempt.workspaceItem.uri?.toString() === workspaceFolder!.uri.toString());
                if (!attempt) {
                    TestLogger.logWorkspace(run, testFileData.workspaceItem);

                    const deployTools = getDeployTools();
                    const defaultDeploymentMethod = config.defaultDeploymentMethod;
                    const deployResult = await deployTools!.launchDeploy(workspaceFolder!.index, defaultDeploymentMethod || undefined);
                    const isDeployed = deployResult ? true : false;
                    attempt = { workspaceItem: testFileData.workspaceItem, isDeployed: isDeployed };
                    attemptedDeployments.push(attempt);
                    TestLogger.logDeployment(run, testFileData.workspaceItem, isDeployed, this.metrics);
                }

                // Error out children if workspace folder not deployed
                // TODO: Fix test file name and directory not being displayed in test results view
                if (!attempt.isDeployed) {
                    TestLogger.logTestFile(run, testFileItem);
                    TestLogger.logCompilation(run, testFileItem, 'skipped', this.metrics);

                    if (data instanceof TestCase) {
                        TestLogger.logTestCaseErrored(run, item, this.metrics);
                    } else {
                        item.children.forEach((childItem) => {
                            if (!this.request.exclude?.includes(childItem)) {
                                TestLogger.logTestCaseErrored(run, childItem, this.metrics);
                            }
                        });
                    }

                    this.metrics.testFiles.errored++;
                    continue;
                }
            } else if (testFileData.libraryItem) {
                const attempt = attemptedLibraries.find((attempt) => attempt.uri?.toString() === testFileData.libraryItem?.uri?.toString());
                if (!attempt) {
                    TestLogger.logLibrary(run, testFileData.libraryItem);
                    attemptedLibraries.push(testFileData.libraryItem);
                }
            }

            // Compile test file if not already compiled
            const compiledTestFileItem = compiledTestFileItems.find((testFile) => testFile.id === testFileItem.id);
            if (!compiledTestFileItem) {
                TestLogger.logTestFile(run, testFileItem);

                if (testFileData.isCompiled && !this.forceCompile) {
                    TestLogger.logCompilation(run, testFileItem, 'skipped', this.metrics);
                } else {
                    if (!isDiagnosticsCleared) {
                        commands.executeCommand('code-for-ibmi.clearDiagnostics');
                        isDiagnosticsCleared = true;
                    }

                    await testFileData.compileTest(this, run);
                    compiledTestFileItems.push(testFileItem);
                }
            }

            // Error out children if test file is not compiled
            if (!testFileData.isCompiled) {
                if (data instanceof TestCase) {
                    TestLogger.logTestCaseErrored(run, item, this.metrics);
                } else {
                    item.children.forEach((childItem) => {
                        if (!this.request.exclude?.includes(childItem)) {
                            TestLogger.logTestCaseErrored(run, childItem, this.metrics);
                        }
                    });
                }

                this.metrics.testFiles.errored++;
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

        TestLogger.logMetrics(run, this.metrics);
        run.end();
    }

    async runTest(run: TestRun, item: TestItem): Promise<void> {
        const ibmi = getInstance();
        const connection = ibmi!.getConnection();
        const content = connection.getContent();
        const config = connection.getConfig();

        const data = this.manager.testData.get(item);
        const isTestCase = data instanceof TestCase;

        let workspaceFolder: WorkspaceFolder | undefined;
        let tstPgm: { name: string, library: string };

        if (item.uri?.scheme === 'file') {
            // Construct test program name without any suffix and convert to system name
            let originalTstPgmName = isTestCase ? item.parent!.label : item.label;
            const testSuffixes = Utils.getTestSuffixes({ rpg: true, cobol: true });
            for (const suffix of testSuffixes.ifs) {
                if (originalTstPgmName.toLocaleUpperCase().endsWith(suffix)) {
                    originalTstPgmName = originalTstPgmName.replace(new RegExp(suffix, 'i'), '');
                }
            }
            originalTstPgmName = originalTstPgmName.toLocaleUpperCase();
            const tstPgmName = Utils.getSystemName(originalTstPgmName);

            // Use current library as the test library
            workspaceFolder = workspace.getWorkspaceFolder(item.uri!)!;
            const libraryList = await ibmi!.getLibraryList(connection, workspaceFolder);
            const tstLibrary = libraryList?.currentLibrary || config.currentLibrary;

            tstPgm = { name: tstPgmName, library: tstLibrary };
        } else {
            const parsedPath = connection.parserMemberPath(item.uri!.path);
            const tstPgmName = parsedPath.name.toLocaleUpperCase();
            const tstLibrary = parsedPath.library;

            tstPgm = { name: tstPgmName, library: tstLibrary };
        }

        const tstpgm = `${tstPgm.library}/${tstPgm.name}`;
        const tstprc = isTestCase ? item.label : undefined;
        const testStorage = IBMiTestStorage.getTestStorage(`${tstPgm.name}${tstprc ? `_${tstprc}` : ``}`);
        Logger.log(LogLevel.Info, `Test storage for ${item.label}: ${JSON.stringify(testStorage)}`);
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
        const productLibrary = Configuration.getOrFallback<string>(Section.productLibrary);
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
        Logger.log(LogLevel.Info, `Running ${item.label}: ${testCommand}`);

        let testResult: any;
        try {
            const env = workspaceFolder ? (await Utils.getEnvConfig(workspaceFolder)) : {};
            testResult = await connection.runCommand({ command: testCommand, environment: `ile`, env: env });
        } catch (error: any) {
            if (isTestCase) {
                TestLogger.logTestCaseErrored(run, item, this.metrics, undefined, undefined, [{ message: error.message ? error.message : error }]);
            } else {
                item.children.forEach((childItem) => {
                    if (!this.request.exclude?.includes(childItem)) {
                        TestLogger.logTestCaseErrored(run, childItem, this.metrics, undefined, undefined, [{ message: error.message ? error.message : error }]);
                    }
                });
            }

            this.metrics.testFiles.errored++;
            return;
        }

        if (testResult.stdout.length > 0) {
            Logger.log(LogLevel.Info, `${item.label} execution output:\n${testResult.stdout}`);
        }
        if (testResult.stderr.length > 0) {
            Logger.log(LogLevel.Error, `${item.label} execution error(s):\n${testResult.stderr}`);
        }

        if (isCodeCoverageEnabled) {
            const codeCoverageResults = await CodeCoverage.getCoverage(coverageParams!.outStmf);
            if (codeCoverageResults) {
                const isStatementCoverage = this.request.profile!.label === IBMiTestManager.LINE_COVERAGE_PROFILE_LABEL;

                for (const fileCoverage of codeCoverageResults) {
                    let uri: Uri;
                    if (workspaceFolder) {
                        // Map code coverage results from deploy directory to local workspace
                        const deployTools = getDeployTools()!;
                        const deployDirectory = deployTools.getRemoteDeployDirectory(workspaceFolder)!;

                        if (`/${fileCoverage.path}`.startsWith(deployDirectory)) {
                            // Get relative remote path to test
                            const relativePathToTest = path.posix.relative(deployDirectory, `/${fileCoverage.path}`);

                            // Construct local path to test
                            const localPath = path.join(workspaceFolder.uri.fsPath, relativePathToTest);
                            uri = Uri.file(localPath);
                        } else {
                            uri = Uri.file(fileCoverage.localPath);
                        }
                    } else {
                        // Map code coverage results to source members
                        let memberPath: string = '';
                        const parts = fileCoverage.path.split('/');

                        if (parts.length === 3 && parts[1].toLocaleUpperCase().endsWith('.FILE')) {
                            // This is a temporary hack due to https://github.com/IBM/vscode-ibmi-testing/issues/70
                            const library = parts[1].split('.')[0];
                            const sourceFile = parts[0];
                            const member = parts[2];
                            memberPath = `/${library}/${sourceFile}/${member}`;
                        } else {
                            for (let index = 0; index < parts.length; index++) {
                                if (index !== parts.length - 1) {
                                    const partName = parts[index].split('.');
                                    if (partName.length > 0) {
                                        memberPath += `/${partName[0]}`;
                                    }
                                } else {
                                    memberPath += `/${parts[index]}`;
                                }
                            }
                        }

                        uri = Uri.from({ scheme: 'member', path: memberPath });
                    }

                    run.addCoverage(new IBMiFileCoverage(uri, fileCoverage, isStatementCoverage));
                }
            }
        }

        // Parse XML test case results
        let testCaseResults: TestCaseResult[] = [];
        try {
            const xmlStmfContent = (await content.downloadStreamfileRaw(testParams.xmlStmf));
            const xml = await parseStringPromise(xmlStmfContent);
            testCaseResults = XMLParser.parseTestResults(xml);
        } catch (error: any) {
            if (isTestCase) {
                testCaseResults.push({
                    name: item.label,
                    status: 'errored',
                    error: [{ message: error.message ? error.message : error }]
                });
            } else {
                item.children.forEach((childItem) => {
                    if (!this.request.exclude?.includes(childItem)) {
                        testCaseResults.push({
                            name: childItem.label,
                            status: 'errored',
                            error: [{ message: error.message ? error.message : error }]
                        });
                    }
                });
            }
        }

        // Process test case results
        let testFileStatus: TestStatus = 'passed';
        for (const testCaseResult of testCaseResults) {
            const parentItem = isTestCase ? item.parent! : item;
            const mappedItem = parentItem.children.get(`${item.uri}/${testCaseResult.name}`);

            if (mappedItem) {
                // Test case result is mapped to a test item
                if (testCaseResult.status === 'passed') {
                    TestLogger.logTestCasePassed(run, mappedItem, this.metrics, testCaseResult.time, testCaseResult.assertions);
                } else if (testCaseResult.status === 'failed') {
                    testFileStatus = 'failed';
                    TestLogger.logTestCaseFailed(run, mappedItem, this.metrics, testCaseResult.time, testCaseResult.assertions, testCaseResult.failure);
                } else if (testCaseResult.status === 'errored') {
                    testFileStatus = 'errored';
                    TestLogger.logTestCaseErrored(run, mappedItem, this.metrics, testCaseResult.time, testCaseResult.assertions, testCaseResult.error);
                }
            } else {
                // Test case result is not mapped to a test item (ie. setUpSuite, setUp, tearDown, tearDownSuite)
                if (testCaseResult.status === 'passed') {
                    // This should never happened
                    Logger.log(LogLevel.Error, `Test case ${item.label} passed${testCaseResult.time !== undefined ? ` in ${testCaseResult.time}s` : ``} but was not mapped to a test item`);
                } else if (testCaseResult.status === 'failed') {
                    testFileStatus = 'failed';
                    TestLogger.logArbitraryTestCaseFailed(run, testCaseResult.name, parentItem, this.metrics, testCaseResult.time, testCaseResult.assertions, testCaseResult.failure);
                } else if (testCaseResult.status === 'errored') {
                    testFileStatus = 'errored';
                    TestLogger.logArbitraryTestCaseErrored(run, testCaseResult.name, parentItem, this.metrics, testCaseResult.time, testCaseResult.assertions, testCaseResult.error);
                }
            }
        }

        if (testFileStatus === 'passed') {
            this.metrics.testFiles.passed++;
        } else if (testFileStatus === 'failed') {
            this.metrics.testFiles.failed++;
        } else if (testFileStatus === 'errored') {
            this.metrics.testFiles.errored++;
        }
    }

    async validateLibraryList() {
        const ibmi = getInstance();
        const connection = ibmi!.getConnection();

        const libraryListValidation = Configuration.get<libraryListValidation>(Section.libraryListValidation);
        if (libraryListValidation) {
            const workspaceFolders = workspace.workspaceFolders;
            const workspaceFolder = workspaceFolders && workspaceFolders.length > 0 ? workspaceFolders[0] : undefined;
            const libraryList = await ibmi!.getLibraryList(connection, workspaceFolder);

            // Check if RPGUnit is on the library list
            if (libraryListValidation.RPGUNIT) {
                const productLibrary = Configuration.getOrFallback<string>(Section.productLibrary);
                if (!libraryList.libraryList.includes(productLibrary)) {
                    Logger.logWithNotification(
                        LogLevel.Warning,
                        `${productLibrary}.LIB not found on the library list. This may impact resolving of include files.`,
                        undefined,
                        [
                            {
                                label: 'Ignore',
                                func: async () => {
                                    await Configuration.set(Section.libraryListValidation, { ...libraryListValidation, RPGUNIT: false });
                                }
                            }
                        ]
                    );
                }
            }

            // Check if QDEVTOOLS is on the library list
            const isCodeCoverageEnabled = this.request.profile?.kind === TestRunProfileKind.Coverage;
            if (isCodeCoverageEnabled && libraryListValidation.QDEVTOOLS) {
                const qdevtoolsLibrary = 'QDEVTOOLS';
                if (!libraryList.libraryList.includes(qdevtoolsLibrary)) {
                    Logger.logWithNotification(
                        LogLevel.Warning,
                        `${qdevtoolsLibrary}.LIB not found on the library list. This may impact code coverage.`,
                        undefined,
                        [
                            {
                                label: 'Ignore',
                                func: async () => {
                                    await Configuration.set(Section.libraryListValidation, { ...libraryListValidation, QDEVTOOLS: false });
                                }
                            }
                        ]
                    );
                }
            }
        }
    }
}