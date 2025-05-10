import { CancellationToken, ExtensionContext, FileCoverage, LogLevel, RelativePattern, TestController, TestItem, TestRun, TestRunProfileKind, TestRunRequest, tests, TestTag, TextDocument, TextDocumentChangeEvent, Uri, window, workspace, WorkspaceFolder } from "vscode";
import { TestFile } from "./testFile";
import * as path from "path";
import { IBMiTestRunner } from "./runner";
import { TestDirectory } from "./testDirectory";
import { Logger } from "./logger";
import { IBMiFileCoverage } from "./fileCoverage";
import { IBMiTestStorage } from "./storage";
import { CodeCoverage } from "./codeCoverage";
import { TestObject } from "./testObject";
import { getInstance } from "./extensions/ibmi";
import { IBMiTestData } from "./types";
import { Utils } from "./utils";
import { Configuration, Section } from "./configuration";

export class IBMiTestManager {
    public static CONTROLLER_ID = 'IBMi';
    public static CONTROLLER_LABEL = 'IBM i Testing';
    public static RUN_PROFILE_LABEL = 'Run Tests';
    public static COMPILE_AND_RUN_PROFILE_LABEL = 'Run Tests (Compile)';
    public static LINE_COVERAGE_PROFILE_LABEL = 'Run Tests with Line Coverage';
    public static COMPILE_AND_LINE_COVERAGE_PROFILE_LABEL = 'Run Tests with Line Coverage (Compile)';
    public static PROCEDURE_COVERAGE_PROFILE_LABEL = 'Run Tests with Procedure Coverage';
    public static COMPILE_AND_PROCEDURE_COVERAGE_PROFILE_LABEL = 'Run Tests with Procedure Coverage (Compile)';
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

            await this.loadFileOrMember(item.uri!, true);
        };
        this.controller.refreshHandler = async () => {
            await this.refreshTests();
        };

        // Profiles for running tests
        [IBMiTestManager.RUN_PROFILE_LABEL, IBMiTestManager.COMPILE_AND_RUN_PROFILE_LABEL].forEach((profile, index) => {
            const forceCompile = index === 1;
            this.controller.createRunProfile(profile, TestRunProfileKind.Run, async (request: TestRunRequest, token: CancellationToken) => {
                const runner = new IBMiTestRunner(this, request, forceCompile, token);
                await runner.runHandler();
            }, !forceCompile, undefined, false);
        });

        // Profiles for running tests with line coverage
        [IBMiTestManager.LINE_COVERAGE_PROFILE_LABEL, IBMiTestManager.COMPILE_AND_LINE_COVERAGE_PROFILE_LABEL].forEach((profile, index) => {
            const forceCompile = index === 1;
            const lineCoverageProfile = this.controller.createRunProfile(profile, TestRunProfileKind.Coverage, async (request: TestRunRequest, token: CancellationToken) => {
                const runner = new IBMiTestRunner(this, request, forceCompile, token);
                await runner.runHandler();
            }, !forceCompile, undefined, false);
            lineCoverageProfile.loadDetailedCoverage = IBMiFileCoverage.loadDetailedCoverage;
        });

        // Profiles for running tests with procedure coverage
        [IBMiTestManager.PROCEDURE_COVERAGE_PROFILE_LABEL, IBMiTestManager.COMPILE_AND_PROCEDURE_COVERAGE_PROFILE_LABEL].forEach((profile, index) => {
            const forceCompile = index === 1;
            const procedureCoverageProfile = this.controller.createRunProfile(profile, TestRunProfileKind.Coverage, async (request: TestRunRequest, token: CancellationToken) => {
                const runner = new IBMiTestRunner(this, request, forceCompile, token);
                await runner.runHandler();
            }, false, undefined, false);
            procedureCoverageProfile.loadDetailedCoverage = IBMiFileCoverage.loadDetailedCoverage;
        });

        context.subscriptions.push(
            this.controller,
            workspace.onDidOpenTextDocument(async (document: TextDocument) => {
                const uri = document.uri;
                await this.loadFileOrMember(uri, true);
            }),
            workspace.onDidChangeTextDocument(async (event: TextDocumentChangeEvent) => {
                const uri = event.document.uri;
                await this.loadFileOrMember(uri, true, true);
            })
        );

        IBMiTestStorage.setupTestStorage();
        CodeCoverage.setupCodeCoverage();
        this.loadInitialTests();
    }

    async refreshTests(): Promise<void> {
        // Remove all existing test items
        this.controller.items.forEach((item) => {
            this.controller.items.delete(item.id);
        });
        this.testData = new WeakMap<TestItem, IBMiTestData>();

        // Reload all test items
        await this.loadInitialTests();
    }

    async loadInitialTests(): Promise<void> {
        // Load local tests from workspace folders
        const workspaceTestPatterns = this.getWorkspaceTestPatterns();
        for await (const workspaceTestPattern of workspaceTestPatterns) {
            Logger.log(LogLevel.Info, `Searching for tests in workspace folder: ${workspaceTestPattern.workspaceFolder.name}`);
            const fileUris = await workspace.findFiles(workspaceTestPattern.pattern);
            for (const uri of fileUris) {
                await this.loadFileOrMember(uri, false);
            }
        }

        // Fully load test cases for opened documents
        const visibleTextEditors = window.visibleTextEditors;
        for await (const document of workspace.textDocuments) {
            const isVisible = visibleTextEditors.some((editor) => editor.document.uri.toString() === document.uri.toString());
            if (isVisible) {
                const uri = document.uri;
                await this.loadFileOrMember(uri, true);
            }
        }

        const testSuffixes = Utils.getTestSuffixes({ rpg: true, cobol: true });

        const ibmi = getInstance();
        const connection = ibmi!.getConnection();
        const content = connection.getContent();

        // Load tests from library list
        const workspaceFolders = workspace.workspaceFolders;
        const workspaceFolder = workspaceFolders && workspaceFolders.length > 0 ? workspaceFolders[0] : undefined;
        const libraryList = await ibmi!.getLibraryList(connection, workspaceFolder);
        const testSourceFiles = Configuration.getOrFallback<string[]>(Section.testSourceFiles);
        const libraries: string[] = Array.from(new Set([libraryList.currentLibrary, ...libraryList.libraryList]));
        Logger.log(LogLevel.Info, `Searching for tests in library list: ${libraries.join('.LIB, ')}.LIB`);
        for await (const library of libraries) {
            for await (const testSourceFile of testSourceFiles) {
                const testMembers = await content.getMemberList({
                    library: library,
                    sourceFile: testSourceFile,
                    extensions: testSuffixes.remote.map((suffix) => suffix.slice(1)).join(','),
                    filterType: 'simple',
                    sort: { order: 'name' }
                });

                for (const testMember of testMembers) {
                    const memberPath = testMember.asp ?
                        path.posix.join(testMember.asp, testMember.library, testMember.file, `${testMember.name}.${testMember.extension}`) :
                        path.posix.join(testMember.library, testMember.file, `${testMember.name}.${testMember.extension}`);
                    const uri = Uri.from({ scheme: 'member', path: `/${memberPath}` });
                    await this.loadFileOrMember(uri, false);
                }
            }
        }
    }

    private getWorkspaceTestPatterns(): { workspaceFolder: WorkspaceFolder; pattern: RelativePattern; }[] {
        const workspaceFolders = workspace.workspaceFolders;
        if (!workspaceFolders) {
            return [];
        }

        const testSuffixes = Utils.getTestSuffixes({ rpg: true, cobol: true });
        const pattern = testSuffixes.local.flatMap(suffix => [suffix, suffix.toLowerCase()]).join(',');

        return workspaceFolders.map((workspaceFolder: WorkspaceFolder) => {
            return {
                workspaceFolder,
                pattern: new RelativePattern(workspaceFolder, `**/*{${pattern}}`)
            };
        });
    }

    private startWatchingWorkspace(): void {
        const workspaceTestPatterns = this.getWorkspaceTestPatterns();

        for (const workspaceTestPattern of workspaceTestPatterns) {
            const watcher = workspace.createFileSystemWatcher(workspaceTestPattern.pattern);
            this.context.subscriptions.push(watcher);

            watcher.onDidCreate(async (uri: Uri) => {
                await this.loadFileOrMember(uri, false);
            });
            // TODO: Handle remote source member changes
            watcher.onDidChange(async (uri: Uri) => {
                await this.loadFileOrMember(uri, true, true);
            });
            watcher.onDidDelete((uri: Uri) => {
                this.deleteTestItem(uri);
            });
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
            if (uri.scheme === 'file') {
                // Get workspace folder for the file
                const workspaceFolder = workspace.getWorkspaceFolder(uri);
                if (!workspaceFolder) {
                    return;
                }

                // Create workspace test item if it does not exist
                let workspaceItem = this.controller.items.get(workspaceFolder.uri.toString());
                if (!workspaceItem) {
                    workspaceItem = this.createTestItem(workspaceFolder.uri, path.parse(workspaceFolder.uri.path).base, true);
                    this.controller.items.add(workspaceItem);
                    Logger.log(LogLevel.Info, `Created workspace test item for ${workspaceFolder.uri.toString()}`);

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
                        directoryItem = this.createTestItem(directoryUri, directoryName, true);
                        parentItem.children.add(directoryItem);
                        Logger.log(LogLevel.Info, `Created directory test item for ${directoryUri.toString()}`);

                        const data = new TestDirectory(directoryItem);
                        this.testData.set(directoryItem, data);
                    }

                    parentItem = directoryItem;
                }

                // Create file test item
                const fileItem = this.createTestItem(uri, path.parse(uri.path).base, true);
                parentItem.children.add(fileItem);
                Logger.log(LogLevel.Info, `Created file test item for ${uri.toString()}`);

                const data = new TestFile(fileItem, { workspaceItem });
                this.testData.set(fileItem, data);

                return {
                    item: fileItem,
                    data: data
                };
            } else if (uri.scheme === 'member') {
                let partPath: string = '';
                let parentPartItem: TestItem | undefined;
                let libraryItem: TestItem | undefined;
                const parts = uri.path.split('/');
                for (let index = 0; index < parts.length; index++) {
                    const part = parts[index];
                    if (part !== '') {
                        const isMember = (index === parts.length - 1);

                        // Construct uri
                        partPath += '/' + part;
                        const partUri = isMember ? uri : Uri.from({ scheme: 'object', path: partPath });

                        // Create test item for part
                        let partItem = parentPartItem ?
                            parentPartItem.children.get(partUri.toString()) :
                            this.controller.items.get(partUri.toString());
                        if (!partItem) {
                            partItem = this.createTestItem(partUri, part, false);
                            if (parentPartItem) {
                                parentPartItem.children.add(partItem);
                            } else {
                                this.controller.items.add(partItem);
                            }
                            parentPartItem = partItem;

                            if (isMember) {
                                Logger.log(LogLevel.Info, `Created member test item for ${partUri.toString()}`);

                                const data = new TestFile(partItem, { libraryItem: libraryItem });
                                this.testData.set(partItem, data);

                                return {
                                    item: partItem,
                                    data: data
                                };
                            } else {
                                Logger.log(LogLevel.Info, `Created object test item for ${partUri.toString()}`);
                                const data = new TestObject(partItem);
                                this.testData.set(partItem, data);

                                if (!libraryItem) {
                                    libraryItem = partItem;
                                }
                            }
                        } else {
                            parentPartItem = partItem;
                        }
                    }
                }
            }
        }
    }

    private createTestItem(uri: Uri, label: string, isLocal: boolean): TestItem {
        const testItem = this.controller.createTestItem(uri.toString(), label, uri);
        testItem.canResolveChildren = true;

        if (isLocal) {
            testItem.tags = [new TestTag('local')];
        } else {
            testItem.tags = [new TestTag('members')];
        }

        return testItem;
    }

    private deleteTestItem(uri: Uri) {
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
        Logger.log(LogLevel.Info, `Deleted file test item for ${uri.toString()}`);

        // Recursively delete empty parents
        while (parentItem && parentItem.children.size === 0) {

            const grandParentItem = parentItem.parent;
            if (!grandParentItem) {
                // Delete workspace item when no grandparent
                this.controller.items.delete(parentItem.id);
                this.testData.delete(parentItem);

                const rootType = parentItem.uri?.scheme === 'file' ? 'workspace' : 'object';
                Logger.log(LogLevel.Info, `Deleted ${rootType} test item for ${parentItem.uri?.toString()}`);
                break;
            }

            grandParentItem.children.delete(parentItem.id);
            this.testData.delete(parentItem);
            parentItem = grandParentItem;
            const intermediateType = parentItem.uri?.scheme === 'file' ? 'directory' : 'object';
            Logger.log(LogLevel.Info, `Deleted ${intermediateType} test item for ${parentItem.uri?.toString()}`);
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


    private async loadFileOrMember(uri: Uri, loadTestCases: boolean, isChanged: boolean = false): Promise<void> {
        // Get test suffixes based on the URI scheme
        const testSuffixes = Utils.getTestSuffixes({ rpg: true, cobol: true });
        let uriSpecificSuffixes: string[];
        if (uri.scheme === 'file') {
            uriSpecificSuffixes = testSuffixes.local;
        } else if (uri.scheme === 'member') {
            uriSpecificSuffixes = testSuffixes.remote;
        } else {
            return;
        }

        // Check if the URI ends with any of the uri specific suffixes
        if (!uriSpecificSuffixes.some(suffix => uri.path.toLocaleUpperCase().endsWith(suffix))) {
            return;
        }

        const result = this.getOrCreateFile(uri);
        if (result) {
            if (isChanged) {
                result.data.isLoaded = false;
                result.data.isCompiled = false;
            }

            if (loadTestCases) {
                await result.data.load();
            }
        }
    }
}