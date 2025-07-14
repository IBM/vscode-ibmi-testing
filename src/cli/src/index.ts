import IBMi from "vscode-ibmi/src/api/IBMi";
import { Runner, TestCallbacks } from "./api/runner";
import { ConnectionData } from "@halcyontech/vscode-ibmi-types/api/types";
import { ILELibrarySettings } from "@halcyontech/vscode-ibmi-types/api/CompileTools";
import { DeploymentStatus, Env, RUCALLTST, BasicUri, TestRequest } from "./api/types";
import { TestLogger } from "./api/testLogger";
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
import { ApiUtils } from "./api/apiUtils";
import { Option, program } from "commander";
import c from "ansi-colors";
import ora from "ora";
import * as path from "path";
import * as fs from "fs";
import os from 'os';
import { exit } from "process";

interface Options {
    project?: string;
    library?: string;
    sourceFiles?: string[];
    libraryList?: string[];
    currentLibrary?: string;
    saveCommandOutput?: string | boolean;
    saveTestOutput?: string | boolean;
    saveTestResult?: string | boolean;
}

const VERSION = `1.0.0`;
const SOURCE_FILES = [`QTESTSRC`];
const COMMAND_OUTPUT_PATH = `./logs/ibmi-testing/command-output.log`;
const TEST_OUTPUT_PATH = `./logs/ibmi-testing/test-output.log`;
const TEST_RESULT_PATH = `./logs/ibmi-testing/test-result.log`;

main();

function main() {
    const spinner = ora();

    // Setup CLI information
    program
        .version(VERSION, `-v, --version`, `Display the version number`)
        .name(`itest`)
        .description(`The ${c.cyanBright(`IBM i Testing CLI (itest - v${VERSION})`)} can be used to run unit tests and generate\ncode coverage results in PASE for RPG and COBOL programs on IBM i. Under the\ncovers, this extension leverages the RPGUnit testing framework.\n\n✨ Documentation: https://codefori.github.io/docs/developing/testing/overview`)
        .helpOption(`-h, --help`, `Display help for command`)
        .showHelpAfterError()
        .showSuggestionAfterError()
        .addHelpText(`afterAll`, [
            ``,
            `Examples:`,
            `  itest --library MYLIB --library-list RPGUNIT QDEVTOOLS --current-library MYLIB`,
            `  itest --project /home/USER/ibmi-company_system --library-list RPGUNIT QDEVTOOLS --current-library MYLIB`
        ].join(`\n`));

    // Setup CLI options
    program
        .addOption(new Option(`--project <path>`, `Path to the project containing tests`).default(`.`).conflicts([`library`, `sourceFiles`]))
        .addOption(new Option(`--library <library>`, `Library containing tests.`).conflicts(`project`))
        .addOption(new Option(`--source-files <sourceFiles...>`, `Source files to search for tests.`).default(SOURCE_FILES).conflicts(`project`))
        .addOption(new Option(`--library-list <libraries...>`, `Libraries to add to the library list.`))
        .addOption(new Option(`--current-library <library>`, `The current library to use for the test run.`))
        // .addOption(new Option(`-c, --coverage`, `Run with code coverage`)
        .addOption(new Option(`--save-command-output [path]`, `Save command output logs (defaults: "${COMMAND_OUTPUT_PATH}")`))
        .addOption(new Option(`--save-test-output [path]`, `Save test output logs (defaults: "${TEST_OUTPUT_PATH}")`))
        .addOption(new Option(`--save-test-result [path]`, `Save test result logs (defaults: "${TEST_RESULT_PATH}")`))
        .action(async (options: Options) => {
            spinner.color = 'green';
            spinner.text = 'Setting up environment';
            spinner.start();

            // Resolve to absolute paths and other options
            const cwd = process.cwd();
            const project = options.project ? path.resolve(cwd, options.project) : undefined;
            const library = options.library ? options.library : undefined;
            const sourceFiles = options.sourceFiles ? options.sourceFiles : undefined;
            const libraryList = options.libraryList ? options.libraryList : undefined;
            const currentLibrary = options.currentLibrary ? options.currentLibrary : undefined;
            const saveCommandOutput = options.saveCommandOutput ?
                (options.saveCommandOutput === true ? path.resolve(cwd, COMMAND_OUTPUT_PATH) : path.resolve(cwd, options.saveCommandOutput)) : undefined;
            const saveTestOutput = options.saveTestOutput ?
                (options.saveTestOutput === true ? path.resolve(cwd, TEST_OUTPUT_PATH) : path.resolve(cwd, options.saveTestOutput)) : undefined;
            const saveTestResult = options.saveTestResult ?
                (options.saveTestResult === true ? path.resolve(cwd, TEST_RESULT_PATH) : path.resolve(cwd, options.saveTestResult)) : undefined;

            // Create command logger
            if (saveCommandOutput) {
                fs.mkdirSync(path.dirname(saveCommandOutput), { recursive: true });
                fs.writeFileSync(saveCommandOutput, '');
            }

            // Setup credentials based on if running on IBM i
            let localSSH: LocalSSH | undefined;
            let credentials: ConnectionData;
            const isRunningOnIBMi = os.type().includes('400');
            if (isRunningOnIBMi) {
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
                // Get credentials from environment variables
                const user = process.env.IBMI_USER;
                const host = process.env.IBMI_HOST;
                const sshPort = process.env.SSH_PORT || 22;
                const password = process.env.IBMI_PASSWORD;
                const privateKey = process.env.IBMI_PRIVATE_KEY;

                // Validate credentials
                if (!user || !host) {
                    console.error(`IBMI_USER and IBMI_HOST environment variables are required`);
                    return;
                } else if (!password && !privateKey) {
                    console.error(`IBMI_PASSWORD or IBMI_PRIVATE_KEY is required`);
                    return;
                }

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
                    credentials['privateKey'] = privateKey;
                }
            }

            // Setup Code4i virtual storage and config
            const virtualStorage = new VirtualStorage();
            const virtualConfig = new VirtualConfig();
            IBMi.GlobalStorage = new CodeForIStorage(virtualStorage);
            IBMi.connectionManager.configMethod = virtualConfig;

            // Setup components
            const customQsh = new CustomQSh();
            customQsh.setLocalAssetPath(path.join(__dirname, customQsh.getFileName()));
            const testingId = `ibmi-testing`;
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
                if (saveCommandOutput) {
                    await fs.promises.appendFile(saveCommandOutput, data);
                }
            };
            const result = await connection.connect(
                credentials,
                {
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
                false,
                false,
                localSSH as any
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

                // Create test loggers
                const testOutputLogger = new TestOutputLogger(saveTestOutput);
                const testResultLogger = new TestResultLogger(saveTestResult);
                const testLogger = new TestLogger(testOutputLogger, testResultLogger);

                // Build test bucket and request
                let testBucketBuilder: TestBucketBuilder;
                if (library) {
                    testBucketBuilder = new QsysTestBucketBuilder(connection as any, testOutputLogger, library, sourceFiles);
                } else {
                    if (isRunningOnIBMi) {
                        testBucketBuilder = new IfsTestBucketBuilder(connection as any, testOutputLogger, project);
                    } else {
                        testBucketBuilder = new LocalTestBucketBuilder(testOutputLogger, project);
                    }
                }
                const testBuckets = await testBucketBuilder.getTestBuckets();
                const testRequest: TestRequest = {
                    forceCompile: true,
                    testBuckets: testBuckets
                };

                // Setup test callbacks
                const testCallbacks: TestCallbacks = {
                    deploy: function (workspaceFolderPath: string): Promise<DeploymentStatus> {
                        throw new Error("Function not implemented.");
                    },
                    getDeployDirectory: function (workspaceFolderPath: string): string {
                        throw new Error("Function not implemented.");
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
                    clearDiagnostics: function (): Promise<void> {
                        // Not used
                        return;
                    },
                    loadDiagnostics: function (qualifiedObject: string, workspaceFolderPath?: string): Promise<void> {
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
                    setIsCompiled: function (uri: BasicUri, isCompiled: boolean): Promise<void> {
                        // Not used
                        return;
                    },
                    started: function (uri: BasicUri): Promise<void> {
                        // Not used
                        return;
                    },
                    skipped: function (uri: BasicUri): Promise<void> {
                        // Not used
                        return;
                    },
                    passed: function (uri: BasicUri, duration?: number): Promise<void> {
                        // Not used
                        return;
                    },
                    failed: function (uri: BasicUri, messages: { line?: number; message: string; }[], duration?: number): Promise<void> {
                        // Not used
                        return;
                    },
                    errored: function (uri: BasicUri, messages: { line?: number; message: string; }[], duration?: number): Promise<void> {
                        // Not used
                        return;
                    },
                    // addCoverage: function (fileCoverage: IBMiFileCoverage): void {
                    //     throw new Error("Function not implemented.");
                    // },
                    end: function (): Promise<void> {
                        // Not used
                        return;
                    }
                };

                // Run test buckets
                spinner.stop();
                const runner: Runner = new Runner(connection as any, testRequest, testCallbacks, testLogger);
                await runner.run();
                await testResultLogger.append(`\n`);

                // Get exit code from test metrics
                const testMetrics = runner.getTestMetrics();
                const hasFailuresOrErrors = (testMetrics.testFiles.failed > 0 || testMetrics.testCases.failed > 0) ||
                    (testMetrics.testFiles.errored || testMetrics.testCases.errored) > 0;
                const exitCode = hasFailuresOrErrors ? 1 : 0;
                exit(exitCode);
            }
        });

    program.parse(process.argv);
}