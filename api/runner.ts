
import { parseStringPromise } from "xml2js";
import { MergedCoverageData, BasicUri, CODECOV, CompilationStatus, DeploymentStatus, Env, LogLevel, MappedCoverageData, RUCALLTST, RUCRTCBL, RUCRTRPG, TestBucket, TestCase, TestCaseResult, TestMetrics, TestRequest, TestStatus, TestSuite, WrapperCmd } from "./types";
import { TestLogger } from "./testLogger";
import { ILELibrarySettings } from "vscode-ibmi/src/api/CompileTools";
import IBMi from "vscode-ibmi/src/api/IBMi";
import { ApiUtils } from "./apiUtils";
import { IBMiTestStorage } from "./storage";
import { CodeCoverageParser } from "./codeCoverageParser";
import { XMLParser } from "./xmlParser";
import * as path from "path";

export interface TestCallbacks {
    deploy: (workspaceFolderPath: string) => Promise<DeploymentStatus>;
    getDeployDirectory(workspaceFolderPath: string): string;
    getLibraryList(workspaceFolderPath?: string): Promise<ILELibrarySettings>
    isDiagnosticsCleared: () => boolean;
    clearDiagnostics: () => Promise<void>;
    loadDiagnostics: (qualifiedObject: string, workspaceFolderPath?: string) => Promise<void>;
    getEnvConfig: (workspaceFolderPath: string) => Promise<Env>;
    getProductLibrary: () => string;
    getBaseExecutionParams: (tstpgm: string, xmlStmf: string, tstPrc?: string) => RUCALLTST;
    setIsCompiled: (uri: BasicUri, isCompiled: boolean) => Promise<void>;
    started: (uri: BasicUri) => Promise<void>;
    skipped: (uri: BasicUri) => Promise<void>;
    passed: (uri: BasicUri, duration?: number) => Promise<void>;
    failed: (uri: BasicUri, messages: { line?: number, message: string }[], duration?: number) => Promise<void>;
    errored: (uri: BasicUri, messages: { line?: number, message: string }[], duration?: number) => Promise<void>;
    addCoverageDatasets(mergedCoverageDatasets: MergedCoverageData[]): void;
    shouldLogCoverage: () => boolean;
    getCoverageThresholds: () => string[];
    end: () => Promise<void>;
}

export class Runner {
    private connection: IBMi;
    private testRequest: TestRequest;
    private testCallbacks: TestCallbacks;
    private testLogger: TestLogger;
    private testMetrics: TestMetrics;
    private mappedCoverageDatasets: MappedCoverageData[];

    constructor(connection: IBMi, testRequest: TestRequest, testCallbacks: TestCallbacks, testLogger: TestLogger) {
        this.connection = connection;
        this.testRequest = testRequest;
        this.testCallbacks = testCallbacks;
        this.testLogger = testLogger;
        this.testMetrics = {
            duration: 0,
            assertions: 0,
            deployments: { success: 0, failed: 0, skipped: 0 },
            compilations: { success: 0, failed: 0, skipped: 0 },
            testFiles: { passed: 0, failed: 0, errored: 0 },
            testCases: { passed: 0, failed: 0, errored: 0 }
        };
        this.mappedCoverageDatasets = [];
    }

    getTestMetrics(): TestMetrics {
        return this.testMetrics;
    }

    async run(): Promise<void> {
        // Setup RPGUNIT and CODECOV storage directories
        IBMiTestStorage.setupTestStorage(this.connection);

        let isDiagnosticsCleared = this.testCallbacks.isDiagnosticsCleared();

        for (const testBucket of this.testRequest.testBuckets) {
            if (testBucket.uri.scheme === 'file') {
                // Log workspace
                const workspaceFolderName = testBucket.name;
                const workspaceFolderPath = testBucket.uri.fsPath;
                await this.testLogger.logWorkspace(workspaceFolderName, testBucket.testSuites.length);

                // Deploy workspace
                const deploymentStatus = this.testRequest.compileMode === 'skip' ? 'skipped' :
                    await this.testCallbacks.deploy(workspaceFolderPath);
                await this.testLogger.logDeployment(workspaceFolderName, deploymentStatus);

                // Check deployment status
                if (deploymentStatus === 'success') {
                    this.testMetrics.deployments.success++;
                } else if (deploymentStatus === 'failed') {
                    this.testMetrics.deployments.failed++;

                    // Error out all test suites since deployment failed
                    for (const testSuite of testBucket.testSuites) {
                        await this.testLogger.logTestSuite(testSuite.name, testSuite.systemName, testSuite.testCases.length);
                        await this.testLogger.logCompilation(testSuite.name, 'skipped', []);
                        this.testMetrics.compilations.skipped++;

                        for (const testCase of testSuite.testCases) {
                            await this.testLogger.logTestCaseErrored(testCase.name, []);
                            await this.testCallbacks.errored(testCase.uri, []);
                            this.testMetrics.testCases.errored++;
                        }
                    }
                    continue;
                } else {
                    this.testMetrics.deployments.skipped++;
                }
            } else if (testBucket.uri.scheme === 'streamfile') {
                // Log IFS directory
                const ifsDirectoryName = testBucket.name;
                await this.testLogger.logIfsDirectory(ifsDirectoryName, testBucket.testSuites.length);
            } else if (testBucket.uri.scheme === 'object') {
                // Log library
                const libraryName = testBucket.name;
                await this.testLogger.logLibrary(libraryName, testBucket.testSuites.length);
            }

            for (const testSuite of testBucket.testSuites) {
                // Log test suite
                await this.testLogger.logTestSuite(testSuite.name, testSuite.systemName, testSuite.testCases.length);

                // Compile test suite if needed
                let isCompiled = this.testRequest.compileMode === 'skip' ? true :
                    this.testRequest.compileMode === 'force' ? false :
                        testSuite.isCompiled;
                if (isCompiled) {
                    await this.testLogger.logCompilation(testSuite.name, 'skipped', []);
                    this.testMetrics.compilations.skipped++;
                } else {
                    if (!isDiagnosticsCleared) {
                        this.testCallbacks.clearDiagnostics();
                        isDiagnosticsCleared = true;
                    }

                    const compilationStatus = await this.compileTest(testBucket, testSuite);
                    isCompiled = compilationStatus === 'success';
                }

                // Check compilation status
                if (!isCompiled) {
                    // Error out all test cases since compile failed
                    for (const testCase of testSuite.testCases) {
                        await this.testLogger.logTestCaseErrored(testCase.name, []);
                        await this.testCallbacks.errored(testCase.uri, []);
                        this.testMetrics.testCases.errored++;
                    }
                    continue;
                }

                // Run test
                await this.testCallbacks.started(testSuite.uri);
                await this.runTest(testBucket, testSuite);
            }
        }

        const mergedCoverageDatasets = this.mergeCoverageDatasets(this.mappedCoverageDatasets);
        this.testCallbacks.addCoverageDatasets(mergedCoverageDatasets);

        const shouldLogCoverage = this.testCallbacks.shouldLogCoverage();
        if (shouldLogCoverage) {
            const coverageThresholds = this.testCallbacks.getCoverageThresholds();
            await this.testLogger.logCoverage(mergedCoverageDatasets, coverageThresholds);
        }
        await this.testLogger.logMetrics(this.testMetrics);
        await this.testCallbacks.end();
    }

    async compileTest(testBucket: TestBucket, testSuite: TestSuite): Promise<CompilationStatus> {
        const content = this.connection.getContent();
        const config = this.connection.getConfig();

        let testBucketPath: string;
        let testSuitePath: string;

        let deployDirectory: string | undefined;
        let tstPgm: { name: string, library: string };
        let srcFile: { name: string, library: string } | undefined;
        let srcMbr: string | undefined;
        let srcStmf: string | undefined;

        if (testSuite.uri.scheme === 'file') {
            testBucketPath = testBucket.uri.fsPath;
            testSuitePath = testSuite.uri.fsPath;

            // Use current library as the test library
            const libraryList = await this.testCallbacks.getLibraryList(testBucketPath);
            const tstLibrary = libraryList?.currentLibrary || config.currentLibrary;

            // Get relative local path to test
            const relativePathToTest = path.relative(testBucketPath, testSuitePath).replace(/\\/g, '/');

            // Construct remote path to test
            deployDirectory = this.testCallbacks.getDeployDirectory(testBucketPath);
            srcStmf = path.posix.join(deployDirectory, relativePathToTest);

            tstPgm = { name: testSuite.systemName, library: tstLibrary };
        } else if (testSuite.uri.scheme === 'streamfile') {
            testBucketPath = testBucket.uri.path;
            testSuitePath = testSuite.uri.path;

            // Use current library as the test library
            const libraryList = await this.testCallbacks.getLibraryList();
            const tstLibrary = libraryList?.currentLibrary || config.currentLibrary;

            deployDirectory = testBucketPath;
            srcStmf = testSuitePath;

            tstPgm = { name: testSuite.systemName, library: tstLibrary };
        } else if (testSuite.uri.scheme === 'member') {
            testBucketPath = testBucket.uri.path;
            testSuitePath = testSuite.uri.path;

            const parsedPath = this.connection.parserMemberPath(testSuitePath);
            const tstPgmName = parsedPath.name;
            const tstLibrary = parsedPath.library;
            const srcFileName = parsedPath.file;

            tstPgm = { name: testSuite.systemName, library: tstLibrary };
            srcFile = { name: srcFileName, library: tstLibrary };
            srcMbr = tstPgmName;
        }

        let wrapperCmd: WrapperCmd | undefined;
        let compileParams: RUCRTRPG | RUCRTCBL = {
            tstPgm: `${tstPgm.library}/${tstPgm.name}`.toLocaleUpperCase(),
            srcFile: srcFile ? `${srcFile.library}/${srcFile.name}`.toLocaleUpperCase() : undefined,
            srcMbr: srcMbr?.toLocaleUpperCase(),
            srcStmf: srcStmf
        };

        const isRPGLE = ApiUtils.isRPGLE(testSuitePath);
        if (isRPGLE) {
            const rucrtrpg = testSuite.testingConfig?.rpgunit?.rucrtrpg;
            wrapperCmd = testSuite.testingConfig?.rpgunit?.rucrtrpg?.wrapperCmd;
            if (wrapperCmd) {
                delete rucrtrpg?.wrapperCmd;
            }

            compileParams = {
                ...compileParams,
                ...rucrtrpg
            };

            if (!(compileParams as RUCRTRPG).rpgPpOpt) {
                (compileParams as RUCRTRPG).rpgPpOpt = "*LVL2";
            }
        } else {
            const rucrtcbl = testSuite.testingConfig?.rpgunit?.rucrtcbl;
            wrapperCmd = testSuite.testingConfig?.rpgunit?.rucrtcbl?.wrapperCmd;
            if (wrapperCmd) {
                delete rucrtcbl?.wrapperCmd;
            }

            compileParams = {
                ...compileParams,
                ...rucrtcbl
            };
        }

        // Set TGTCCSID to *JOB by default
        if (!compileParams.tgtCcsid) {
            compileParams.tgtCcsid = "*JOB";
        }

        // SET COPTION to *EVEVENTF by default to be able to later get diagnostic messages
        if (!compileParams.cOption || compileParams.cOption.length === 0) {
            compileParams.cOption = ["*EVENTF"];
        }

        // Set DBGVIEW to *SOURCE by default for code coverage to get proper line numbers
        if (!compileParams.dbgView) {
            compileParams.dbgView = "*SOURCE";
        }

        if (compileParams.incDir) {
            // Resolve relative include directories with the deploy directory for local files
            if (deployDirectory) {
                const resolvedIncDir: string[] = [];
                for (const incDir of compileParams.incDir) {
                    if (!path.isAbsolute(incDir)) {
                        resolvedIncDir.push(path.posix.join(deployDirectory, incDir));
                    } else {
                        resolvedIncDir.push(incDir);
                    }
                }

                compileParams.incDir = resolvedIncDir;
            }
        } else {
            compileParams.incDir = [];
        }

        // Add the deploy directory to the include directories
        if (deployDirectory) {
            compileParams.incDir.push(deployDirectory);
        }

        // Wrap all include directories in quotes
        compileParams.incDir = compileParams.incDir.map((dir) => `'${dir}'`);

        // Flatten compile parameters and convert to strings
        const flattenedCompileParams = ApiUtils.flattenCommandParams(compileParams);

        // Build compile command
        const productLibrary = this.testCallbacks.getProductLibrary();
        const languageSpecificCommand = isRPGLE ? 'RUCRTRPG' : 'RUCRTCBL';
        let compileCommand = content.toCl(`${productLibrary}/${languageSpecificCommand}`, flattenedCompileParams as any);

        // Wrap compile command if a wrapper command is specified
        if (wrapperCmd && wrapperCmd.cmd) {
            const cmd = `${wrapperCmd.cmd}(${compileCommand})`;
            const params = wrapperCmd.params || {};
            compileCommand = content.toCl(cmd, params);
        }
        await this.testLogger.testOutputLogger.log(LogLevel.Info, `Compiling ${testSuite.name}: ${compileCommand}`);

        let compileResult: any;
        try {
            const env = testBucket.uri.scheme === 'file' ? await this.testCallbacks.getEnvConfig(testBucketPath) : {};
            compileResult = await this.connection.runCommand({ command: compileCommand, environment: `ile`, env: env });
        } catch (error: any) {
            await this.testLogger.logCompilation(testSuite.name, 'failed', [error.message ? error.message : error]);
            this.testMetrics.compilations.failed++;
            return 'failed';
        }

        try {
            // Retrieve diagnostics messages
            if (compileParams.cOption.includes('*EVENTF')) {
                const ext = path.parse(testSuitePath).ext;
                await this.testCallbacks.loadDiagnostics(`${compileParams.tstPgm}${ext}`, testBucketPath);
            }
        } catch (error: any) {
            await this.testLogger.testOutputLogger.log(LogLevel.Error, `Failed to retrieve diagnostics messages: ${error}`);
        }

        if (compileResult.stderr.length > 0) {
            await this.testLogger.testOutputLogger.log(LogLevel.Error, `${testSuite.name} compile error(s):\n${compileResult.stderr}`);
        }

        const isCompiled = compileResult.code === 0;
        await this.testCallbacks.setIsCompiled(testSuite.uri, isCompiled);
        if (isCompiled) {
            await this.testLogger.logCompilation(testSuite.name, 'success', []);
            this.testMetrics.compilations.success++;
            return 'success';
        } else {
            await this.testLogger.logCompilation(testSuite.name, 'failed', compileResult.stderr.split('\n'));
            this.testMetrics.compilations.failed++;
            return 'failed';
        }
    }

    async runTest(testBucket: TestBucket, testSuite: TestSuite): Promise<void> {
        const content = this.connection.getContent();
        const config = this.connection.getConfig();

        let testBucketPath: string;
        let testSuitePath: string;

        let tstPgm: { name: string, library: string };

        if (testSuite.uri.scheme === 'file') {
            testBucketPath = testBucket.uri.fsPath;
            testSuitePath = testSuite.uri.fsPath;

            // Use current library as the test library
            const libraryList = await this.testCallbacks.getLibraryList(testBucketPath);
            const tstLibrary = libraryList?.currentLibrary || config.currentLibrary;

            tstPgm = { name: testSuite.systemName, library: tstLibrary };
        } else if (testSuite.uri.scheme === 'streamfile') {
            testBucketPath = testBucket.uri.path;
            testSuitePath = testSuite.uri.path;

            // Use current library as the test library
            const libraryList = await this.testCallbacks.getLibraryList();
            const tstLibrary = libraryList?.currentLibrary || config.currentLibrary;

            tstPgm = { name: testSuite.systemName, library: tstLibrary };
        } else if (testSuite.uri.scheme === 'member') {
            testBucketPath = testBucket.uri.path;
            testSuitePath = testSuite.uri.path;

            const parsedPath = this.connection.parserMemberPath(testSuitePath);
            const tstLibrary = parsedPath.library;

            tstPgm = { name: testSuite.systemName, library: tstLibrary };
        }

        const qualifiedTstPgm = `${tstPgm.library}/${tstPgm.name}`.toLocaleUpperCase();


        const testCases: (TestCase | undefined)[] = [];
        if (testSuite.isEntireSuite) {
            for (const testCase of testSuite.testCases) {
                await this.testCallbacks.started(testCase.uri);
            }

            testCases.push(undefined);
        } else {
            testCases.push(...testSuite.testCases);
        }

        for (const testCase of testCases) {
            if (testCase) {
                await this.testCallbacks.started(testCase.uri);
            }

            const testStorage = IBMiTestStorage.getTestStorage(this.connection, `${tstPgm.name}${testCase?.name ? `_${testCase?.name}` : ``}`);
            await this.testLogger.testOutputLogger.log(LogLevel.Info, `Test storage for ${testSuite.name}: ${JSON.stringify(testStorage)}`);
            const xmlStmf = testStorage.RPGUNIT;

            // Merge base execution params (ie. from VS Code settings) and execution params from config file
            const baseExecutionParams = this.testCallbacks.getBaseExecutionParams(qualifiedTstPgm, xmlStmf, testCase?.name);
            const rucalltst = testSuite.testingConfig?.rpgunit?.rucalltst;
            const wrapperCmd = testSuite.testingConfig?.rpgunit?.rucalltst?.wrapperCmd;
            if (wrapperCmd) {
                delete rucalltst?.wrapperCmd;
            }
            const testParams: RUCALLTST = {
                ...baseExecutionParams,
                ...rucalltst
            };

            // Build call tests command
            const productLibrary = this.testCallbacks.getProductLibrary();
            let testCommand = content.toCl(`${productLibrary}/RUCALLTST`, testParams as any);

            // Wrap call tests command if a wrapper command is specified
            if (wrapperCmd && wrapperCmd.cmd) {
                const cmd = `${wrapperCmd.cmd}(${testCommand})`;
                const params = wrapperCmd.params || {};
                testCommand = content.toCl(cmd, params);
            }

            // Build CODECOV command if code coverage is enabled
            let coverageParams: CODECOV | undefined;
            if (testSuite.ccLvl) {
                coverageParams = {
                    cmd: testCommand,
                    module: [],
                    ccLvl: testSuite.ccLvl,
                    ccView: testSuite.testingConfig?.codecov?.ccView,
                    outStmf: testStorage.CODECOV,
                    testId: testSuite.testingConfig?.codecov?.testId,
                };

                // Add the service program under test and modules from the testing config
                coverageParams.module.push(`${qualifiedTstPgm} *SRVPGM *ALL`);
                if (testSuite.testingConfig?.codecov?.module) {
                    coverageParams.module.push(...testSuite.testingConfig.codecov.module);
                }
                coverageParams.module = coverageParams.module.map((m: string) => `(${m})`);

                const flattenedCoverageParams = ApiUtils.flattenCommandParams(coverageParams);
                testCommand = `QDEVTOOLS/CODECOV CMD(${flattenedCoverageParams.cmd}) MODULE(${flattenedCoverageParams.module}) CCLVL(${flattenedCoverageParams.ccLvl}) OUTSTMF('${flattenedCoverageParams.outStmf}')`;
            }
            await this.testLogger.testOutputLogger.log(LogLevel.Info, `Running ${testSuite.name}: ${testCommand}`);

            let testResult: any;
            try {
                const env = testBucket.uri.scheme === 'file' ? await this.testCallbacks.getEnvConfig(testBucketPath) : {};
                testResult = await this.connection.runCommand({ command: testCommand, environment: `ile`, env: env });
            } catch (error: any) {
                const messages = [{ message: error.message ? error.message : error }];
                for (const testCase of testSuite.testCases) {
                    await this.testLogger.logTestCaseErrored(testCase.name, messages);
                    await this.testCallbacks.errored(testCase.uri, messages);
                    this.testMetrics.testCases.errored++;
                }

                this.testMetrics.testFiles.errored++;
            }

            let hitRunTimeError: boolean = false;
            if (testResult.stdout.length > 0) {
                await this.testLogger.testOutputLogger.log(LogLevel.Info, `${testSuite.name} execution output:\n${testResult.stdout}`);
                const lines = testResult.stdout.split('\n');
                for (const line of lines) {
                    const trimmedLine = line.trim();
                    if (trimmedLine.startsWith('Runtime error: No test case found')) {
                        await this.testLogger.logRunTimeWarning(trimmedLine);
                        hitRunTimeError = true;
                    }
                }
            }
            if (testResult.stderr.length > 0) {
                await this.testLogger.testOutputLogger.log(LogLevel.Error, `${testSuite.name} execution error(s):\n${testResult.stderr}`);
            }

            if (testSuite.ccLvl) {
                const codeCoverageParser = new CodeCoverageParser(this.connection, this.testLogger);
                const codeCoverage = await codeCoverageParser.getCoverage(coverageParams!.outStmf);
                if (codeCoverage) {
                    for (const coverageData of codeCoverage) {
                        let uri: BasicUri;
                        if (testSuite.uri.scheme === 'file') {
                            // Map code coverage results from deploy directory to local workspace
                            const deployDirectory = this.testCallbacks.getDeployDirectory(testBucketPath);

                            if (`/${coverageData.path}`.startsWith(deployDirectory)) {
                                // Get relative remote path to test
                                const relativePathToTest = path.posix.relative(deployDirectory, `/${coverageData.path}`);

                                // Construct local path to test
                                const localPath = path.join(testBucketPath, relativePathToTest);
                                uri = { scheme: 'file', fsPath: localPath, path: localPath, fragment: '' };
                            } else {
                                uri = { scheme: 'file', fsPath: coverageData.localPath, path: coverageData.localPath, fragment: '' };
                            }
                        } else {
                            // Map code coverage results to source members
                            let memberPath: string = '';
                            const parts = coverageData.path.split('/');

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

                            uri = { scheme: 'member', fsPath: memberPath, path: memberPath, fragment: '' };
                        }

                        this.mappedCoverageDatasets.push({
                            uri: uri,
                            ccLvl: testSuite.ccLvl,
                            coverageData: coverageData
                        });
                    }
                }
            }

            // Parse XML test case results
            let testCaseResults: TestCaseResult[] = [];
            try {
                const xmlStmfContent = (await content.downloadStreamfileRaw(testParams.xmlStmf));
                const xml = await parseStringPromise(xmlStmfContent);
                testCaseResults = XMLParser.parseTestResults(xml, testSuite.uri.scheme === 'file' || testSuite.uri.scheme === 'streamfile');
            } catch (error: any) {
                for (const testCase of testSuite.testCases) {
                    const messages = [{ message: error.message ? error.message : error }];
                    await this.testLogger.logTestCaseErrored(testCase.name, messages);
                    await this.testCallbacks.errored(testCase.uri, messages);
                    this.testMetrics.testCases.errored++;
                }
            }

            // Process test case results
            let testFileStatus: TestStatus = hitRunTimeError ? 'errored' : 'passed';
            for (const testCaseResult of testCaseResults) {
                // const parentItem = isTestCase ? item.parent! : item;

                const mappedTestCase = testSuite.testCases.find(testCase => testCase.name.toLocaleUpperCase() === testCaseResult.name);
                if (mappedTestCase) {
                    // Test case result is mapped to a test item
                    if (testCaseResult.status === 'passed') {
                        await this.testLogger.logTestCasePassed(mappedTestCase.name, testCaseResult.time);
                        await this.testCallbacks.passed(mappedTestCase.uri, testCaseResult.time);
                        this.testMetrics.testCases.passed++;
                    } else if (testCaseResult.status === 'failed') {
                        testFileStatus = testCaseResult.status;
                        await this.testLogger.logTestCaseFailed(mappedTestCase.name, testCaseResult.failure || [], testCaseResult.time);
                        await this.testCallbacks.failed(mappedTestCase.uri, testCaseResult.failure || [], testCaseResult.time);
                        this.testMetrics.testCases.failed++;
                    } else if (testCaseResult.status === 'errored') {
                        testFileStatus = testCaseResult.status;
                        await this.testLogger.logTestCaseErrored(mappedTestCase.name, testCaseResult.error || [], testCaseResult.time);
                        await this.testCallbacks.errored(mappedTestCase.uri, testCaseResult.error || [], testCaseResult.time);
                        this.testMetrics.testCases.errored++;
                    }

                    this.testMetrics.duration += testCaseResult.time || 0;
                    this.testMetrics.assertions += testCaseResult.assertions || 0;
                } else {
                    // Test case result is not mapped to a test item (ie. setUpSuite, setUp, tearDown, tearDownSuite)
                    if (testCaseResult.status === 'passed') {
                        // This should never happened
                        await this.testLogger.testOutputLogger.log(LogLevel.Error, `Test case ${testCaseResult.name} passed${testCaseResult.time !== undefined ? ` in ${testCaseResult.time}s` : ``} but was not mapped to a test item`);
                    } else if (testCaseResult.status === 'failed') {
                        testFileStatus = testCaseResult.status;
                        await this.testLogger.logTestCaseFailed(testCaseResult.name, testCaseResult.failure || [], testCaseResult.time);
                        await this.testCallbacks.failed(testSuite.uri, testCaseResult.failure || [], testCaseResult.time);
                    } else if (testCaseResult.status === 'errored') {
                        testFileStatus = testCaseResult.status;
                        await this.testLogger.logTestCaseErrored(testCaseResult.name, testCaseResult.error || [], testCaseResult.time);
                        await this.testCallbacks.errored(testSuite.uri, testCaseResult.error || [], testCaseResult.time);
                    }

                    this.testMetrics.duration += testCaseResult.time || 0;
                    this.testMetrics.assertions += testCaseResult.assertions || 0;
                }
            }

            if (testFileStatus === 'passed') {
                this.testMetrics.testFiles.passed++;
            } else if (testFileStatus === 'failed') {
                this.testMetrics.testFiles.failed++;
            } else if (testFileStatus === 'errored') {
                this.testMetrics.testFiles.errored++;
            }
        }
    }

    mergeCoverageDatasets(mappedCoverageDatasets: MappedCoverageData[]): MergedCoverageData[] {
        const mergedCoverageDatasets: MergedCoverageData[] = [];

        for (const mappedCoverageData of mappedCoverageDatasets) {
            const existingIndex = mergedCoverageDatasets.findIndex(mergedData =>
                mergedData.uri.fsPath === mappedCoverageData.uri.fsPath &&
                mergedData.ccLvl === mappedCoverageData.ccLvl
            );

            if (existingIndex === -1) {
                // Add new coverage data
                mergedCoverageDatasets.push({
                    uri: mappedCoverageData.uri,
                    ccLvl: mappedCoverageData.ccLvl,
                    activeLines: mappedCoverageData.coverageData.coverage.activeLines
                });
            } else {
                // Merge coverage data
                const existingData = mergedCoverageDatasets[existingIndex];
                const existingLines = existingData.activeLines;
                const newLines = mappedCoverageData.coverageData.coverage.activeLines;

                for (const [lineStr, covered] of Object.entries(newLines)) {
                    const line = Number(lineStr);
                    if (line in existingLines) {
                        existingLines[line] = existingLines[line] || covered;
                    } else {
                        existingLines[line] = covered;
                    }
                }
            }
        }

        return mergedCoverageDatasets;
    }
}