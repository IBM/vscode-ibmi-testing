import { TestRunRequest, TestItem, TestRun, workspace, TestRunProfileKind, Uri, commands, TestMessage, Position, Location } from "vscode";
import { IBMiTestManager } from "./manager";
import { getDeployTools, getInstance } from "./extensions/ibmi";
import { Configuration, libraryListValidation, Section } from "./configuration";
import { IBMiFileCoverage } from "./fileCoverage";
import { RPGUnit } from "./components/rpgUnit";
import { Runner, TestCallbacks } from "./api/runner";
import { BasicUri, DeploymentStatus, Env, LogLevel, RUCALLTST, TestBucket, TestRequest } from "./api/types";
import { TestLogger } from "./api/testLogger";
import { TestResultLogger } from "./loggers/testResultLogger";
import { ILELibrarySettings } from "@halcyontech/vscode-ibmi-types/api/CompileTools";
import { Utils } from "./utils";
import { testOutputLogger } from "./extension";
import { TestCaseData, TestFileData } from "./testData";
import { ApiUtils } from "./api/apiUtils";
import * as path from "path";

export class IBMiTestRunner {
    private manager: IBMiTestManager;
    private request: TestRunRequest;
    private forceCompile: boolean;

    constructor(manager: IBMiTestManager, request: TestRunRequest, forceCompile: boolean) {
        this.manager = manager;
        this.request = request;
        this.forceCompile = forceCompile;
    }

    private async buildTestBucket(testRun: TestRun): Promise<TestBucket[]> {
        const testBuckets: TestBucket[] = [];

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
            await this.processRequestItems(testRun, testBuckets, requestItem);
        }

        // TODO: Add logging here
        // await testOutputLogger.log(LogLevel.Info, `${testBucket.length} test item(s) queued: ${testBucket.map((item) => item.item.label).join(', ')}`);
        return testBuckets;
    }

    private async processRequestItems(testRun: TestRun, testBuckets: TestBucket[], item: TestItem): Promise<void> {
        if (this.request.exclude?.includes(item)) {
            return;
        }

        const data = this.manager.testMap.get(item)!;
        if (data.type === 'directory' || data.type === 'object') {
            // Request is a test directory or test object so process children
            const childRequestItems: any = [];
            item.children.forEach((item) => {
                childRequestItems.push(item);
            });
            for (const childRequestItem of childRequestItems) {
                await this.processRequestItems(testRun, testBuckets, childRequestItem);
            }
        } if (data.type === 'file' && data instanceof TestFileData) {
            // Request is a test file so ensure test cases are loaded
            await data.load();

            if (data.item.children.size !== 0) {
                this.addToTestBucket(testRun, testBuckets, data);
            } else {
                await testOutputLogger.log(LogLevel.Warning, `Test file ${data.item.label} not queued (no test cases found)`);
            }
        } else if (data.type === 'case' && data instanceof TestCaseData) {
            if (!this.request.exclude?.includes(data.item)) {
                this.addToTestBucket(testRun, testBuckets, data);
            }
        }
    }

    private addToTestBucket(testRun: TestRun, testBuckets: TestBucket[], data: TestFileData | TestCaseData): void {
        let testBucketItem: TestItem;
        let testFileItem: TestItem;
        let testFileData: TestFileData;
        let testCaseItem: TestItem | undefined;

        if (data instanceof TestFileData) {
            testBucketItem = data.rootItem;
            testFileItem = data.item;
            testFileData = data;
        } else {
            testBucketItem = data.rootItem;
            testFileItem = data.fileItem;
            testFileData = this.manager.testMap.get(data.fileItem)! as TestFileData;
            testCaseItem = data.item;
        }

        // Add test bucket
        let existingTestBucketIndex = testBuckets.findIndex((testBucket) => testBucket.uri.fsPath === testBucketItem.uri!.fsPath);
        if (existingTestBucketIndex < 0) {
            testBuckets.push({
                name: testBucketItem.label,
                uri: { scheme: testBucketItem.uri!.scheme as any, fsPath: testBucketItem.uri!.fsPath, fragment: '' },
                testSuites: []
            });
            existingTestBucketIndex = testBuckets.length - 1;
        }
        testRun.enqueued(testBucketItem);

        // Add test suite
        let existingTestSuiteIndex = testBuckets[existingTestBucketIndex].testSuites.findIndex((testSuite) => testSuite.uri.fsPath === testFileItem.uri!.fsPath);
        if (existingTestSuiteIndex < 0) {
            let ccLvl: '*LINE' | '*PROC' | undefined;
            if (this.request.profile?.kind === TestRunProfileKind.Coverage) {
                ccLvl = this.request.profile.label.includes('Line Coverage') ? '*LINE' : '*PROC';
            } else {
                ccLvl = undefined;
            }

            testBuckets[existingTestBucketIndex].testSuites.push({
                name: testFileItem.label,
                systemName: ApiUtils.getSystemNameFromPath(path.parse(testFileItem.uri!.fsPath).name),
                uri: { scheme: testFileItem.uri!.scheme as any, fsPath: testFileItem.uri!.fsPath, fragment: '' },
                testCases: [],
                isCompiled: testFileData.isCompiled,
                isEntireSuite: true,
                ccLvl: ccLvl
            });
            existingTestSuiteIndex = testBuckets[existingTestBucketIndex].testSuites.length - 1;
        }
        testRun.enqueued(testFileItem);

        // Add test cases
        if (testCaseItem) {
            if (!this.request.exclude?.includes(testCaseItem)) {
                testBuckets[existingTestBucketIndex].testSuites[existingTestSuiteIndex].testCases.push({
                    name: testCaseItem.label,
                    uri: { scheme: testCaseItem.uri!.scheme as any, fsPath: testCaseItem.uri!.fsPath, fragment: testCaseItem.label }
                });
                testBuckets[existingTestBucketIndex].testSuites[existingTestSuiteIndex].isEntireSuite = false;
                testRun.enqueued(testCaseItem);
            }
        } else {
            testFileItem.children.forEach((childItem) => {
                if (!this.request.exclude?.includes(childItem)) {
                    testBuckets[existingTestBucketIndex].testSuites[existingTestSuiteIndex].testCases.push({
                        name: childItem.label,
                        uri: { scheme: childItem.uri!.scheme as any, fsPath: childItem.uri!.fsPath, fragment: childItem.label }
                    });
                    testRun.enqueued(childItem);
                } else {
                    testBuckets[existingTestBucketIndex].testSuites[existingTestSuiteIndex].isEntireSuite = false;
                }
            });
        }
    }

    async runHandler() {
        const ibmi = getInstance();
        const connection = ibmi!.getConnection();
        const config = connection.getConfig();

        // Create test run
        const testRun = this.manager.controller.createTestRun(this.request);

        // Create test logger
        const testResultLogger = new TestResultLogger(testRun);
        const testLogger = new TestLogger(testOutputLogger, testResultLogger);

        // Check if RPGUnit is installed
        const installation = await RPGUnit.checkInstallation();
        if (!installation.status) {
            if (installation.error) {
                // End test run
                testRun.end();
                await testLogger.logComponentError(installation.error);
                return;
            }
        }

        // Build test bucket and request
        const testBuckets = await this.buildTestBucket(testRun);
        const testRequest: TestRequest = {
            forceCompile: this.forceCompile,
            testBuckets: testBuckets
        };

        // Validate library list has RPGUNIT and QDEVTOOLS
        await this.validateLibraryList(testBuckets);

        // Setup test callbacks
        const deployTools = getDeployTools();
        const allTestItems = this.manager.getFlattenedTestItems();
        const testCallbacks: TestCallbacks = {
            deploy: async (workspaceFolderPath: string): Promise<DeploymentStatus> => {
                const workspaceFolder = workspace.getWorkspaceFolder(Uri.file(workspaceFolderPath))!;
                const defaultDeploymentMethod = config.defaultDeploymentMethod;
                const deployResult = await deployTools!.launchDeploy(workspaceFolder.index, defaultDeploymentMethod || undefined);
                const deploymentStatus = deployResult ? 'success' : 'failed';
                return deploymentStatus;
            },
            getDeployDirectory: (workspaceFolderPath: string): string => {
                const workspaceFolder = workspace.getWorkspaceFolder(Uri.file(workspaceFolderPath))!;
                const deployDirectory = deployTools!.getRemoteDeployDirectory(workspaceFolder)!;
                return deployDirectory;
            },
            getLibraryList: async (workspaceFolderPath?: string): Promise<ILELibrarySettings> => {
                const workspaceFolder = workspaceFolderPath ? workspace.getWorkspaceFolder(Uri.file(workspaceFolderPath)) : undefined;
                const libraryList = await ibmi!.getLibraryList(connection, workspaceFolder);
                return libraryList;
            },
            isDiagnosticsCleared: (): boolean => {
                const clearErrorsBeforeBuild = workspace.getConfiguration('code-for-ibmi').get<boolean>('clearErrorsBeforeBuild');
                let isDiagnosticsCleared: boolean = clearErrorsBeforeBuild ? false : true;
                return isDiagnosticsCleared;
            },
            clearDiagnostics: async (): Promise<void> => {
                await commands.executeCommand('code-for-ibmi.clearDiagnostics');
            },
            loadDiagnostics: async (qualifiedObject: string, workspaceFolderPath?: string): Promise<void> => {
                const workspaceFolder = workspaceFolderPath ? workspace.getWorkspaceFolder(Uri.file(workspaceFolderPath)) : undefined;
                await commands.executeCommand('code-for-ibmi.openErrors', {
                    qualifiedObject: qualifiedObject,
                    workspace: workspaceFolder,
                    keepDiagnostics: true
                });
            },
            getEnvConfig: async (workspaceFolderPath: string): Promise<Env> => {
                const workspaceFolder = workspace.getWorkspaceFolder(Uri.file(workspaceFolderPath));
                const env = workspaceFolder ? (await Utils.getEnvConfig(workspaceFolder)) : {};
                return env;
            },
            getProductLibrary: (): string => {
                const productLibrary = Configuration.getOrFallback<string>(Section.productLibrary);
                return productLibrary;
            },
            getTestParams: (tstpgm: string, xmlStmf: string, tstPrc?: string): RUCALLTST => {
                const testParams: RUCALLTST = {
                    tstPgm: tstpgm,
                    tstPrc: tstPrc,
                    order: Configuration.get<string>(Section.runOrder),
                    detail: Configuration.get<string>(Section.reportDetail),
                    output: Configuration.get<string>(Section.createReport),
                    libl: Configuration.get<string>(Section.libraryList),
                    jobD: Configuration.get<string>(Section.jobDescription),
                    rclRsc: Configuration.get<string>(Section.reclaimResources),
                    xmlStmf: xmlStmf
                };

                return testParams;
            },
            setIsCompiled: async (uri: BasicUri, isCompiled: boolean): Promise<void> => {
                const testItem = allTestItems.find((item) =>
                    item.uri!.scheme === uri.scheme &&
                    item.uri!.fsPath === uri.fsPath &&
                    (!uri.fragment || item.label === uri.fragment));

                if (testItem) {
                    const testData = this.manager.testMap.get(testItem);
                    if (testData && testData instanceof TestFileData) {
                        testData.isCompiled = isCompiled;
                    }
                }
            },
            started: async (uri: BasicUri): Promise<void> => {
                const testItem = allTestItems.find((item) =>
                    item.uri!.scheme === uri.scheme &&
                    item.uri!.fsPath === uri.fsPath &&
                    (!uri.fragment || item.label === uri.fragment));

                if (testItem) {
                    testRun.started(testItem);
                }
            },
            skipped: async (uri: BasicUri): Promise<void> => {
                const testItem = allTestItems.find((item) =>
                    item.uri!.scheme === uri.scheme &&
                    item.uri!.fsPath === uri.fsPath &&
                    (!uri.fragment || item.label === uri.fragment));

                if (testItem) {
                    testRun.skipped(testItem);
                }
            },
            passed: async (uri: BasicUri, duration?: number): Promise<void> => {
                const testItem = allTestItems.find((item) =>
                    item.uri!.scheme === uri.scheme &&
                    item.uri!.fsPath === uri.fsPath &&
                    (!uri.fragment || item.label === uri.fragment));

                if (testItem) {
                    testRun.passed(testItem, duration);
                }
            },
            failed: async (uri: BasicUri, messages: { line?: number; message: string; }[], duration?: number): Promise<void> => {
                const testItem = allTestItems.find((item) =>
                    item.uri!.scheme === uri.scheme &&
                    item.uri!.fsPath === uri.fsPath &&
                    (!uri.fragment || item.label === uri.fragment));

                if (testItem) {
                    // Add messages inline in the editor
                    const testMessages: TestMessage[] = [];
                    for (const message of messages) {
                        const testMessage = new TestMessage(message.message);
                        const range = message.line ? new Position(message.line - 1, 0) : testItem.range;
                        testMessage.location = range ? new Location(testItem.uri!, range) : undefined;
                        testMessages.push(testMessage);
                    }

                    testRun.failed(testItem, testMessages, duration);
                }
            },
            errored: async (uri: BasicUri, messages: { line?: number; message: string; }[], duration?: number): Promise<void> => {
                const testItem = allTestItems.find((item) =>
                    item.uri!.scheme === uri.scheme &&
                    item.uri!.fsPath === uri.fsPath &&
                    (!uri.fragment || item.label === uri.fragment));

                if (testItem) {
                    // Add messages inline in the editor
                    const testMessages: TestMessage[] = [];
                    for (const message of messages) {
                        const testMessage = new TestMessage(message.message);
                        const range = message.line ? new Position(message.line - 1, 0) : testItem.range;
                        testMessage.location = range ? new Location(testItem.uri!, range) : undefined;
                        testMessages.push(testMessage);
                    }

                    testRun.errored(testItem, testMessages, duration);
                }
            },
            addCoverage: (fileCoverage: IBMiFileCoverage): void => {
                testRun.addCoverage(fileCoverage);
            },
            end: async (): Promise<void> => {
                testRun.end();
            }
        };

        // Run test buckets
        const runner: Runner = new Runner(testRequest, testCallbacks, testLogger);
        await runner.run();
    }

    private async validateLibraryList(testBuckets: TestBucket[]): Promise<void> {
        const libraryListValidation = Configuration.get<libraryListValidation>(Section.libraryListValidation);
        if (libraryListValidation) {
            const ibmi = getInstance();
            const connection = ibmi!.getConnection();

            const productLibrary = Configuration.getOrFallback<string>(Section.productLibrary);
            const qdevtoolsLibrary = 'QDEVTOOLS';

            const testBucketsMissingProductLibrary = [];
            const testBucketsMissingQDevToolsLibrary = [];

            for (const testBucket of testBuckets) {
                const workspaceFolders = workspace.workspaceFolders;
                const workspaceFolder = workspaceFolders && workspaceFolders.length > 0 ?
                    workspaceFolders.find(workspaceFolder => workspaceFolder.uri.scheme === testBucket.uri.scheme && workspaceFolder.uri.fsPath === testBucket.uri.fsPath)
                    : undefined;
                const libraryList = await ibmi!.getLibraryList(connection, workspaceFolder);

                // Check if RPGUnit is on the library list
                if (libraryListValidation.RPGUNIT) {
                    if (!libraryList.libraryList.includes(productLibrary)) {
                        testBucketsMissingProductLibrary.push(testBucket);
                    }
                }

                // Check if QDEVTOOLS is on the library list
                const isCodeCoverageEnabled = this.request.profile?.kind === TestRunProfileKind.Coverage;
                if (isCodeCoverageEnabled && libraryListValidation.QDEVTOOLS) {
                    if (!libraryList.libraryList.includes(qdevtoolsLibrary)) {
                        testBucketsMissingQDevToolsLibrary.push(testBucket);
                    }
                }
            }

            // Warn user which test buckets are missing the RPGUnit library
            if (testBucketsMissingProductLibrary.length > 0) {
                testOutputLogger.logWithNotification(
                    LogLevel.Warning,
                    `${productLibrary}.LIB not found on the library list. This may impact resolving of include files for the following: ${testBucketsMissingProductLibrary.map(bucket => bucket.name).join(', ')}`,
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

            // Warn user which test buckets are missing the QDEVTOOLS library
            if (testBucketsMissingQDevToolsLibrary.length > 0) {
                testOutputLogger.logWithNotification(
                    LogLevel.Warning,
                    `${qdevtoolsLibrary}.LIB not found on the library list. This may impact code coverage for the following: ${testBucketsMissingQDevToolsLibrary.map(bucket => bucket.name).join(', ')}`,
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