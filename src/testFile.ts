import { commands, DocumentSymbol, LogLevel, SymbolKind, TestItem, TestRun, workspace, WorkspaceFolder } from "vscode";
import { TestCase } from "./testCase";
import { manager } from "./extension";
import { getDeployTools, getInstance } from "./extensions/ibmi";
import { IBMiTestRunner } from "./runner";
import { TestingConfig, RUCRTRPG, RUCRTCBL } from "./types";
import * as path from "path";
import { ConfigHandler } from "./config";
import { Configuration, Section } from "./configuration";
import { Logger } from "./logger";
import { Utils } from "./utils";
import { TestLogger } from "./testLogger";

export class TestFile {
    static RPGLE_TEST_CASE_REGEX = /^TEST.*$/i;
    static COBOL_TEST_CASE_REGEX = /^PROGRAM-ID\. +(TEST.+)$/i;
    static textDecoder = new TextDecoder('utf-8');
    item: TestItem;
    workspaceItem?: TestItem;
    libraryItem?: TestItem;
    isLoaded: boolean;
    isCompiled: boolean;
    content: string;
    isRPGLE: boolean;

    constructor(item: TestItem, parent: { workspaceItem?: TestItem, libraryItem?: TestItem } = {}) {
        this.item = item;
        this.workspaceItem = parent.workspaceItem;
        this.libraryItem = parent.libraryItem;
        this.isLoaded = false;
        this.isCompiled = false;
        this.content = '';

        const rpgleTestSuffixes = Utils.getTestSuffixes({ rpg: true, cobol: false });
        this.isRPGLE = rpgleTestSuffixes.qsys.some(suffix => item.uri!.path.toLocaleUpperCase().endsWith(suffix));
    }

    async load(): Promise<void> {
        if (!this.isLoaded) {
            this.isLoaded = true;

            // Load test file content
            try {
                const rawContent = await workspace.fs.readFile(this.item.uri!);
                this.content = TestFile.textDecoder.decode(rawContent);
            } catch (error: any) {
                Logger.log(LogLevel.Error, `Failed to read test file ${this.item.label}: ${error}`);
            }

            // Load test cases
            try {
                const childItems: TestItem[] = [];
                const documentSymbols = await commands.executeCommand<DocumentSymbol[]>(`vscode.executeDocumentSymbolProvider`, this.item.uri) || [];
                for (const documentSymbol of documentSymbols) {
                    const isTestCase = this.isRPGLE ?
                        documentSymbol.kind === SymbolKind.Function && TestFile.RPGLE_TEST_CASE_REGEX.test(documentSymbol.name) :
                        documentSymbol.kind === SymbolKind.Class && documentSymbol.name.match(TestFile.COBOL_TEST_CASE_REGEX)?.[1];

                    if (isTestCase) {
                        const testCaseName = this.isRPGLE ?
                            documentSymbol.name :
                            documentSymbol.name.match(TestFile.COBOL_TEST_CASE_REGEX)![1];
                        const childItem = manager!.controller.createTestItem(`${this.item.uri}/${testCaseName.toLocaleUpperCase()}`, testCaseName, this.item.uri);
                        childItem.range = documentSymbol.range;

                        const data = new TestCase(childItem);
                        manager!.testData.set(childItem, data);
                        childItems.push(childItem);
                    }
                }
                this.item.children.replace(childItems);
                Logger.log(LogLevel.Info, `Loaded test file ${this.item.label} with ${childItems.length} test cases: ${childItems.map(item => item.label).join(', ')}`);
            } catch (error) {
                Logger.log(LogLevel.Error, `Failed to load test cases from ${this.item.label}: ${error}`);
            }
        }
    }

    async compile(runner: IBMiTestRunner, run: TestRun): Promise<void> {
        const ibmi = getInstance();
        const connection = ibmi!.getConnection();
        const content = connection.getContent();
        const config = connection.getConfig();

        let workspaceFolder: WorkspaceFolder | undefined;
        let deployDirectory: string | undefined;
        let tstPgm: { name: string, library: string };
        let srcFile: { name: string, library: string } | undefined;
        let srcMbr: string | undefined;
        let srcStmf: string | undefined;
        let testingConfig: TestingConfig | undefined;

        const configHandler = new ConfigHandler();
        if (this.item.uri!.scheme === 'file') {
            // Construct test program name without any suffix and convert to system name
            let originalTstPgmName = this.item.label;
            const testSuffixes = Utils.getTestSuffixes({ rpg: true, cobol: true });
            for (const suffix of testSuffixes.ifs) {
                if (originalTstPgmName.toLocaleUpperCase().endsWith(suffix)) {
                    originalTstPgmName = originalTstPgmName.replace(new RegExp(suffix, 'i'), '');
                }
            }
            originalTstPgmName = originalTstPgmName.toLocaleUpperCase();
            const tstPgmName = Utils.getSystemName(originalTstPgmName);
            if (tstPgmName !== originalTstPgmName) {
                Logger.log(LogLevel.Warning, `Test program name ${originalTstPgmName} was converted to ${tstPgmName}`);
            }

            // Use current library as the test library
            workspaceFolder = workspace.getWorkspaceFolder(this.item.uri!)!;
            const libraryList = await ibmi!.getLibraryList(connection, workspaceFolder);
            const tstLibrary = libraryList?.currentLibrary || config.currentLibrary;

            // Get relative local path to test
            const relativePathToTest = path.relative(workspaceFolder.uri.fsPath, this.item.uri!.fsPath).replace(/\\/g, '/');

            // Construct remote path to test
            const deployTools = getDeployTools()!;
            deployDirectory = deployTools.getRemoteDeployDirectory(workspaceFolder)!;
            srcStmf = path.posix.join(deployDirectory, relativePathToTest);

            tstPgm = { name: tstPgmName, library: tstLibrary };
            testingConfig = await configHandler.getLocalConfig(this.item.uri!);
        } else {
            const parsedPath = connection.parserMemberPath(this.item.uri!.path);
            const tstPgmName = parsedPath.name.toLocaleUpperCase();
            const tstLibrary = parsedPath.library;
            const srcFileName = parsedPath.file;

            tstPgm = { name: tstPgmName, library: tstLibrary };
            srcFile = { name: srcFileName, library: tstLibrary };
            srcMbr = '*TSTPGM';
            testingConfig = await configHandler.getRemoteConfig(this.item.uri!);
        }

        let compileParams: RUCRTRPG | RUCRTCBL = {
            tstPgm: `${tstPgm.library}/${tstPgm.name}`,
            srcFile: srcFile ? `${srcFile.library}/${srcFile.name}` : undefined,
            srcMbr: srcMbr,
            srcStmf: srcStmf
        };

        if (this.isRPGLE) {
            compileParams = {
                ...compileParams,
                ...testingConfig?.RPGUnit?.RUCRTRPG
            };

            if (!(compileParams as RUCRTRPG).rpgPpOpt) {
                (compileParams as RUCRTRPG).rpgPpOpt = "*LVL2";
            }
        } else {
            compileParams = {
                ...compileParams,
                ...testingConfig?.RPGUnit?.RUCRTCBL
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

        if (compileParams.incDir) {
            // Resolve relative include directories with the deploy directory for local files
            if (workspaceFolder && deployDirectory) {
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

        const productLibrary = Configuration.getOrFallback<string>(Section.productLibrary);
        const languageSpecificCommand = this.isRPGLE ? 'RUCRTRPG' : 'RUCRTCBL';
        const compileCommand = content.toCl(`${productLibrary}/${languageSpecificCommand}`, flattenedCompileParams as any);
        Logger.log(LogLevel.Info, `Compiling ${this.item.label}: ${compileCommand}`);

        let compileResult: any;
        try {
            const env = workspaceFolder ? (await Utils.getEnvConfig(workspaceFolder)) : {};
            compileResult = await connection.runCommand({ command: compileCommand, environment: `ile`, env: env });
        } catch (error: any) {
            TestLogger.logCompilation(run, this.item, 'failed', runner.metrics, [error.message ? error.message : error]);
            return;
        }

        try {
            // Retrieve diagnostics messages
            if (compileParams.cOption.includes('*EVENTF')) {
                const ext = path.parse(this.item.uri!.path).ext;
                await commands.executeCommand('code-for-ibmi.openErrors', {
                    qualifiedObject: `${compileParams.tstPgm}${ext}`,
                    workspace: workspaceFolder,
                    keepDiagnostics: true
                });
            }
        } catch (error: any) {
            Logger.log(LogLevel.Error, `Failed to retrieve diagnostics messages: ${error}`);
        }

        if (compileResult.stderr.length > 0) {
            Logger.log(LogLevel.Error, `${this.item.label} compile error(s):\n${compileResult.stderr}`);
        }

        if (compileResult.code === 0) {
            TestLogger.logCompilation(run, this.item, 'success', runner.metrics);
            this.isCompiled = true;
        } else {
            TestLogger.logCompilation(run, this.item, 'failed', runner.metrics, compileResult.stderr.split('\n'));
        }
    }
}