import { program } from "commander";
import c from "ansi-colors";
import IBMi from "vscode-ibmi/src/api/IBMi";
import { Runner, TestCallbacks } from "./api/runner";
import { ILELibrarySettings } from "@halcyontech/vscode-ibmi-types/api/CompileTools";
import { DeploymentStatus, Env, RUCALLTST, BasicUri, TestRequest } from "./api/types";
import { TestLogger } from "./api/testLogger";
import { TestOutputLogger } from "./loggers/testOutputLogger";
import { TestResultLogger } from "./loggers/testResultLogger";
import * as path from "path";
import { CodeForIStorage } from "vscode-ibmi/src/api/configuration/storage/CodeForIStorage";
import { VirtualStorage } from "vscode-ibmi/src/api/configuration/storage/BaseStorage";
import { VirtualConfig } from "vscode-ibmi/src/api/configuration/config/VirtualConfig";
import { extensionComponentRegistry } from "vscode-ibmi/src/api/components/manager";
import { CustomQSh } from "vscode-ibmi/src/api/components/cqsh";
import { GetNewLibl } from "vscode-ibmi/src/api/components/getNewLibl";
import { GetMemberInfo } from "vscode-ibmi/src/api/components/getMemberInfo";
import { CopyToImport } from "vscode-ibmi/src/api/components/copyToImport";
import { RequestBuilder } from "./requestBuilder";
import { LocalSSH } from "./localSsh";
import { ApiUtils } from "./api/apiUtils";

main();

function main() {
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
        .command(`runIfs`)
        .option(`-p, --project [projectPath]`, `Path to the root of the project`, `.`)
        .option(`-l, --log [logFile]`, `Path to where verbose logs should be stored`, `./logs/ibmi-testing.log`)
        // .option(`--productLibrary`, `Specifies the name of the RPGUnit product library on the host.`, `RPGUNIT`)
        // .addOption(new Option(`--runOrder`, `Specifies the order for running the test procedures. Useful to check that there is no dependencies between test procedures.`).default(`*API`).choices([`*API`, `*REVERSE`]))
        // .addOption(new Option(`--libraryList`, `Specifies the library list for executing the specified unit test.`).default(`*CURRENT`).choices([`*CURRENT`, `*JOBD`]))
        // .addOption(new Option(`--jobDescription`, `Specifies the name of the job description that is used to set the library list, when the \`--libraryList\` option is set to \`*JOBD\`. \`*DFT\` can be used here to indicate the library of the unit test suite (service program) is searched for job description \`RPGUNIT\`.`).default(`*DFT`))
        // .addOption(new Option(`--reportDetail`, `Specifies how detailed the test run report should be.`).default(`*BASIC`).choices([`*BASIC`, `*ALL`]))
        // .addOption(new Option(`--createReport`, `Specifies whether a report is created.`).default(`*ALLWAYS`).choices([`*ALLWAYS`, `*ERROR`, `*NONE`]))
        // .addOption(new Option(`--reclaimResources`, `Specifies when to reclaim resources. Resources, such as open files, can be reclaimed after each test case or at the end of the test suite. This option is useful if the test suite calls OPM programs, which do not set the \`*INLR\` indicator.`).default(`*NO`).choices([`*NO`, `*ALLWAYS`, `*ONCE`]))
        // .option(`-c, --coverage`, `Run with code coverage (not supported yet!)`)
        .action(async (options) => {
            const { project, log } = options;

            // Resolve to absolute paths
            const cwd = process.cwd();
            const projectPath = path.resolve(cwd, project);
            const logFile = path.resolve(cwd, log);

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
            const localSSH = new LocalSSH();
            const user = (await localSSH.execCommand(`whoami`)).stdout;
            const host = (await localSSH.execCommand(`hostname`)).stdout;
            const connection = new IBMi();
            connection.appendOutput = (data) => { };
            const result = await connection.connect(
                {
                    name: `${user}@${host}`,
                    host: host,
                    port: 22,
                    username: user
                },
                {
                    message: (type: string, message: string) => {
                        // console.log(`${c.cyanBright(type)}: ${message}`);
                    },
                    progress: ({ message }) => {
                        // console.log(`${c.yellowBright("Progress")}: ${message}`);
                    },
                    uiErrorHandler: async (connection, code, data) => {
                        // console.error(`${c.redBright("Error:")} (${code}): ${data}`);
                        return false;
                    },
                },
                false,
                false,
                localSSH as any
            );

            if (result.success) {
                // Create test logger
                const testOutputLogger = new TestOutputLogger(logFile);
                const testResultLogger = new TestResultLogger();
                const testLogger = new TestLogger(testOutputLogger, testResultLogger);

                // Build test bucket and request
                const requestBuilder = new RequestBuilder(connection as any, testOutputLogger, projectPath);
                const testBuckets = await requestBuilder.buildTestBucket();
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
                const runner: Runner = new Runner(connection as any, testRequest, testCallbacks, testLogger);
                await runner.run();
            }
        });

    program.parse(process.argv);
}