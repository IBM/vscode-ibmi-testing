import IBMi from "vscode-ibmi/src/api/IBMi";
import { Runner, TestCallbacks } from "../../api/runner";
import { ConnectionData } from "vscode-ibmi/src/api/types";
import { ILELibrarySettings } from "vscode-ibmi/src/api/CompileTools";
import { DeploymentStatus, Env, RUCALLTST, BasicUri, TestRequest, MergedCoverageData, CCLVL } from "../../api/types";
import { TestLogger } from "../../api/testLogger";
import { SummaryLogger } from "./loggers/summaryLogger";
import { TestOutputLogger } from "./loggers/testOutputLogger";
import { TestResultLogger } from "./loggers/testResultLogger";
import { IfsTestBucketBuilder, LocalTestBucketBuilder, QsysTestBucketBuilder, TestBucketBuilder } from "./testBucketBuilder";
import { CodeForIStorage } from "vscode-ibmi/src/api/configuration/storage/CodeForIStorage";
import { VirtualStorage } from "vscode-ibmi/src/api/configuration/storage/BaseStorage";
import { VirtualConfig } from "vscode-ibmi/src/api/configuration/config/VirtualConfig";
import { extensionComponentRegistry } from "vscode-ibmi/src/api/components/manager";
import { CustomQSh } from "vscode-ibmi/src/api/components/cqsh";
import { GetNewLibl } from "vscode-ibmi/src/api/components/getNewLibl";
import { GetMemberInfo } from "vscode-ibmi/src/api/components/getMemberInfo";
import { CopyToImport } from "vscode-ibmi/src/api/components/copyToImport";
import { LocalSSH } from "./localSsh";
import { ApiUtils } from "../../api/apiUtils";
import { Option, program } from "commander";
import c from "ansi-colors";
import ora from "ora";
import * as path from "path";
import * as fs from "fs";
import os from 'os';
import { exit } from "process";
import inquirer from "inquirer";
import pkg from '../package.json';

interface Options {
    localDirectory?: string;
    ifsDirectory?: string;
    library?: string;
    sourceFiles?: string[];
    libraryList?: string[];
    currentLibrary?: string;
    codeCoverage?: CCLVL;
    coverageThresholds?: string[];
    skipCompilation?: boolean;
    summaryReport?: string;
    testResult?: string;
    testOutput?: string;
    commandOutput?: string;
}

const VERSION = pkg.version;
const LOCAL_DIRECTORY = `.`;
const IFS_DIRECTORY = `.`;
const SOURCE_FILES = [`QTESTSRC`];
const CODE_COVERAGE_LINE = `*LINE`;
const CODE_COVERAGE_PROC = `*PROC`;
const LOG_DIRECTORY = `.itest`;
const SKIP_COMPILATION = false;
const SUMMARY_REPORT_PATH = `./${LOG_DIRECTORY}/summary-report.md`;
const TEST_RESULT_PATH = `./${LOG_DIRECTORY}/test-result.log`;
const TEST_OUTPUT_PATH = `./${LOG_DIRECTORY}/test-output.log`;
const COMMAND_OUTPUT_PATH = `./${LOG_DIRECTORY}/command-output.log`;
export const YELLOW_THRESHOLD = `60`;
export const GREEN_THRESHOLD = `90`;
const COVERAGE_THRESHOLDS = [YELLOW_THRESHOLD, GREEN_THRESHOLD];

main();

function main() {
    const spinner = ora({
        stream: process.stdout
    });

    // Setup CLI information
    program
        .version(VERSION, `--v, --version`, `Display the version number`)
        .name(`itest`)
        .description(`The ${c.cyanBright(`IBM i Testing CLI (itest)`)} is a companion to the IBM i Testing VS Code extension, which\nallows you to run unit tests and generate code coverage results for RPG and COBOL programs\non IBM i. With this CLI, you can run tests in your terminal on your local PC or in PASE on\nIBM i. This enables you to even script the execution of tests in a CI/CD pipeline.\n\n✨ Documentation: https://codefori.github.io/docs/developing/testing/cli`)
        .helpOption(`--h, --help`, `Display help for command`)
        .showHelpAfterError()
        .showSuggestionAfterError()
        .addHelpText(`afterAll`, [
            ``,
            `Examples:`,
            `  1. Run tests in local directory:`,
            c.magenta(`     itest --ld . --id /home/USER/builds/ibmi-company_system --ll RPGUNIT QDEVTOOLS --cl MYLIB --cc`),
            `  2. Run tests in IFS directory:`,
            c.magenta(`     itest --id /home/USER/builds/ibmi-company_system --ll RPGUNIT QDEVTOOLS --cl MYLIB --cc`),
            `  3. Run tests in library:`,
            c.magenta(`     itest --l RPGUTILS --ll RPGUNIT QDEVTOOLS --cl RPGUTILS --cc`)
        ].join(`\n`));

    // Setup CLI options
    program
        .addOption(new Option(`--ld, --local-directory [path]`, `Local directory containing tests`).preset(LOCAL_DIRECTORY).conflicts([`library`, `source-files`]))
        .addOption(new Option(`--id, --ifs-directory [path]`, `IFS directory containing containing tests`).preset(IFS_DIRECTORY).conflicts([`library`, `source-files`]))
        .addOption(new Option(`--l, --library <library>`, `Library containing tests.`).conflicts(`local-directory`))
        .addOption(new Option(`--sf, --source-files <sourceFiles...>`, `Source files to search for tests.`).default(SOURCE_FILES).conflicts(`local-directory`))
        .addOption(new Option(`--ll, --library-list <libraries...>`, `Libraries to add to the library list.`))
        .addOption(new Option(`--cl, --current-library <library>`, `The current library to use for the test run.`))
        .addOption(new Option(`--cc, --code-coverage [ccLvl]`, `Run with code coverage`).preset(CODE_COVERAGE_LINE).choices([CODE_COVERAGE_LINE, CODE_COVERAGE_PROC]))
        .addOption(new Option(`--ct, --coverage-thresholds <threshholds...>`, `Set the code coverage thresholds (yellow and green).`).default(COVERAGE_THRESHOLDS))
        .addOption(new Option(`--sc, --skip-compilation`, `Skip compilation`))
        .addOption(new Option(`--sr, --summary-report [path]`, `Save summary report`).preset(SUMMARY_REPORT_PATH))
        .addOption(new Option(`--tr, --test-result [path]`, `Save test result logs`).preset(TEST_RESULT_PATH))
        .addOption(new Option(`--to, --test-output [path]`, `Save test output logs`).preset(TEST_OUTPUT_PATH))
        .addOption(new Option(`--co, --command-output [path]`, `Save command output logs`).preset(COMMAND_OUTPUT_PATH))
        .action(async (options: Options) => {
            spinner.color = 'green';
            spinner.text = 'Setting up environment';
            spinner.start();
            const isRunningOnIBMi = os.type().includes('400');

            // Resolve to absolute paths and other options
            const cwd = process.cwd();
            const localDirectory = options.localDirectory ? path.resolve(cwd, options.localDirectory) : undefined;
            let ifsDirectory = options.ifsDirectory ? options.ifsDirectory : undefined;
            if (ifsDirectory?.startsWith('//')) {
                ifsDirectory = ifsDirectory.substring(1);
            }
            if (!localDirectory && !isRunningOnIBMi) {
                spinner.fail(`The '--local-directory' option is required when not running on IBM i.`);
                exit(1);
            } else if (localDirectory && isRunningOnIBMi) {
                spinner.fail(`The '--local-directory' option is not supported when running on IBM i.`);
                exit(1);
            } else if (localDirectory && !ifsDirectory) {
                spinner.fail(`The '--local-directory' option requires an IFS directory to deploy to using the '--ifs-directory' option.`);
                exit(1);
            } else if (ifsDirectory && isRunningOnIBMi) {
                ifsDirectory = path.posix.resolve(cwd, ifsDirectory);
            }
            const library = options.library ? options.library : undefined;
            if (!localDirectory && !ifsDirectory && !library) {
                spinner.fail(`The '--local-directory', '--ifs-directory', or '--library' option must be specified to indicate what tests to run.`);
                exit(1);
            }
            const sourceFiles = options.sourceFiles ? options.sourceFiles : SOURCE_FILES;
            const libraryList = options.libraryList ? options.libraryList : undefined;
            const currentLibrary = options.currentLibrary ? options.currentLibrary : undefined;
            const codeCoverage = options.codeCoverage ? options.codeCoverage : undefined;
            const coverageThresholds = options.coverageThresholds ? options.coverageThresholds : COVERAGE_THRESHOLDS;
            if (coverageThresholds) {
                if (coverageThresholds.length > 2) {
                    spinner.fail(`The '--coverage-thresholds' option requires two thresholds (yellow and green).`);
                    exit(1);
                } else {
                    const yellow = Number(coverageThresholds[0]);
                    const green = Number(coverageThresholds[1]);

                    if (isNaN(yellow) || isNaN(green)) {
                        spinner.fail(`The '--coverage-thresholds' option requires two numeric thresholds (yellow and green).`);
                        exit(1);
                    } else if (yellow <= 0 || yellow >= green) {
                        spinner.fail(`The <yellow> threshold must be greater than 0 and less than the <green> threshold.`);
                        exit(1);
                    } else if (green <= yellow || green > 100) {
                        spinner.fail(`The <green> threshold must be greater than <yellow> and less than or equal to 100.`);
                        exit(1);
                    }
                }
            }
            const skipCompilation = options.skipCompilation ? options.skipCompilation : SKIP_COMPILATION;
            const summaryReport = options.summaryReport ? path.resolve(cwd, options.summaryReport) : undefined;
            const testResult = options.testResult ? path.resolve(cwd, options.testResult) : undefined;
            const testOutput = options.testOutput ? path.resolve(cwd, options.testOutput) : undefined;
            const commandOutput = options.commandOutput ? path.resolve(cwd, options.commandOutput) : undefined;

            // Setup credentials based on if running on IBM i
            let localSSH: LocalSSH | undefined;
            let credentials: ConnectionData;
            if (isRunningOnIBMi) {
                if (localDirectory) {
                    spinner.fail(`The '--local-directory' option is not supported when running on IBM i.`);
                    exit(1);
                }

                // Create local SSH instance
                localSSH = new LocalSSH();

                // Get credentials from the local SSH instance
                const user = (await localSSH.execCommand(`whoami`)).stdout;
                const host = (await localSSH.execCommand(`hostname`)).stdout;

                // Build credentials
                credentials = {
                    name: `${user}@${host}`,
                    username: user,
                    host: host,
                    port: 22
                };
            } else {
                async function promptForCredential(name: string, value: string | undefined, message: string, password: boolean = false): Promise<string> {
                    if (value) {
                        return value;
                    }

                    try {
                        spinner.stop();

                        const answer = password ?
                            await inquirer.prompt([
                                {
                                    type: 'password',
                                    name: name,
                                    message: message
                                }
                            ]) :
                            await inquirer.prompt([
                                {
                                    type: 'input',
                                    name: name,
                                    message: message,
                                    required: true
                                }
                            ]);
                        if (!answer || !answer[name]) {
                            exit(1);
                        }

                        spinner.start();
                        return answer[name];
                    } catch (error) {
                        exit(1);
                    }
                }

                // Get credentials from environment variables
                let user = await promptForCredential('user', process.env.IBMI_USER, `What is your IBM i user profile? ${c.yellow(`(Set the IBMI_USER environment variable to avoid this prompt)`)}`);
                let host = await promptForCredential('host', process.env.IBMI_HOST, `What is your IBM i hostname? ${c.yellow(`(Set the IBMI_HOST environment variable to avoid this prompt)`)}`);
                const sshPort = process.env.SSH_PORT || 22;
                let password = await promptForCredential('password', process.env.IBMI_PASSWORD, `What is your IBM i password? ${c.yellow(`(Set the IBMI_PASSWORD environment variable to avoid this prompt)`)}`, true);
                const privateKey = process.env.IBMI_PRIVATE_KEY;

                // Build credentials
                credentials = {
                    name: `${user}@${host}`,
                    username: user,
                    host: host,
                    port: Number(sshPort)
                };
                if (password) {
                    credentials.password = password;
                } else if (privateKey) {
                    (credentials as any)['privateKey'] = privateKey;
                }
            }

            // Create loggers
            const includeCodeCoverage = codeCoverage ? true : false;
            const summaryLogger = new SummaryLogger(summaryReport, includeCodeCoverage);
            const testOutputLogger = new TestOutputLogger(testOutput);
            const testResultLogger = new TestResultLogger(testResult);
            const testLogger = new TestLogger(testOutputLogger, testResultLogger);
            if (commandOutput) {
                fs.mkdirSync(path.dirname(commandOutput), { recursive: true });
                fs.writeFileSync(commandOutput, '');
            }

            // Setup Code4i virtual storage and config
            const virtualStorage = new VirtualStorage();
            const virtualConfig = new VirtualConfig();
            IBMi.GlobalStorage = new CodeForIStorage(virtualStorage);
            IBMi.connectionManager.configMethod = virtualConfig;

            // Setup components
            const customQsh = new CustomQSh();
            customQsh.setLocalAssetPath(path.join(__dirname, customQsh.getFileName()));
            const testingId = `itest`;
            extensionComponentRegistry.registerComponent(testingId, customQsh);
            extensionComponentRegistry.registerComponent(testingId, new GetNewLibl());
            extensionComponentRegistry.registerComponent(testingId, new GetMemberInfo());
            extensionComponentRegistry.registerComponent(testingId, new CopyToImport());

            // Connect to IBM i
            if (!isRunningOnIBMi) {
                spinner.color = 'magenta';
                spinner.text = 'Connecting to IBM i';
            }
            const connection = new IBMi();
            connection.appendOutput = async (data) => {
                if (commandOutput) {
                    await fs.promises.appendFile(commandOutput, data);
                }
            };
            const result = await connection.connect(
                credentials,
                {
                    callbacks: {
                        message: (type: string, message: string) => {
                        },
                        progress: ({ message }) => {
                            if (!isRunningOnIBMi) {
                                spinner.text = `${credentials.name}: ${message}`;
                            }
                        },
                        uiErrorHandler: async (connection, code, data) => {
                            return false;
                        },
                    },
                    reloadServerSettings: false,
                    reconnecting: false,
                    customClient: localSSH as any
                }
            );

            // Setup library list and current library
            const config = connection.getConfig();
            if (libraryList) {
                config.libraryList = [...libraryList, ...config.libraryList];
            }
            if (currentLibrary) {
                config.currentLibrary = currentLibrary;
            }
            await IBMi.connectionManager.update(config);

            if (result.success) {
                spinner.color = 'cyan';
                spinner.text = 'Loading tests';
                spinner.start();

                // Build test bucket and request
                let testBucketBuilder: TestBucketBuilder;
                if (library) {
                    testBucketBuilder = new QsysTestBucketBuilder(testOutputLogger, codeCoverage, connection as any, library, sourceFiles);
                } else {
                    if (localDirectory) {
                        testBucketBuilder = new LocalTestBucketBuilder(testOutputLogger, codeCoverage, localDirectory);
                    } else {
                        testBucketBuilder = new IfsTestBucketBuilder(testOutputLogger, codeCoverage, connection as any, ifsDirectory!);
                    }
                }
                const testBuckets = await testBucketBuilder.getTestBuckets();

                // Ensure there are test suites to run
                const hasTestSuites = testBuckets.some(bucket => bucket.testSuites.length > 0);
                if (!hasTestSuites) {
                    const location = library ? ` in ${library}.LIB` :
                        localDirectory ? ` in ${localDirectory}` :
                            ifsDirectory ? ` in ${ifsDirectory}` : ``;
                    spinner.fail(`No test suites found${location}`);
                    await connection.dispose();
                    exit(1);
                }

                const testRequest: TestRequest = {
                    compileMode: skipCompilation ? `skip` : `force`,
                    testBuckets: testBuckets
                };

                // Setup test callbacks
                let finalCoverageDatasets: MergedCoverageData[] = [];
                const testCallbacks: TestCallbacks = {
                    deploy: async function (workspaceFolderPath: string): Promise<DeploymentStatus> {
                        try {
                            const content = connection.getContent();
                            await connection.sendCommand({ command: `mkdir -p "${ifsDirectory}"` });
                            await content.uploadDirectory(workspaceFolderPath, ifsDirectory!, { concurrency: 10 });
                            return 'success';
                        } catch (error) {
                            return 'errored';
                        }
                    },
                    getDeployDirectory: function (workspaceFolderPath: string): string {
                        return ifsDirectory!;
                    },
                    getLibraryList: async function (workspaceFolderPath?: string): Promise<ILELibrarySettings> {
                        const env = workspaceFolderPath ? await ApiUtils.getEnvConfig(workspaceFolderPath) : {};

                        const config = connection.getConfig();
                        const librarySetup: ILELibrarySettings = {
                            currentLibrary: env[`CURLIB`] || config.currentLibrary,
                            libraryList: env[`LIBL`]?.split(` `) || config.libraryList,
                        };

                        return librarySetup;
                    },
                    isDiagnosticsCleared: function (): boolean {
                        // Not used
                        return true;
                    },
                    clearDiagnostics: async function (): Promise<void> {
                        // Not used
                        return;
                    },
                    loadDiagnostics: async function (qualifiedObject: string, workspaceFolderPath?: string): Promise<void> {
                        // Not used
                        return;
                    },
                    getEnvConfig: async function (workspaceFolderPath: string): Promise<Env> {
                        return workspaceFolderPath ? await ApiUtils.getEnvConfig(workspaceFolderPath) : {};
                    },
                    getProductLibrary: function (): string {
                        return "RPGUNIT";
                    },
                    getBaseExecutionParams: function (tstpgm: string, xmlStmf: string, tstPrc?: string): RUCALLTST {
                        const testParams: RUCALLTST = {
                            tstPgm: tstpgm,
                            tstPrc: tstPrc,
                            order: "*API",
                            detail: "*BASIC",
                            output: "*ALLWAYS",
                            libl: "*CURRENT",
                            jobD: "*DFT",
                            rclRsc: "*NO",
                            xmlStmf: xmlStmf
                        };

                        return testParams;
                    },
                    setIsCompiled: async function (uri: BasicUri, isCompiled: boolean): Promise<void> {
                        // Not used
                        return;
                    },
                    started: async function (uri: BasicUri): Promise<void> {
                        // Not used
                        return;
                    },
                    skipped: async function (uri: BasicUri): Promise<void> {
                        // Not used
                        return;
                    },
                    passed: async function (uri: BasicUri, duration?: number): Promise<void> {
                        // Not used
                        return;
                    },
                    failed: async function (uri: BasicUri, messages: { line?: number; message: string; }[], duration?: number): Promise<void> {
                        // Not used
                        return;
                    },
                    errored: async function (uri: BasicUri, messages: { line?: number; message: string; }[], duration?: number): Promise<void> {
                        // Not used
                        return;
                    },
                    addCoverageDatasets: function (mergedCoverageDatasets: MergedCoverageData[]): void {
                        finalCoverageDatasets = mergedCoverageDatasets;
                        return;
                    },
                    shouldLogCoverage: function (): boolean {
                        return codeCoverage !== undefined;
                    },
                    getCoverageThresholds: function (): string[] {
                        return coverageThresholds;
                    },
                    isCancellationRequested: (): boolean => {
                        return false;
                    },
                    end: async function (): Promise<void> {
                        // Not used
                        return;
                    }
                };

                // Run test buckets
                spinner.stop();
                const runner: Runner = new Runner(connection as any, testRequest, testCallbacks, testLogger);
                await runner.run();
                await connection.dispose();
                await testResultLogger.append(`\n`);
                const testMetrics = runner.getTestMetrics();

                // Generate summary report
                await summaryLogger.generateReport(testMetrics, finalCoverageDatasets, coverageThresholds);

                // Get exit code from test metrics
                const hasFailuresOrErrors = (testMetrics.testFiles.failed > 0 || testMetrics.testCases.failed > 0) ||
                    (testMetrics.testFiles.errored || testMetrics.testCases.errored) > 0;
                const exitCode = hasFailuresOrErrors ? 1 : 0;
                exit(exitCode);
            }
        });

    try {
        program.parse(process.argv);

    } catch (error) {
        console.log(error);
    }
}