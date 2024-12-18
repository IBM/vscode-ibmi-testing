import { CancellationToken, ExtensionContext, GlobPattern, RelativePattern, TestController, TestItem, TestItemCollection, TestRunProfileKind, TestRunRequest, tests, TextDocument, TextDocumentChangeEvent, Uri, workspace, WorkspaceFolder } from "vscode";
import { TestFile } from "./testFile";
import { TestCase } from "./testCase";

export type IBMiTestData = TestFile | TestCase;

export class IBMiTestManager {
    private static CONTROLLER_ID = 'ibmiTest';
    private static CONTROLLER_LABEL = 'IBM i Tests';
    private static PROFILE_LABEL = 'Run Tests';
    private static PATTERN_EXTENSION = '.test.rpgle';

    private context: ExtensionContext;
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
                await data.loadTestCases(this, item);
            }
        };
        this.controller.refreshHandler = async () => {
            const workspaceTestPatterns = this.getWorkspaceTestPatterns();
            for await (const workspaceTestPattern of workspaceTestPatterns) {
                await this.findInitialFiles(workspaceTestPattern.pattern);
            }
        };
        this.controller.createRunProfile(IBMiTestManager.PROFILE_LABEL, TestRunProfileKind.Run, async (request: TestRunRequest, token: CancellationToken) => {
            await this.runHandler(request, token);
        }, true, undefined, false);

        for (const document of workspace.textDocuments) {
            this.updateNodeForDocument(document);
        }

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
                pattern: new RelativePattern(workspaceFolder, `**/*${IBMiTestManager.PATTERN_EXTENSION}`)
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
                if (data.didLoadTestCases) {
                    await data.loadTestCases(this, item);
                }
            });
            watcher.onDidDelete((uri: Uri) => {
                this.controller.items.delete(uri.toString());
            });

            this.findInitialFiles(workspaceTestPattern.pattern);
        }
    }

    private updateNodeForDocument(document: TextDocument) {
        if (document.uri.scheme !== 'file') {
            return;
        }

        if (!document.uri.path.endsWith(IBMiTestManager.PATTERN_EXTENSION)) {
            return;
        }

        const { item, data } = this.getOrCreateFile(document.uri);
        data.loadTestCases(this, item);
    }

    private getOrCreateFile(uri: Uri) {
        const existingItem = this.controller.items.get(uri.toString());
        if (existingItem) {
            return {
                item: existingItem,
                data: this.testData.get(existingItem) as TestFile
            };
        }

        const item = this.controller.createTestItem(uri.toString(), uri.path.split('/').pop()!, uri);
        item.canResolveChildren = true;
        this.controller.items.add(item);

        const data = new TestFile();
        this.testData.set(item, data);

        return {
            item,
            data
        };
    }

    private async runHandler(request: TestRunRequest, token: CancellationToken) {
        const queue: { item: TestItem, data: TestCase }[] = [];
        const run = this.controller.createTestRun(request);

        const discoverTests = async (items: Iterable<TestItem>) => {
            for (const item of items) {
                if (request.exclude?.includes(item)) {
                    continue;
                }

                const data = this.testData.get(item);
                if (data instanceof TestCase) {
                    run.enqueued(item);
                    queue.push({ item, data });
                } else {
                    if (data instanceof TestFile && !data.didLoadTestCases) {
                        await data.loadTestCases(this, item);
                    }

                    await discoverTests(this.gatherTestItems(item.children));
                }
            }
        };

        await discoverTests(request.include ?? this.gatherTestItems(this.controller.items));

        for (const { item, data } of queue) {
            run.appendOutput(`Running ${item.id}\r\n`);

            if (run.token.isCancellationRequested) {
                run.skipped(item);
            } else {
                run.started(item);
                await data.run(item, run);
            }

            run.appendOutput(`Completed ${item.id}\r\n`);
        }
        run.end();
    }

    private gatherTestItems(collection: TestItemCollection) {
        const items: TestItem[] = [];
        collection.forEach((item) => {
            items.push(item);
        });

        return items;
    }
}