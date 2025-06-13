import { CancellationToken, ExtensionContext, LogLevel, RelativePattern, TestController, TestItem, TestRunProfileKind, TestRunRequest, tests, TestTag, TextDocument, TextDocumentChangeEvent, Uri, window, workspace, WorkspaceFolder } from "vscode";
import * as path from "path";
import { IBMiTestRunner } from "./runner";
import { IBMiFileCoverage } from "./fileCoverage";
import { getInstance } from "./extensions/ibmi";
import { ApiUtils } from "./api/apiUtils";
import { Configuration, Section } from "./configuration";
import { testOutputLogger } from "./extension";
import { TestData, TestFileData } from "./testData";

export class IBMiTestManager {
    public context: ExtensionContext;
    public testMap: WeakMap<TestItem, TestData>;
    public controller: TestController;

    constructor(context: ExtensionContext) {
        this.context = context;
        this.testMap = new WeakMap<TestItem, TestData>();
        this.controller = tests.createTestController('IBMi', 'IBM i Testing');
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
        ['Run Tests', 'Run Tests (Compile)'].forEach((profile, index) => {
            const forceCompile = index === 1;
            this.controller.createRunProfile(profile, TestRunProfileKind.Run, async (request: TestRunRequest, token: CancellationToken) => {
                const runner = new IBMiTestRunner(this, request, forceCompile);
                await runner.runHandler();
            }, !forceCompile, undefined, false);
        });

        // Profiles for running tests with line coverage
        ['Run Tests with Line Coverage', 'Run Tests with Line Coverage (Compile)'].forEach((profile, index) => {
            const forceCompile = index === 1;
            const lineCoverageProfile = this.controller.createRunProfile(profile, TestRunProfileKind.Coverage, async (request: TestRunRequest, token: CancellationToken) => {
                const runner = new IBMiTestRunner(this, request, forceCompile);
                await runner.runHandler();
            }, !forceCompile, undefined, false);
            lineCoverageProfile.loadDetailedCoverage = IBMiFileCoverage.loadDetailedCoverage;
        });

        // Profiles for running tests with procedure coverage
        ['Run Tests with Procedure Coverage', 'Run Tests with Procedure Coverage (Compile)'].forEach((profile, index) => {
            const forceCompile = index === 1;
            const procedureCoverageProfile = this.controller.createRunProfile(profile, TestRunProfileKind.Coverage, async (request: TestRunRequest, token: CancellationToken) => {
                const runner = new IBMiTestRunner(this, request, forceCompile);
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

        this.loadInitialTests();
    }

    async refreshTests(): Promise<void> {
        // Remove all existing test items
        this.controller.items.forEach((item) => {
            this.controller.items.delete(item.id);
        });
        this.testMap = new WeakMap<TestItem, TestData>();

        // Reload all test items
        await this.loadInitialTests();
    }

    async loadInitialTests(): Promise<void> {
        // Load local tests from workspace folders
        const workspaceTestPatterns = this.getWorkspaceTestPatterns();
        for await (const workspaceTestPattern of workspaceTestPatterns) {
            await testOutputLogger.log(LogLevel.Info, `Searching for tests in workspace folder: ${workspaceTestPattern.workspaceFolder.name}`);
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

        const ibmi = getInstance();
        const connection = ibmi!.getConnection();

        // Get search parameters for tests in library list
        const workspaceFolders = workspace.workspaceFolders;
        const workspaceFolder = workspaceFolders && workspaceFolders.length > 0 ? workspaceFolders[0] : undefined;
        const libraryList = await ibmi!.getLibraryList(connection, workspaceFolder);
        const libraries: string[] = Array.from(new Set([libraryList.currentLibrary, ...libraryList.libraryList]));
        const testSourceFiles = Configuration.getOrFallback<string[]>(Section.testSourceFiles);
        const testSuffixes = ApiUtils.getTestSuffixes({ rpg: true, cobol: true });
        const qsysExtensions = testSuffixes.qsys.map((suffix) => suffix.slice(1));

        // Load tests from library list
        await testOutputLogger.log(LogLevel.Info, `Searching for tests in library list: ${libraries.join('.LIB, ')}.LIB`);
        const testMembers = await ApiUtils.getMemberList(libraries, testSourceFiles, qsysExtensions);
        for (const testMember of testMembers) {
            const memberPath = testMember.asp ?
                path.posix.join(testMember.asp, testMember.library, testMember.file, `${testMember.name}.${testMember.extension}`) :
                path.posix.join(testMember.library, testMember.file, `${testMember.name}.${testMember.extension}`);
            const uri = Uri.from({ scheme: 'member', path: `/${memberPath}` });
            await this.loadFileOrMember(uri, false);
        }
    }

    private getWorkspaceTestPatterns(): { workspaceFolder: WorkspaceFolder; pattern: RelativePattern; }[] {
        const workspaceFolders = workspace.workspaceFolders;
        if (!workspaceFolders) {
            return [];
        }

        const testSuffixes = ApiUtils.getTestSuffixes({ rpg: true, cobol: true });
        const pattern = testSuffixes.ifs.flatMap(suffix => [suffix, suffix.toLowerCase()]).join(',');

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
            watcher.onDidDelete(async (uri: Uri) => {
                await this.deleteTestItem(uri);
            });
        }
    }

    private async getOrCreateFile(uri: Uri): Promise<{ item: TestItem; data: TestData; } | undefined> {
        // Check if test item already exists
        const allTestItems = this.getFlattenedTestItems();
        const existingItem = allTestItems.find((item) => item.uri!.toString() === uri.toString());
        if (existingItem) {
            const existingData = this.testMap.get(existingItem);
            if (existingData) {
                return {
                    item: existingItem,
                    data: existingData
                };
            }
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
                    workspaceItem = this.createTestItem(workspaceFolder.uri.toString(), workspaceFolder.uri, path.parse(workspaceFolder.uri.path).base);
                    this.controller.items.add(workspaceItem);
                    await testOutputLogger.log(LogLevel.Info, `Created workspace test item for ${workspaceFolder.uri.toString()}`);

                    const workspaceData = new TestData(workspaceItem, 'directory');
                    this.testMap.set(workspaceItem, workspaceData);
                }

                // Create directory test items if they do not exist
                let parentItem = workspaceItem;
                const relativePathToTest = path.relative(workspaceFolder.uri.fsPath, path.parse(uri.fsPath).dir);
                const directoryNames = relativePathToTest.split(path.sep).filter((directoryName) => directoryName !== '');
                for (const directoryName of directoryNames) {
                    const directoryUri = Uri.joinPath(workspaceFolder.uri, directoryName);
                    let directoryItem = parentItem.children.get(directoryUri.toString());
                    if (!directoryItem) {
                        directoryItem = this.createTestItem(directoryUri.toString(), directoryUri, directoryName);
                        parentItem.children.add(directoryItem);
                        await testOutputLogger.log(LogLevel.Info, `Created directory test item for ${directoryUri.toString()}`);

                        const directoryData = new TestData(directoryItem, 'directory');
                        this.testMap.set(directoryItem, directoryData);
                    }

                    parentItem = directoryItem;
                }

                // Create file test item
                const fileItem = this.createTestItem(uri.toString(), uri, path.parse(uri.path).base);
                parentItem.children.add(fileItem);
                await testOutputLogger.log(LogLevel.Info, `Created file test item for ${uri.toString()}`);

                const fileData = new TestFileData(fileItem, workspaceItem);
                this.testMap.set(fileItem, fileData);

                return {
                    item: fileItem,
                    data: fileData
                };
            } else if (uri.scheme === 'member') {
                const ibmi = getInstance();
                const connection = ibmi!.getConnection();

                const parsedPath = connection.parserMemberPath(uri.path);

                // Create ASP test item if it does not exist
                let aspItem: TestItem | undefined;
                if (parsedPath.asp) {
                    const aspUri = Uri.from({ scheme: 'object', path: path.format({ name: parsedPath.asp }) });
                    aspItem = this.controller.items.get(aspUri.toString());
                    if (!aspItem) {
                        aspItem = this.createTestItem(aspUri.toString(), aspUri, path.parse(aspUri.path).base);
                        this.controller.items.add(aspItem);
                        await testOutputLogger.log(LogLevel.Info, `Created ASP test item for ${aspUri.toString()}`);

                        const aspData = new TestData(aspItem, 'object');
                        this.testMap.set(aspItem, aspData);
                    }
                }

                // Create library test item if it does not exist
                const libraryUri = Uri.from({ scheme: 'object', path: path.posix.join(parsedPath.asp || '/', parsedPath.library) });
                let libraryItem = aspItem ? aspItem.children.get(libraryUri.toString()) : this.controller.items.get(libraryUri.toString());
                if (!libraryItem) {
                    libraryItem = this.createTestItem(libraryUri.toString(), libraryUri, path.parse(libraryUri.path).base);
                    if (aspItem) {
                        aspItem.children.add(libraryItem);
                    } else {
                        this.controller.items.add(libraryItem);
                    }
                    await testOutputLogger.log(LogLevel.Info, `Created library test item for ${libraryUri.toString()}`);

                    const libraryData = new TestData(libraryItem, 'object');
                    this.testMap.set(libraryItem, libraryData);
                }

                // Create object test item if it does not exist
                const objectUri = Uri.from({ scheme: 'object', path: path.posix.join(parsedPath.asp || '/', parsedPath.library, parsedPath.file) });
                let objectItem = libraryItem.children.get(objectUri.toString());
                if (!objectItem) {
                    objectItem = this.createTestItem(objectUri.toString(), objectUri, path.parse(objectUri.path).base);
                    libraryItem.children.add(objectItem);
                    await testOutputLogger.log(LogLevel.Info, `Created object test item for ${objectUri.toString()}`);

                    const objectData = new TestData(objectItem, 'object');
                    this.testMap.set(objectItem, objectData);
                }

                // Create member test item
                const memberItem = this.createTestItem(uri.toString(), uri, path.posix.parse(uri.path).base);
                objectItem.children.add(memberItem);
                await testOutputLogger.log(LogLevel.Info, `Created member test item for ${uri.toString()}`);

                const memberData = new TestFileData(memberItem, aspItem || libraryItem);
                this.testMap.set(memberItem, memberData);

                return {
                    item: memberItem,
                    data: memberData
                };
            }
        }
    }

    public createTestItem(id: string, uri: Uri, label: string, canResolveChildren: boolean = true): TestItem {
        const testItem = this.controller.createTestItem(id, label, uri);
        testItem.canResolveChildren = canResolveChildren;

        const isLocal = uri.scheme === 'file';
        const tagId = isLocal ? 'local' : 'qsys';
        testItem.tags = [new TestTag(tagId)];

        return testItem;
    }

    private async deleteTestItem(uri: Uri) {
        const allTestItems = this.getFlattenedTestItems();
        const deletedItem = allTestItems.find((item) => item.uri?.toString() === uri.toString());

        if (!deletedItem) {
            // File not found in test collection
            return;
        }

        // Delete item associated with the file
        let parentItem = deletedItem.parent;
        parentItem?.children.delete(deletedItem.id);
        this.testMap.delete(deletedItem);
        await testOutputLogger.log(LogLevel.Info, `Deleted file test item for ${uri.toString()}`);

        // Recursively delete empty parents
        while (parentItem && parentItem.children.size === 0) {

            const grandParentItem = parentItem.parent;
            if (!grandParentItem) {
                // Delete workspace item when no grandparent
                this.controller.items.delete(parentItem.id);
                this.testMap.delete(parentItem);

                const rootType = parentItem.uri?.scheme === 'file' ? 'workspace' : 'object';
                await testOutputLogger.log(LogLevel.Info, `Deleted ${rootType} test item for ${parentItem.uri?.toString()}`);
                break;
            }

            grandParentItem.children.delete(parentItem.id);
            this.testMap.delete(parentItem);
            parentItem = grandParentItem;
            const intermediateType = parentItem.uri?.scheme === 'file' ? 'directory' : 'object';
            await testOutputLogger.log(LogLevel.Info, `Deleted ${intermediateType} test item for ${parentItem.uri?.toString()}`);
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
        const testSuffixes = ApiUtils.getTestSuffixes({ rpg: true, cobol: true });
        let uriSpecificSuffixes: string[];
        if (uri.scheme === 'file') {
            uriSpecificSuffixes = testSuffixes.ifs;
        } else if (uri.scheme === 'member') {
            uriSpecificSuffixes = testSuffixes.qsys;
        } else {
            return;
        }

        // Check if the URI ends with any of the uri specific suffixes
        if (!uriSpecificSuffixes.some(suffix => uri.path.toLocaleUpperCase().endsWith(suffix))) {
            return;
        }

        const result = await this.getOrCreateFile(uri);
        if (result && result.data instanceof TestFileData) {
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