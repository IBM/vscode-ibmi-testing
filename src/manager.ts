import { CancellationToken, ExtensionContext, FileCoverage, GlobPattern, LogLevel, RelativePattern, StatementCoverage, TestController, TestItem, TestRun, TestRunProfileKind, TestRunRequest, tests, TextDocument, TextDocumentChangeEvent, Uri, workspace, WorkspaceFolder } from "vscode";
import { TestFile } from "./testFile";
import { TestCase } from "./testCase";
import * as path from "path";
import { IBMiTestRunner } from "./runner";
import { TestDirectory } from "./testDirectory";
import { Logger } from "./outputChannel";
import { IBMiFileCoverage } from "./fileCoverage";
import { IBMiTestStorage } from "./storage";
import { CodeCoverage } from "./codeCoverage";

export type IBMiTestData = TestDirectory | TestFile | TestCase;

export class IBMiTestManager {
    public static CONTROLLER_ID = 'ibmiTest';
    public static CONTROLLER_LABEL = 'IBM i Tests';
    public static RUN_PROFILE_LABEL = 'Run Tests';
    public static LINE_COVERAGE_PROFILE_LABEL = 'Run Tests with Line Coverage';
    public static PROCEDURE_COVERAGE_PROFILE_LABEL = 'Run Tests with Procedure Coverage';
    public static TEST_SUFFIX = '.TEST';
    public static RPGLE_TEST_SUFFIX = `${IBMiTestManager.TEST_SUFFIX}.RPGLE`;
    public static SQLRPGLE_TEST_SUFFIX = `${IBMiTestManager.TEST_SUFFIX}.SQLRPGLE`;
    public static COBOL_TEST_SUFFIX = `${IBMiTestManager.TEST_SUFFIX}.CBLLE`;
    public static SQLCOBOL_TEST_SUFFIX = `${IBMiTestManager.TEST_SUFFIX}.SQLCBLLE`;
    public context: ExtensionContext;
    public testData: WeakMap<TestItem, IBMiTestData>;
    public controller: TestController;

    constructor(context: ExtensionContext) {
        this.context = context;
        this.testData = new WeakMap<TestItem, IBMiTestData>();
        this.controller = tests.createTestController(IBMiTestManager.CONTROLLER_ID, IBMiTestManager.CONTROLLER_LABEL);
        this.controller.resolveHandler = async (item: TestItem | undefined) => {
            if (!item) {
                this.startWatchingWorkspace();
                return;
            }

            const data = this.testData.get(item);
            if (data instanceof TestFile) {
                await data.load();
            }
        };
        this.controller.refreshHandler = async () => {
            const workspaceTestPatterns = this.getWorkspaceTestPatterns();
            for await (const workspaceTestPattern of workspaceTestPatterns) {
                await this.findInitialFiles(workspaceTestPattern.pattern);
            }
        };
        const runProfile = this.controller.createRunProfile(IBMiTestManager.RUN_PROFILE_LABEL, TestRunProfileKind.Run, async (request: TestRunRequest, token: CancellationToken) => {
            const runner = new IBMiTestRunner(this, request, token);
            await runner.runHandler();
        }, true, undefined, false);
        const lineCoverageProfile = this.controller.createRunProfile(IBMiTestManager.LINE_COVERAGE_PROFILE_LABEL, TestRunProfileKind.Coverage, async (request: TestRunRequest, token: CancellationToken) => {
            const runner = new IBMiTestRunner(this, request, token);
            await runner.runHandler();
        }, true, undefined, false);
        const procedureCoverageProfile = this.controller.createRunProfile(IBMiTestManager.PROCEDURE_COVERAGE_PROFILE_LABEL, TestRunProfileKind.Coverage, async (request: TestRunRequest, token: CancellationToken) => {
            const runner = new IBMiTestRunner(this, request, token);
            await runner.runHandler();
        }, false, undefined, false);
        const loadDetailedCoverage = async (testRun: TestRun, fileCoverage: FileCoverage, token: CancellationToken) => {
            if (fileCoverage instanceof IBMiFileCoverage) {
                if (fileCoverage.isStatementCoverage) {
                    return fileCoverage.lines;
                } else if (fileCoverage.procedures.length > 0) {
                    return fileCoverage.procedures;
                }
            }

            return [];
        };
        lineCoverageProfile.loadDetailedCoverage = loadDetailedCoverage;
        procedureCoverageProfile.loadDetailedCoverage = loadDetailedCoverage;

        for (const document of workspace.textDocuments) {
            this.updateNodeForDocument(document);
        }

        context.subscriptions.push(
            this.controller,
            workspace.onDidOpenTextDocument(async (document: TextDocument) => {
                await this.updateNodeForDocument(document);
            }),
            workspace.onDidChangeTextDocument(async (event: TextDocumentChangeEvent) => {
                await this.updateNodeForDocument(event.document);
            })
        );

        IBMiTestStorage.setupTestStorage();
        CodeCoverage.setupCodeCoverage();
    }

    private getWorkspaceTestPatterns(): { workspaceFolder: WorkspaceFolder; pattern: RelativePattern; }[] {
        const workspaceFolders = workspace.workspaceFolders;
        if (!workspaceFolders) {
            return [];
        }

        const testSuffixes = [
            IBMiTestManager.RPGLE_TEST_SUFFIX,
            IBMiTestManager.SQLRPGLE_TEST_SUFFIX,
            IBMiTestManager.COBOL_TEST_SUFFIX,
            IBMiTestManager.SQLCOBOL_TEST_SUFFIX
        ].flatMap(suffix => [suffix, suffix.toLowerCase()]).join(',');

        return workspaceFolders.map((workspaceFolder: WorkspaceFolder) => {
            return {
                workspaceFolder,
                pattern: new RelativePattern(workspaceFolder, `**/*{${testSuffixes}}`)
            };
        });
    }

    private async findInitialFiles(pattern: GlobPattern): Promise<void> {
        const fileUris = await workspace.findFiles(pattern);
        for (const uri of fileUris) {
            this.getOrCreateFile(uri);
        }
    }

    private startWatchingWorkspace(): void {
        const workspaceTestPatterns = this.getWorkspaceTestPatterns();

        for (const workspaceTestPattern of workspaceTestPatterns) {
            const watcher = workspace.createFileSystemWatcher(workspaceTestPattern.pattern);
            this.context.subscriptions.push(watcher);

            watcher.onDidCreate((uri: Uri) => {
                this.getOrCreateFile(uri);
            });
            watcher.onDidChange(async (uri: Uri) => {
                const result = this.getOrCreateFile(uri);
                if (result) {
                    result.data.isLoaded = false;
                    result.data.isCompiled = false;
                    await result.data.load();
                }
            });
            watcher.onDidDelete((uri: Uri) => {
                const allTestItems = this.getFlattenedTestItems();
                const deletedItem = allTestItems.find((item) => item.uri?.toString() === uri.toString());

                if (!deletedItem) {
                    // File not found in test collection
                    return;
                }

                // Delete item associated with the file
                let parentItem = deletedItem.parent;
                parentItem?.children.delete(deletedItem.id);
                this.testData.delete(deletedItem);
                Logger.getInstance().log(LogLevel.Info, `Deleted file test item for ${uri.toString()}`);

                // Recursively delete empty parents
                while (parentItem && parentItem.children.size === 0) {
                    const grandParentItem = parentItem.parent;

                    if (!grandParentItem) {
                        // Delete workspace item when no grandparent
                        this.controller.items.delete(parentItem.id);
                        this.testData.delete(parentItem);
                        Logger.getInstance().log(LogLevel.Info, `Deleted workspace test item for ${parentItem.uri?.toString()}`);
                        break;
                    }

                    grandParentItem.children.delete(parentItem.id);
                    this.testData.delete(parentItem);
                    parentItem = grandParentItem;
                    Logger.getInstance().log(LogLevel.Info, `Deleted directory test item for ${parentItem.uri?.toString()}`);
                }
            });

            this.findInitialFiles(workspaceTestPattern.pattern);
        }
    }

    private getOrCreateFile(uri: Uri): { item: TestItem; data: TestFile; } | undefined {
        // Check if test item already exists
        const allTestItems = this.getFlattenedTestItems();
        const existingItem = allTestItems.find((item) => item.uri!.toString() === uri.toString());
        if (existingItem) {
            return {
                item: existingItem,
                data: this.testData.get(existingItem) as TestFile
            };
        } else {
            // Get workspace folder for the file
            const workspaceFolder = workspace.getWorkspaceFolder(uri);
            if (!workspaceFolder) {
                return;
            }

            // Create workspace test item if it does not exist
            let workspaceItem = this.controller.items.get(workspaceFolder.uri.toString());
            if (!workspaceItem) {
                workspaceItem = this.controller.createTestItem(workspaceFolder.uri.toString(), path.parse(workspaceFolder.uri.path).base, workspaceFolder.uri);
                workspaceItem.canResolveChildren = true;
                this.controller.items.add(workspaceItem);
                Logger.getInstance().log(LogLevel.Info, `Created workspace test item for ${workspaceFolder.uri.toString()}`);

                const data = new TestDirectory(workspaceItem);
                this.testData.set(workspaceItem, data);
            }

            // Create directory test items if they do not exist
            let parentItem = workspaceItem;
            const relativePathToTest = path.relative(workspaceFolder.uri.fsPath, path.parse(uri.fsPath).dir);
            const directoryNames = relativePathToTest.split(path.sep).filter((directoryName) => directoryName !== '');
            for (const directoryName of directoryNames) {
                const directoryUri = Uri.joinPath(workspaceFolder.uri, directoryName);
                let directoryItem = parentItem.children.get(directoryUri.toString());
                if (!directoryItem) {
                    directoryItem = this.controller.createTestItem(directoryUri.toString(), directoryName, directoryUri);
                    directoryItem.canResolveChildren = true;
                    parentItem.children.add(directoryItem);
                    Logger.getInstance().log(LogLevel.Info, `Created directory test item for ${directoryUri.toString()}`);

                    const data = new TestDirectory(directoryItem);
                    this.testData.set(directoryItem, data);
                }

                parentItem = directoryItem;
            }

            // Create file test item
            const fileItem = this.controller.createTestItem(uri.toString(), path.parse(uri.path).base, uri);
            fileItem.canResolveChildren = true;
            parentItem.children.add(fileItem);
            Logger.getInstance().log(LogLevel.Info, `Created file test item for ${uri.toString()}`);

            const data = new TestFile(fileItem, workspaceItem);
            this.testData.set(fileItem, data);

            return {
                item: fileItem,
                data: data
            };
        }
    }

    public getFlattenedTestItems(): TestItem[] {
        const result: TestItem[] = [];

        function gatherChildren(item: TestItem) {
            result.push(item);
            for (const [, child] of item.children) {
                gatherChildren(child);
            }
        }

        for (const [, item] of this.controller.items) {
            gatherChildren(item);
        }

        return result;
    }


    private async updateNodeForDocument(document: TextDocument): Promise<void> {
        if (!['file', 'member'].includes(document.uri.scheme)) {
            return;
        }

        const testSuffixes = [
            IBMiTestManager.RPGLE_TEST_SUFFIX,
            IBMiTestManager.SQLRPGLE_TEST_SUFFIX,
            IBMiTestManager.COBOL_TEST_SUFFIX,
            IBMiTestManager.SQLCOBOL_TEST_SUFFIX
        ];
        if (!testSuffixes.some(suffix => document.uri.path.toLocaleUpperCase().endsWith(suffix))) {
            return;
        }

        const result = this.getOrCreateFile(document.uri);
        if (result) {
            await result.data.load(document.getText());
        }
    }
}