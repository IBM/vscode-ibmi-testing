import { program } from "commander";
import c from "ansi-colors";
import { LocalSSH } from "./LocalClient";
import IBMi from "vscode-ibmi/src/api/IBMi";
import { Runner, TestCallbacks } from "./api/runner";
import { ILELibrarySettings } from "@halcyontech/vscode-ibmi-types/api/CompileTools";
import { IBMiFileCoverage } from "../../fileCoverage";
import { DeploymentStatus, Env, RUCALLTST, BasicUri, TestRequest, TestBucket } from "./api/types";
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
        .option(`-l, --log [logPath]`, `Path to where verbose logs should be stored`, `./logs/ibmi-testing.log`)
        // .option(`-c, --coverage`, `Run with code coverage (not supported yet!)`)
        .action(async (options) => {
            const { project, log } = options;

            // Resolve to absolute paths
            const cwd = process.cwd();
            const projectPath = path.resolve(cwd, project);
            const logPath = path.resolve(cwd, log);

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
            const connection = new IBMi();
            const result = await connection.connect(
                {
                    name: "USER@HOST",
                    host: "HOST",
                    port: 2,
                    username: "USER"
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
            console.log(`Connected to IBM i: ${result.success ? c.green("Success") : c.red("Failed")}`);

            if (result.success) {
                // Create test logger
                const testOutputLogger = new TestOutputLogger(logPath);
                const testResultLogger = new TestResultLogger();
                const testLogger = new TestLogger(testOutputLogger, testResultLogger);

                // Build test bucket and request
                const testBuckets = await buildTestBucket(projectPath);
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
                    getLibraryList: function (workspaceFolderPath?: string): Promise<ILELibrarySettings> {
                        throw new Error("Function not implemented.");
                    },
                    isDiagnosticsCleared: function (): boolean {
                        return true;
                    },
                    clearDiagnostics: function (): Promise<void> {
                        return;
                    },
                    loadDiagnostics: function (qualifiedObject: string, workspaceFolderPath?: string): Promise<void> {
                        return;
                    },
                    getEnvConfig: function (workspaceFolderPath: string): Promise<Env> {
                        throw new Error("Function not implemented.");
                    },
                    getProductLibrary: function (): string {
                        throw new Error("Function not implemented.");
                    },
                    getBaseExecutionParams: function (tstpgm: string, xmlStmf: string, tstPrc?: string): RUCALLTST {
                        throw new Error("Function not implemented.");
                    },
                    setIsCompiled: function (uri: BasicUri, isCompiled: boolean): Promise<void> {
                        throw new Error("Function not implemented.");
                    },
                    started: function (uri: BasicUri): Promise<void> {
                        throw new Error("Function not implemented.");
                    },
                    skipped: function (uri: BasicUri): Promise<void> {
                        throw new Error("Function not implemented.");
                    },
                    passed: function (uri: BasicUri, duration?: number): Promise<void> {
                        throw new Error("Function not implemented.");
                    },
                    failed: function (uri: BasicUri, messages: { line?: number; message: string; }[], duration?: number): Promise<void> {
                        throw new Error("Function not implemented.");
                    },
                    errored: function (uri: BasicUri, messages: { line?: number; message: string; }[], duration?: number): Promise<void> {
                        throw new Error("Function not implemented.");
                    },
                    // addCoverage: function (fileCoverage: IBMiFileCoverage): void {
                    //     throw new Error("Function not implemented.");
                    // },
                    end: function (): Promise<void> {
                        throw new Error("Function not implemented.");
                    }
                };

                // Run test buckets
                const runner: Runner = new Runner(connection as any, testRequest, testCallbacks, testLogger);
                await runner.run();
            }
        });

    program.parse(process.argv);
}

async function buildTestBucket(projectPath: string): Promise<TestBucket[]> {
    return [];
}