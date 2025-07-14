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
import { program } from "commander";
import c from "ansi-colors";
import ora from "ora";
import * as path from "path";
import os from 'os';

main();

function main() {
    const spinner = ora();

    // Setup CLI information
    program
        .version(`1.0.0`, `-v, --version`, `Display the version number`)
        .description(`The ${c.cyanBright(`IBM i Testing (itest) CLI`)} can be used to run unit tests and generate code\ncoverage results in PASE for RPG and COBOL programs on IBM i. Under the\ncovers, this extension leverages the RPGUnit testing framework.\n\n✨ Documentation: https://codefori.github.io/docs/developing/testing/overview`)
        .helpOption(`-h, --help`, `Display help for command`)
        .showHelpAfterError(true)
        .showSuggestionAfterError(true)
        .configureHelp({ sortOptions: true });

    // Setup CLI options
    program
        .option(`-p, --project <project>`, `Path to the root of the project containing tests`, `.`)
        .option(`-l, --library <library> [testSourceFiles]`, `Library and optional comma separated list of source files to search for tests.`)
        .option(`-o, --log <logFile>`, `Path to where verbose logs should be stored`, `./logs/ibmi-testing.log`)
        // .option(`--productLibrary`, `Specifies the name of the RPGUnit product library on the host.`, `RPGUNIT`)
        // .addOption(new Option(`--runOrder`, `Specifies the order for running the test procedures. Useful to check that there is no dependencies between test procedures.`).default(`*API`).choices([`*API`, `*REVERSE`]))
        // .addOption(new Option(`--libraryList`, `Specifies the library list for executing the specified unit test.`).default(`*CURRENT`).choices([`*CURRENT`, `*JOBD`]))
        // .addOption(new Option(`--jobDescription`, `Specifies the name of the job description that is used to set the library list, when the \`--libraryList\` option is set to \`*JOBD\`. \`*DFT\` can be used here to indicate the library of the unit test suite (service program) is searched for job description \`RPGUNIT\`.`).default(`*DFT`))
        // .addOption(new Option(`--reportDetail`, `Specifies how detailed the test run report should be.`).default(`*BASIC`).choices([`*BASIC`, `*ALL`]))
        // .addOption(new Option(`--createReport`, `Specifies whether a report is created.`).default(`*ALLWAYS`).choices([`*ALLWAYS`, `*ERROR`, `*NONE`]))
        // .addOption(new Option(`--reclaimResources`, `Specifies when to reclaim resources. Resources, such as open files, can be reclaimed after each test case or at the end of the test suite. This option is useful if the test suite calls OPM programs, which do not set the \`*INLR\` indicator.`).default(`*NO`).choices([`*NO`, `*ALLWAYS`, `*ONCE`]))
        // .option(`-c, --coverage`, `Run with code coverage (not supported yet!)`)
        .action(async (options) => {
            spinner.color = 'green';
            spinner.text = 'Setting up environment';
            spinner.start();

            let { project, library, testSourceFiles, log } = options;

            // Resolve to absolute paths and other options
            const cwd = process.cwd();
            project = path.resolve(cwd, project);
            library = library?.trim();
            testSourceFiles = testSourceFiles?.split(',').map((sourceFile: string) => sourceFile.trim()) || [`QTESTSRC`];
            log = path.resolve(cwd, log);

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
                    throw new Error(`IBMI_USER and IBMI_HOST environment variables are required`);
                } else if (!password && !privateKey) {
                    throw new Error(`IBMI_PASSWORD or IBMI_PRIVATE_KEY is required`);
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
            connection.appendOutput = (data) => { };
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

            if (result.success) {
                spinner.color = 'cyan';
                spinner.text = 'Loading tests';
                spinner.start();

                // Create test logger
                const testOutputLogger = new TestOutputLogger(log);
                const testResultLogger = new TestResultLogger();
                const testLogger = new TestLogger(testOutputLogger, testResultLogger);

                // Build test bucket and request
                let testBucketBuilder: TestBucketBuilder;
                if (library) {
                    testBucketBuilder = new QsysTestBucketBuilder(connection as any, testOutputLogger, library, testSourceFiles);
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
                        const env = await ApiUtils.getEnvConfig(workspaceFolderPath) || {};

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
                        return await ApiUtils.getEnvConfig(workspaceFolderPath) || {};
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
            }
        });

    program.parse(process.argv);
}