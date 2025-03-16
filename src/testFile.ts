import { commands, DocumentSymbol, LogLevel, SymbolKind, TestItem, TestRun, workspace } from "vscode";
import { TestCase } from "./testCase";
import { manager } from "./extension";
import { getDeployTools, getInstance } from "./api/ibmi";
import { IBMiTestManager } from "./manager";
import { IBMiTestRunner } from "./runner";
import { TestingConfig, RUCRTRPG } from "./types";
import * as path from "path";
import { ConfigHandler } from "./config";
import { Configuration, defaultConfigurations, Section } from "./configuration";
import { Logger } from "./outputChannel";

export class TestFile {
    static RPGLE_TEST_CASE_REGEX = /^TEST.+$/i;
    static COBOL_TEST_CASE_REGEX = /^PROGRAM-ID\. +(TEST.+)$/i;
    static textDecoder = new TextDecoder('utf-8');
    item: TestItem;
    workspaceItem: TestItem;
    isLoaded: boolean;
    isCompiled: boolean;
    content: string;
    isRPGLE: boolean;

    constructor(item: TestItem, workspaceItem: TestItem) {
        this.item = item;
        this.workspaceItem = workspaceItem;
        this.isLoaded = false;
        this.isCompiled = false;
        this.content = '';

        const rpgleTestSuffixes = [
            IBMiTestManager.RPGLE_TEST_SUFFIX,
            IBMiTestManager.SQLRPGLE_TEST_SUFFIX
        ];
        this.isRPGLE = rpgleTestSuffixes.some(suffix => item.uri!.path.toLocaleUpperCase().endsWith(suffix));
    }

    async load(content?: string): Promise<void> {
        if (!this.isLoaded) {
            this.isLoaded = true;

            // Load test file content
            if (content) {
                this.content = content;
            } else {
                try {
                    const rawContent = await workspace.fs.readFile(this.item.uri!);
                    this.content = TestFile.textDecoder.decode(rawContent);
                } catch (error: any) {
                    Logger.getInstance().logWithErrorNotification(LogLevel.Error, `Failed to load test file`, error);
                }
            }

            // Load test cases
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
                    const childItem = manager!.controller.createTestItem(`${this.item.uri}/${testCaseName}`, testCaseName, this.item.uri);
                    childItem.range = documentSymbol.range;

                    const data = new TestCase(childItem);
                    manager!.testData.set(childItem, data);
                    childItems.push(childItem);
                }
            }
            this.item.children.replace(childItems);
            Logger.getInstance().log(LogLevel.Info, `Loaded test file ${this.item.label} with ${childItems.length} test cases`);
        }
    }

    async compileMember(run: TestRun): Promise<void> {
        const ibmi = getInstance();
        const connection = ibmi!.getConnection();
        const content = ibmi!.getContent();
        const config = ibmi!.getConfig();

        let tstPgm: { name: string, library: string };
        let srcFile: { name: string, library: string } | undefined;
        let srcMbr: string | undefined;
        let srcStmf: string | undefined;
        let testingConfig: TestingConfig | undefined;

        if (this.item.uri!.scheme === 'file') {
            // Get relative local path to test
            const workspaceFolder = workspace.getWorkspaceFolder(this.item.uri!)!;
            const relativePathToTest = path.relative(workspaceFolder.uri.fsPath, this.item.uri!.fsPath).replace(/\\/g, '/');

            // Construct remote path to test
            const deployTools = getDeployTools()!;
            const deployDirectory = deployTools.getRemoteDeployDirectory(workspaceFolder)!;
            if (deployDirectory) {
                srcStmf = path.posix.join(deployDirectory, relativePathToTest);
            } else {
                IBMiTestRunner.updateTestRunStatus(run, 'deployment', { result: 'Deploy Location Not Set' });
            }

            const tstPgmName = this.item.label
                .replace(new RegExp(IBMiTestManager.RPGLE_TEST_SUFFIX, 'i'), '')
                .replace(new RegExp(IBMiTestManager.SQLRPGLE_TEST_SUFFIX, 'i'), '')
                .replace(new RegExp(IBMiTestManager.COBOL_TEST_SUFFIX, 'i'), '')
                .replace(new RegExp(IBMiTestManager.SQLCOBOL_TEST_SUFFIX, 'i'), '')
                .toLocaleUpperCase();
            tstPgm = { name: tstPgmName, library: config.currentLibrary };
            testingConfig = await ConfigHandler.getLocalConfig(this.item.uri!);
        } else {
            const parsedPath = connection.parserMemberPath(this.item.uri!.path);
            tstPgm = { name: parsedPath.name.toLocaleUpperCase(), library: parsedPath.library };
            srcFile = { name: parsedPath.file, library: parsedPath.library };
            srcMbr = '*TSTPGM';
            testingConfig = await ConfigHandler.getRemoteConfig(this.item.uri!);
        }

        const compileParams: RUCRTRPG = {
            tstPgm: `${tstPgm.library}/${tstPgm.name}`,
            srcFile: srcFile ? `${srcFile.library}/${srcFile.name}` : undefined,
            srcMbr: srcMbr,
            srcStmf: srcStmf,
            ...testingConfig?.RUCRTRPG
        };

        // Set TGTCCSID to 37 by default if not set
        if (!compileParams.tgtCcsid) {
            compileParams.tgtCcsid = "37";
        }

        const productLibrary = Configuration.get<string>(Section.productLibrary) || defaultConfigurations[Section.productLibrary];
        const languageSpecificCommand = this.isRPGLE ? 'RUCRTRPG' : 'RUCRTCBL';
        const compileCommand = content.toCl(`${productLibrary}/${languageSpecificCommand}`, compileParams as any);
        Logger.getInstance().log(LogLevel.Info, `Compiling ${this.item.label}: ${compileCommand}`);

        const compileResult = await connection.runCommand({ command: compileCommand, environment: `ile` });
        if (compileResult.stderr.length > 0) {
            Logger.getInstance().log(LogLevel.Error, `${this.item.label} compile error(s):\n ${compileResult.stderr}`);
        }

        if (compileResult.code === 0) {
            IBMiTestRunner.updateTestRunStatus(run, 'compilation', { item: this.item, success: true });
            this.isCompiled = true;
        } else {
            IBMiTestRunner.updateTestRunStatus(run, 'compilation', { item: this.item, failed: true, messages: compileResult.stderr.split('\n') });
        }
    }
}