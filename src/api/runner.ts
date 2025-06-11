
import * as path from "path";
import { parseStringPromise } from "xml2js";
import { BasicUri, CODECOV, CompilationStatus, DeploymentStatus, Env, ExecutionStatus, LogLevel, RUCALLTST, RUCRTCBL, RUCRTRPG, TestBucket, TestCase, TestCaseResult, TestMetrics, TestRequest, TestStatus, TestSuite } from "./types";
import { TestLogger } from "./testLogger";
import { getInstance } from "../extensions/ibmi";
import { ILELibrarySettings } from "@halcyontech/vscode-ibmi-types/api/CompileTools";
import { ApiUtils } from "./apiUtils";
import { IBMiTestStorage } from "./storage";
import { CodeCoverage } from "./codeCoverage";
import { IBMiFileCoverage } from "../fileCoverage";
import { XMLParser } from "./xmlParser";

export interface TestCallbacks {
    deploy: (workspaceFolderPath: string) => Promise<DeploymentStatus>;
    getDeployDirectory(workspaceFolderPath: string): string;
    getLibraryList(workspaceFolderPath?: string): Promise<ILELibrarySettings>
    isDiagnosticsCleared: () => boolean;
    clearDiagnostics: () => Promise<void>;
    loadDiagnostics: (qualifiedObject: string, workspaceFolderPath?: string) => Promise<void>;
    getEnvConfig: (workspaceFolderPath: string) => Promise<Env>;
    getProductLibrary: () => string;
    getTestParams: (tstpgm: string, xmlStmf: string, tstPrc?: string) => RUCALLTST;
    setIsCompiled: (uri: BasicUri, isCompiled: boolean) => Promise<void>;
    started: (uri: BasicUri) => Promise<void>;
    skipped: (uri: BasicUri) => Promise<void>;
    passed: (uri: BasicUri, duration?: number) => Promise<void>;
    failed: (uri: BasicUri, messages: { line?: number, message: string }[], duration?: number) => Promise<void>;
    errored: (uri: BasicUri, messages: { line?: number, message: string }[], duration?: number) => Promise<void>;
    addCoverage(fileCoverage: IBMiFileCoverage): void;
    end: () => Promise<void>;
}

export class Runner {
    private testRequest: TestRequest;
    private testCallbacks: TestCallbacks;
    private testLogger: TestLogger;
    private testMetrics: TestMetrics;
    private fileCoverage: IBMiFileCoverage[];

    constructor(testRequest: TestRequest, testCallbacks: TestCallbacks, testLogger: TestLogger) {
        this.testRequest = testRequest;
        this.testCallbacks = testCallbacks;
        this.testLogger = testLogger;
        this.testMetrics = {
            duration: 0,
            assertions: 0,
            deployments: { success: 0, failed: 0 },
            compilations: { success: 0, failed: 0, skipped: 0 },
            testFiles: { passed: 0, failed: 0, errored: 0 },
            testCases: { passed: 0, failed: 0, errored: 0 }
        };
        this.fileCoverage = [];
    }

    async run(): Promise<void> {
        // Setup RPGUNIT and CODECOV storage directories
        IBMiTestStorage.setupTestStorage();

        let isDiagnosticsCleared = this.testCallbacks.isDiagnosticsCleared();

        for (const testBucket of this.testRequest.testBuckets) {
            if (testBucket.uri.scheme === 'file') {
                // Log workspace
                const workspaceFolderName = testBucket.name;
                const workspaceFolderPath = testBucket.uri.fsPath;
                await this.testLogger.logWorkspace(workspaceFolderName, testBucket.testSuites.length);

                // Deploy workspace
                const deploymentStatus = await this.testCallbacks.deploy(workspaceFolderPath);
                await this.testLogger.logDeployment(workspaceFolderName, deploymentStatus);

                // Check deployment status
                const isDeployed = deploymentStatus === 'success';
                if (isDeployed) {
                    this.testMetrics.deployments.success++;
                } else {
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
                }
            } else if (testBucket.uri.scheme === 'member') {
                // Log library
                const libraryName = testBucket.name;
                await this.testLogger.logLibrary(libraryName, testBucket.testSuites.length);
            } else {
                // TODO: Support stream files
            }

            for (const testSuite of testBucket.testSuites) {
                // Log test suite
                await this.testLogger.logTestSuite(testSuite.name, testSuite.systemName, testSuite.testCases.length);

                // Compile test suite if needed
                let isCompiled = testSuite.isCompiled && !this.testRequest.forceCompile;
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
                    // Error out all test suites since deployment failed
                    await this.testLogger.logTestSuite(testSuite.name, testSuite.systemName, testSuite.testCases.length);
                    await this.testLogger.logCompilation(testSuite.name, 'skipped', []);
                    this.testMetrics.compilations.skipped++;

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

        for (const coverage of this.fileCoverage) {
            this.testCallbacks.addCoverage(coverage);
        }

        await this.testLogger.logMetrics(this.testMetrics);
        await this.testCallbacks.end();
    }

    async compileTest(testBucket: TestBucket, testSuite: TestSuite): Promise<CompilationStatus> {
        const ibmi = getInstance();
        const connection = ibmi!.getConnection();
        const content = connection.getContent();
        const config = connection.getConfig();

        let deployDirectory: string | undefined;
        let tstPgm: { name: string, library: string };
        let srcFile: { name: string, library: string } | undefined;
        let srcMbr: string | undefined;
        let srcStmf: string | undefined;

        if (testSuite.uri.scheme === 'file') {
            // Use current library as the test library
            const libraryList = await this.testCallbacks.getLibraryList(testBucket.uri.fsPath);
            const tstLibrary = libraryList?.currentLibrary || config.currentLibrary;

            // Get relative local path to test
            const relativePathToTest = path.relative(testBucket.uri.fsPath, testSuite.uri.fsPath).replace(/\\/g, '/');

            // Construct remote path to test
            deployDirectory = this.testCallbacks.getDeployDirectory(testBucket.uri.fsPath);
            srcStmf = path.posix.join(deployDirectory, relativePathToTest);

            tstPgm = { name: testSuite.systemName, library: tstLibrary };
        } else {
            const parsedPath = connection.parserMemberPath(testSuite.uri.fsPath);
            const tstPgmName = parsedPath.name.toLocaleUpperCase();
            const tstLibrary = parsedPath.library;
            const srcFileName = parsedPath.file;

            tstPgm = { name: testSuite.systemName, library: tstLibrary };
            srcFile = { name: srcFileName, library: tstLibrary };
            srcMbr = tstPgmName;
        }

        let compileParams: RUCRTRPG | RUCRTCBL = {
            tstPgm: `${tstPgm.library}/${tstPgm.name}`,
            srcFile: srcFile ? `${srcFile.library}/${srcFile.name}` : undefined,
            srcMbr: srcMbr,
            srcStmf: srcStmf
        };

        const isRPGLE = ApiUtils.isRPGLE(testSuite.uri.fsPath);
        if (isRPGLE) {
            compileParams = {
                ...compileParams,
                ...testSuite.testingConfig?.rpgunit?.rucrtrpg
            };

            if (!(compileParams as RUCRTRPG).rpgPpOpt) {
                (compileParams as RUCRTRPG).rpgPpOpt = "*LVL2";
            }
        } else {
            compileParams = {
                ...compileParams,
                ...testSuite.testingConfig?.rpgunit?.rucrtcbl
            };
        }

        // Set TGTCCSID to 37 by default
        if (!compileParams.tgtCcsid) {
            compileParams.tgtCcsid = 37;
        }

        // SET COPTION to *EVEVENTF by default to be able to later get diagnostic messages
        if (!compileParams.cOption || compileParams.cOption.length === 0) {
            compileParams.cOption = ["*EVENTF"];
        }

        // Set DBGVIEW to *SOURCE by default for code coverage to get proper line numbers
        if (!compileParams.dbgView) {
            compileParams.dbgView = "*SOURCE";
        }

        // Override DBGVIEW to *LIST for SQLRPGLE files
        // https://github.com/IBM/vscode-ibmi-testing/issues/95
        if (testSuite.uri.fsPath.toLocaleUpperCase().endsWith('.SQLRPGLE')) {
            compileParams.dbgView = "*LIST";
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
        const flattenedCompileParams: any = { ...compileParams };
        for (const key of Object.keys(compileParams) as (keyof typeof compileParams)[]) {
            const value = compileParams[key];
            if (Array.isArray(value)) {
                flattenedCompileParams[key] = value.join(' ');
            } else if (typeof value === 'number') {
                flattenedCompileParams[key] = value.toString();
            }
        }

        const productLibrary = this.testCallbacks.getProductLibrary();
        const languageSpecificCommand = isRPGLE ? 'RUCRTRPG' : 'RUCRTCBL';
        const compileCommand = content.toCl(`${productLibrary}/${languageSpecificCommand}`, flattenedCompileParams as any);
        await this.testLogger.testOutputLogger.log(LogLevel.Info, `Compiling ${testSuite.name}: ${compileCommand}`);

        let compileResult: any;
        try {
            const env = testBucket.uri.scheme === 'file' ? await this.testCallbacks.getEnvConfig(testBucket.uri.fsPath) : {};
            compileResult = await connection.runCommand({ command: compileCommand, environment: `ile`, env: env });
        } catch (error: any) {
            await this.testLogger.logCompilation(testSuite.name, 'failed', [error.message ? error.message : error]);
            this.testMetrics.compilations.failed++;
            return 'failed';
        }

        try {
            // Retrieve diagnostics messages
            if (compileParams.cOption.includes('*EVENTF')) {
                const ext = path.parse(testSuite.uri.fsPath).ext;
                await this.testCallbacks.loadDiagnostics(`${compileParams.tstPgm}${ext}`, testBucket.uri.fsPath);
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
        const ibmi = getInstance();
        const connection = ibmi!.getConnection();
        const content = connection.getContent();
        const config = connection.getConfig();

        let tstPgm: { name: string, library: string };

        if (testSuite.uri.scheme === 'file') {
            // Use current library as the test library
            const libraryList = await this.testCallbacks.getLibraryList(testBucket.uri.fsPath);
            const tstLibrary = libraryList?.currentLibrary || config.currentLibrary;

            tstPgm = { name: testSuite.systemName, library: tstLibrary };
        } else {
            const parsedPath = connection.parserMemberPath(testSuite.uri.fsPath);
            const tstLibrary = parsedPath.library;

            tstPgm = { name: testSuite.systemName, library: tstLibrary };
        }

        const qualifiedTstPgm = `${tstPgm.library}/${tstPgm.name}`;


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

            const testStorage = IBMiTestStorage.getTestStorage(`${tstPgm.name}${testCase ? `_${testCase}` : ``}`);
            await this.testLogger.testOutputLogger.log(LogLevel.Info, `Test storage for ${testSuite.name}: ${JSON.stringify(testStorage)}`);
            const xmlStmf = testStorage.RPGUNIT;

            const testParams = this.testCallbacks.getTestParams(qualifiedTstPgm, xmlStmf, testCase?.name);

            // Build RUCALLTST command
            const productLibrary = this.testCallbacks.getProductLibrary();
            let testCommand = content.toCl(`${productLibrary}/RUCALLTST`, testParams as any);

            // Build CODECOV command if code coverage is enabled
            let coverageParams: CODECOV | undefined;
            if (testSuite.ccLvl) {
                coverageParams = {
                    cmd: testCommand,
                    module: `(${qualifiedTstPgm} *SRVPGM *ALL)`,
                    ccLvl: testSuite.ccLvl,
                    outStmf: testStorage.CODECOV
                };
                testCommand = `QDEVTOOLS/CODECOV CMD(${coverageParams.cmd}) MODULE(${coverageParams.module}) CCLVL(${coverageParams.ccLvl}) OUTSTMF('${coverageParams.outStmf}')`;
            }
            await this.testLogger.testOutputLogger.log(LogLevel.Info, `Running ${testSuite.name}: ${testCommand}`);

            let testResult: any;
            try {
                const env = testBucket.uri.scheme === 'file' ? await this.testCallbacks.getEnvConfig(testBucket.uri.fsPath) : {};
                testResult = await connection.runCommand({ command: testCommand, environment: `ile`, env: env });
            } catch (error: any) {
                const messages = [{ message: error.message ? error.message : error }];
                for (const testCase of testSuite.testCases) {
                    await this.testLogger.logTestCaseErrored(testCase.name, messages);
                    await this.testCallbacks.errored(testCase.uri, messages);
                    this.testMetrics.testCases.errored++;
                }

                this.testMetrics.testFiles.errored++;
            }

            if (testResult.stdout.length > 0) {
                await this.testLogger.testOutputLogger.log(LogLevel.Info, `${testSuite.name} execution output:\n${testResult.stdout}`);
            }
            if (testResult.stderr.length > 0) {
                await this.testLogger.testOutputLogger.log(LogLevel.Error, `${testSuite.name} execution error(s):\n${testResult.stderr}`);
            }

            if (testSuite.ccLvl) {
                const codeCovResults = await CodeCoverage.getCoverage(coverageParams!.outStmf);
                if (codeCovResults) {
                    const isStatementCoverage = testSuite.ccLvl === '*LINE';

                    // TODO: Support code coverage
                    // for (const codeCovResult of codeCovResults) {
                    //     let uri: Uri;
                    //     if (testSuite.uri.schema === 'file') {
                    //         // Map code coverage results from deploy directory to local workspace
                    //         const deployDirectory = this.testCallbacks.getDeployDirectory(testBucket.uri.fsPath);

                    //         if (`/${codeCovResult.path}`.startsWith(deployDirectory)) {
                    //             // Get relative remote path to test
                    //             const relativePathToTest = path.posix.relative(deployDirectory, `/${codeCovResult.path}`);

                    //             // Construct local path to test
                    //             const localPath = path.join(testBucket.uri.fsPath, relativePathToTest);
                    //             uri = Uri.file(localPath);
                    //         } else {
                    //             uri = Uri.file(codeCovResult.localPath);
                    //         }
                    //     } else {
                    //         // Map code coverage results to source members
                    //         let memberPath: string = '';
                    //         const parts = codeCovResult.path.split('/');

                    //         if (parts.length === 3 && parts[1].toLocaleUpperCase().endsWith('.FILE')) {
                    //             // This is a temporary hack due to https://github.com/IBM/vscode-ibmi-testing/issues/70
                    //             const library = parts[1].split('.')[0];
                    //             const sourceFile = parts[0];
                    //             const member = parts[2];
                    //             memberPath = `/${library}/${sourceFile}/${member}`;
                    //         } else {
                    //             for (let index = 0; index < parts.length; index++) {
                    //                 if (index !== parts.length - 1) {
                    //                     const partName = parts[index].split('.');
                    //                     if (partName.length > 0) {
                    //                         memberPath += `/${partName[0]}`;
                    //                     }
                    //                 } else {
                    //                     memberPath += `/${parts[index]}`;
                    //                 }
                    //             }
                    //         }

                    //         uri = Uri.from({ scheme: 'member', path: memberPath });
                    //     }

                    //     const existingFileCoverageIndex = this.fileCoverage.findIndex((coverage) => coverage.uri.toString() === uri.toString());
                    //     if (existingFileCoverageIndex >= 0) {
                    //         fileCoverage[existingFileCoverageIndex].addCoverage(codeCovResult, isStatementCoverage);
                    //     } else {
                    //         const newFileCoverage = new IBMiFileCoverage(uri, codeCovResult, isStatementCoverage);
                    //         fileCoverage.push(newFileCoverage);
                    //     }
                    // }
                }
            }

            // Parse XML test case results
            let testCaseResults: TestCaseResult[] = [];
            try {
                const xmlStmfContent = (await content.downloadStreamfileRaw(testParams.xmlStmf));
                const xml = await parseStringPromise(xmlStmfContent);
                testCaseResults = XMLParser.parseTestResults(xml, testSuite.uri.scheme === 'file');
            } catch (error: any) {
                for (const testCase of testSuite.testCases) {
                    const messages = [{ message: error.message ? error.message : error }];
                    await this.testLogger.logTestCaseErrored(testCase.name, messages);
                    await this.testCallbacks.errored(testCase.uri, messages);
                    this.testMetrics.testCases.errored++;
                }
            }

            // Process test case results
            let testFileStatus: TestStatus = 'passed';
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
}