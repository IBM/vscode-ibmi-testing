import { CancellationToken, ExtensionContext, GlobPattern, Location, RelativePattern, TestController, TestItem, TestItemCollection, TestMessage, TestRun, TestRunProfileKind, TestRunRequest, tests, TextDocument, TextDocumentChangeEvent, Uri, workspace, WorkspaceFolder } from "vscode";
import { TestFile } from "./testFile";
import { TestCase } from "./testCase";
import * as path from "path";
import { IBMiTestRunner } from "./runner";

export type IBMiTestData = TestFile | TestCase;

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
            workspace.onDidOpenTextDocument((document: TextDocument) => {
                this.updateNodeForDocument(document);
            }),
            workspace.onDidChangeTextDocument((event: TextDocumentChangeEvent) => {
                this.updateNodeForDocument(event.document);
            })
        );
    }

    private getWorkspaceTestPatterns() {
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

    private async findInitialFiles(pattern: GlobPattern) {
        const fileUris = await workspace.findFiles(pattern);
        for (const uri of fileUris) {
            this.getOrCreateFile(uri);
        }
    }

    private startWatchingWorkspace() {
        const workspaceTestPatterns = this.getWorkspaceTestPatterns();

        for (const workspaceTestPattern of workspaceTestPatterns) {
            const watcher = workspace.createFileSystemWatcher(workspaceTestPattern.pattern);
            this.context.subscriptions.push(watcher);

            watcher.onDidCreate((uri: Uri) => {
                this.getOrCreateFile(uri);
            });
            watcher.onDidChange(async (uri: Uri) => {
                const { item, data } = this.getOrCreateFile(uri);
                if (data.didLoad) {
                    await data.load();
                    data.didCompile = false;
                }
            });
            watcher.onDidDelete((uri: Uri) => {
                this.controller.items.delete(uri.toString());
            });

            this.findInitialFiles(workspaceTestPattern.pattern);
        }
    }

    private getOrCreateFile(uri: Uri) {
        const existingItem = this.controller.items.get(uri.toString());
        if (existingItem) {
            return {
                item: existingItem,
                data: this.testData.get(existingItem) as TestFile
            };
        }

        const item = this.controller.createTestItem(uri.toString(), path.parse(uri.path).base, uri);
        item.canResolveChildren = true;
        this.controller.items.add(item);

        const data = new TestFile(item);
        this.testData.set(item, data);

        return {
            item,
            data
        };
    }

    private updateNodeForDocument(document: TextDocument) {
        if (!['file', 'member'].includes(document.uri.scheme)) {
            return;
        }

        if (!document.uri.path.toLocaleLowerCase().endsWith(IBMiTestManager.RPGLE_TEST_SUFFIX)) {
            return;
        }

        const { item, data } = this.getOrCreateFile(document.uri);
        data.load(document.getText());
    }
}