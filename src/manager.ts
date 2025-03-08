import { CancellationToken, ExtensionContext, GlobPattern, Location, RelativePattern, TestController, TestItem, TestItemCollection, TestMessage, TestRun, TestRunProfileKind, TestRunRequest, tests, TextDocument, TextDocumentChangeEvent, Uri, workspace, WorkspaceFolder } from "vscode";
import { TestFile } from "./testFile";
import { TestCase } from "./testCase";
import * as path from "path";
import { IBMiTestRunner } from "./runner";
import { TestDirectory } from "./testDirectory";

export type IBMiTestData = TestDirectory | TestFile | TestCase;

export class IBMiTestManager {
    public static CONTROLLER_ID = 'ibmiTest';
    public static CONTROLLER_LABEL = 'IBM i Tests';
    public static PROFILE_LABEL = 'Run Tests';
    public static TEST_SUFFIX = '.test';
    public static RPGLE_TEST_SUFFIX = IBMiTestManager.TEST_SUFFIX + '.rpgle';
    public static COBOL_TEST_SUFFIX = IBMiTestManager.TEST_SUFFIX + '.cblle';// TODO: Support RUCRTCBL
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
        this.controller.createRunProfile(IBMiTestManager.PROFILE_LABEL, TestRunProfileKind.Run, async (request: TestRunRequest, token: CancellationToken) => {
            const runner = new IBMiTestRunner(this, request, token);
            await runner.runHandler();
        }, true, undefined, false);

        for (const document of workspace.textDocuments) {
            this.updateNodeForDocument(document);
        }

        // TODO: Need to add onDidCloseTextDocument to handle when members are closed?
        context.subscriptions.push(
            this.controller,
            workspace.onDidOpenTextDocument(async (document: TextDocument) => {
                await this.updateNodeForDocument(document);
            }),
            workspace.onDidChangeTextDocument(async (event: TextDocumentChangeEvent) => {
                await this.updateNodeForDocument(event.document);
            })
        );
    }

    private getWorkspaceTestPatterns(): { workspaceFolder: WorkspaceFolder; pattern: RelativePattern; }[] {
        const workspaceFolders = workspace.workspaceFolders;
        if (!workspaceFolders) {
            return [];
        }

        return workspaceFolders.map((workspaceFolder: WorkspaceFolder) => {
            return {
                workspaceFolder,
                pattern: new RelativePattern(workspaceFolder, `**/*${IBMiTestManager.RPGLE_TEST_SUFFIX}`)
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
                this.controller.items.delete(uri.toString());
            });

            this.findInitialFiles(workspaceTestPattern.pattern);
        }
    }

    private getOrCreateFile(uri: Uri): { item: TestItem; data: TestFile; } | undefined {
        // Check if test item already exists
        const existingItem = this.controller.items.get(uri.toString());
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
                workspaceItem = this.controller.createTestItem(workspaceFolder.uri.toString(), path.parse(workspaceFolder.uri.path).base, uri);
                workspaceItem.canResolveChildren = true;
                this.controller.items.add(workspaceItem);
            }

            // Create directory test items if they do not exist
            let parentItem = workspaceItem;
            const relativePathToTest = path.relative(workspaceFolder.uri.fsPath, path.parse(uri.fsPath).dir);
            const directoryNames = relativePathToTest.split(path.sep).filter((directoryName) => directoryName !== '');
            for (const directoryName of directoryNames) {
                const directoryUri = Uri.joinPath(workspaceFolder.uri, directoryName);
                let directoryItem = this.controller.items.get(directoryUri.toString());
                if (!directoryItem) {
                    directoryItem = this.controller.createTestItem(directoryUri.toString(), directoryName, uri);
                    directoryItem.canResolveChildren = true;
                    parentItem.children.add(directoryItem);
                    parentItem = directoryItem;
                }
            }

            // Create file test item
            const fileItem = this.controller.createTestItem(uri.toString(), path.parse(uri.path).base, uri);
            fileItem.canResolveChildren = true;
            parentItem.children.add(fileItem);

            const data = new TestFile(fileItem);
            this.testData.set(fileItem, data);

            return {
                item: fileItem,
                data: data
            };
        }
    }

    private async updateNodeForDocument(document: TextDocument): Promise<void> {
        if (!['file', 'member'].includes(document.uri.scheme)) {
            return;
        }

        if (!document.uri.path.toLocaleLowerCase().endsWith(IBMiTestManager.RPGLE_TEST_SUFFIX)) {
            return;
        }

        const result = this.getOrCreateFile(document.uri);
        if (result) {
            await result.data.load(document.getText());
        }
    }
}