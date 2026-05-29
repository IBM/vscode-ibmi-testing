import { CancellationToken, Disposable, ExtensionContext, LogLevel, RelativePattern, TestController, TestItem, TestRunProfile, TestRunProfileKind, TestRunRequest, tests, TestTag, TextDocument, TextDocumentChangeEvent, Uri, window, workspace } from "vscode";
import * as path from "path";
import * as fs from "fs";
import { IBMiTestRunner } from "./runner";
import { IBMiFileCoverage } from "./fileCoverage";
import { getInstance } from "./extensions/ibmi";
import { ApiUtils } from "../api/apiUtils";
import { testOutputLogger } from "./extension";
import { TestData, TestFileData } from "./testData";
import { CompileMode, TestingConfig, TestSuitePatterns } from "../api/types";
import { TestRunResult } from "./types";

export class IBMiTestManager {
    public context: ExtensionContext;
    public testMap: WeakMap<TestItem, TestData>;
    public controller: TestController;
    public profiles: TestRunProfile[];
    /** Maps testing.json directory URI string → per-directory file watchers */
    private testingJsonWatchers: Map<string, Disposable[]> = new Map();

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

        this.profiles = [];

        // Profiles for running tests
        ['Run Tests', 'Run Tests (Force Compile)', 'Run Tests (Skip Compile)'].forEach((profile, index) => {
            const compileMode = index === 0 ? 'check' : index === 1 ? 'force' : 'skip';
            const runProfile = this.controller.createRunProfile(profile, TestRunProfileKind.Run, async (request: TestRunRequest, token: CancellationToken) => {
                try {
                    await this.createTestRun(request, token, compileMode);
                } catch (error) { }
            }, index === 0, undefined, false);
            this.profiles.push(runProfile);
        });

        // Profiles for running tests with line coverage
        ['Run Tests with Line Coverage', 'Run Tests with Line Coverage (Force Compile)', 'Run Tests with Line Coverage (Skip Compile)'].forEach((profile, index) => {
            const compileMode = index === 0 ? 'check' : index === 1 ? 'force' : 'skip';
            const lineCoverageProfile = this.controller.createRunProfile(profile, TestRunProfileKind.Coverage, async (request: TestRunRequest, token: CancellationToken) => {
                try {
                    await this.createTestRun(request, token, compileMode);
                } catch (error) { }
            }, index === 0, undefined, false);
            lineCoverageProfile.loadDetailedCoverage = IBMiFileCoverage.loadDetailedCoverage;
            this.profiles.push(lineCoverageProfile);
        });

        // Profiles for running tests with procedure coverage
        ['Run Tests with Procedure Coverage', 'Run Tests with Procedure Coverage (Force Compile)', 'Run Tests with Procedure Coverage (Skip Compile)'].forEach((profile, index) => {
            const compileMode = index === 0 ? 'check' : index === 1 ? 'force' : 'skip';
            const procedureCoverageProfile = this.controller.createRunProfile(profile, TestRunProfileKind.Coverage, async (request: TestRunRequest, token: CancellationToken) => {
                try {
                    await this.createTestRun(request, token, compileMode);
                } catch (error) { }
            }, false, undefined, false);
            procedureCoverageProfile.loadDetailedCoverage = IBMiFileCoverage.loadDetailedCoverage;
            this.profiles.push(procedureCoverageProfile);
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
        // Dispose all per-directory file watchers
        for (const [dirKey] of this.testingJsonWatchers) {
            this.disposeTestingJsonWatchers(dirKey);
        }

        // Remove all existing test items
        this.controller.items.forEach((item) => {
            this.controller.items.delete(item.id);
        });
        this.testMap = new WeakMap<TestItem, TestData>();

        // Reload all test items
        await this.loadInitialTests();
    }

    async loadInitialTests(): Promise<void> {
        // Load local tests from workspace folders via testing.json discovery
        const workspaceFoldersList = workspace.workspaceFolders ?? [];
        for (const workspaceFolder of workspaceFoldersList) {
            await testOutputLogger.log(LogLevel.Info, `Searching for tests in workspace folder: ${workspaceFolder.name}`);
            const testingJsonUris = await workspace.findFiles(new RelativePattern(workspaceFolder, '**/testing.json'));
            for (const testingJsonUri of testingJsonUris) {
                const dirUri = Uri.joinPath(testingJsonUri, '..');
                const patterns = await this.readLocalTestingJsonPatterns(dirUri);
                await testOutputLogger.log(LogLevel.Info, `Found testing.json at ${testingJsonUri.fsPath} with patterns: ${JSON.stringify(patterns)}`);
                await this.loadLocalTestsForDir(dirUri, patterns);
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
        const connection = ibmi!.getConnection()!;

        // Get search parameters for tests in library list
        let libraries: string[] = [];
        const workspaceFolders = workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            for (const workspaceFolder of workspaceFolders) {
                const libraryList = await ibmi!.getLibraryList(connection, workspaceFolder);
                libraries.push(libraryList.currentLibrary, ...libraryList.libraryList);
            }
            libraries = Array.from(new Set(libraries));
        } else {
            const libraryList = await ibmi!.getLibraryList(connection);
            libraries = Array.from(new Set([libraryList.currentLibrary, ...libraryList.libraryList]));
        }
        const testSuffixes = ApiUtils.getTestSuffixes({ rpg: true, cobol: true });
        const qsysExtensions = testSuffixes.qsys.map((suffix) => suffix.slice(1));

        // Load tests from library list
        await testOutputLogger.log(LogLevel.Info, `Searching for tests in library list: ${libraries.join('.LIB, ')}.LIB`);
        const testMembers = await ApiUtils.getMemberList(connection as any, libraries, ['*'], qsysExtensions);
        for (const testMember of testMembers) {
            const memberPath = testMember.asp ?
                path.posix.join(testMember.asp, testMember.library, testMember.file, `${testMember.name}.${testMember.extension}`) :
                path.posix.join(testMember.library, testMember.file, `${testMember.name}.${testMember.extension}`);
            const uri = Uri.from({ scheme: 'member', path: `/${memberPath}` });
            await this.loadFileOrMember(uri, false);
        }
    }

    private async readLocalTestingJsonPatterns(dirUri: Uri): Promise<TestSuitePatterns> {
        const testingJsonPath = path.join(dirUri.fsPath, 'testing.json');
        try {
            const raw = await fs.promises.readFile(testingJsonPath, 'utf-8');
            const testingConfig = JSON.parse(raw) as TestingConfig;
            if (testingConfig.testSuites && Array.isArray(testingConfig.testSuites.include)) {
                return {
                    include: testingConfig.testSuites.include,
                    exclude: Array.isArray(testingConfig.testSuites.exclude) ? testingConfig.testSuites.exclude : []
                };
            }
        } catch (error) {
            // No testing.json or unreadable
        }

        // Fallback to default
        return {
            include: [
                '*.TEST.RPGLE',
                '*.TEST.SQLRPGLE',
                '*.TEST.CBLLE',
                '*.TEST.SQLCBLLE'
            ],
            exclude: []
        };
    }

    private matchesTestSuitePatterns(fileName: string, patterns: TestSuitePatterns): boolean {
        const included = patterns.include.some(p => this.matchesPattern(fileName, p));
        if (!included) {
            return false;
        }

        const excluded = patterns.exclude.some(p => this.matchesPattern(fileName, p));
        return !excluded;
    }

    private matchesPattern(fileName: string, pattern: string): boolean {
        // *.TEST.RPGLE:
        // After escape: *\.TEST\.RPGLE
        // After * → .*: .*\.TEST\.RPGLE
        // Full regex: ^.*\.TEST\.RPGLE$

        const upperFileName = fileName.toUpperCase();
        const upperPattern = pattern.toUpperCase();
        const regex = new RegExp(
            '^' + upperPattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'
        );
        return regex.test(upperFileName);
    }

    private async loadLocalTestsForDir(dirUri: Uri, patterns: TestSuitePatterns): Promise<void> {
        for (const includePattern of patterns.include) {
            const fileUris = await workspace.findFiles(new RelativePattern(dirUri, includePattern));
            for (const uri of fileUris) {
                const fileName = path.basename(uri.fsPath);
                if (!patterns.exclude.some(p => this.matchesPattern(fileName, p))) {
                    await this.loadFileOrMember(uri, false);
                }
            }
        }
    }

    private startWatchingWorkspace(): void {
        const workspaceFolders = workspace.workspaceFolders ?? [];

        for (const workspaceFolder of workspaceFolders) {
            // Watch for testing.json creation / change / deletion in the workspace
            const testingJsonWatcher = workspace.createFileSystemWatcher(
                new RelativePattern(workspaceFolder, '**/testing.json')
            );
            this.context.subscriptions.push(testingJsonWatcher);

            testingJsonWatcher.onDidCreate(async (uri: Uri) => {
                await this.onTestingJsonAdded(uri);
            });
            testingJsonWatcher.onDidChange(async (uri: Uri) => {
                await this.onTestingJsonChanged(uri);
            });
            testingJsonWatcher.onDidDelete(async (uri: Uri) => {
                await this.onTestingJsonDeleted(uri);
            });
        }
    }

    private async onTestingJsonAdded(testingJsonUri: Uri): Promise<void> {
        const dirUri = Uri.joinPath(testingJsonUri, '..');
        const dirKey = dirUri.toString();
        const patterns = await this.readLocalTestingJsonPatterns(dirUri);
        await testOutputLogger.log(LogLevel.Info, `testing.json added at ${testingJsonUri.fsPath}`);

        // Create per-pattern file watchers for this directory
        const disposables: Disposable[] = [];
        for (const includePattern of patterns.include) {
            const watcher = workspace.createFileSystemWatcher(new RelativePattern(dirUri, includePattern));
            watcher.onDidCreate(async (uri: Uri) => { await this.loadFileOrMember(uri, false); });
            watcher.onDidChange(async (uri: Uri) => { await this.loadFileOrMember(uri, true, true); });
            watcher.onDidDelete(async (uri: Uri) => { await this.deleteTestItem(uri); });
            disposables.push(watcher);
        }
        this.testingJsonWatchers.set(dirKey, disposables);

        // Load any already-existing matching test files
        await this.loadLocalTestsForDir(dirUri, patterns);
    }

    private async onTestingJsonChanged(testingJsonUri: Uri): Promise<void> {
        const dirUri = Uri.joinPath(testingJsonUri, '..');
        const dirKey = dirUri.toString();
        await testOutputLogger.log(LogLevel.Info, `testing.json changed at ${testingJsonUri.fsPath}`);

        // Dispose old per-directory watchers
        this.disposeTestingJsonWatchers(dirKey);

        // Remove all test items from this directory
        await this.deleteTestItemsForDir(dirUri);

        // Re-add with new patterns
        await this.onTestingJsonAdded(testingJsonUri);
    }

    private async onTestingJsonDeleted(testingJsonUri: Uri): Promise<void> {
        const dirUri = Uri.joinPath(testingJsonUri, '..');
        const dirKey = dirUri.toString();
        await testOutputLogger.log(LogLevel.Info, `testing.json deleted at ${testingJsonUri.fsPath}`);

        this.disposeTestingJsonWatchers(dirKey);
        await this.deleteTestItemsForDir(dirUri);
    }

    private disposeTestingJsonWatchers(dirKey: string): void {
        const existing = this.testingJsonWatchers.get(dirKey);
        if (existing) {
            existing.forEach(d => d.dispose());
            this.testingJsonWatchers.delete(dirKey);
        }
    }

    /** Remove all file-level test items whose parent directory matches dirUri. */
    private async deleteTestItemsForDir(dirUri: Uri): Promise<void> {
        const allItems = this.getFlattenedTestItems();
        for (const item of allItems) {
            if (item.uri && item.uri.scheme === 'file') {
                const itemDir = Uri.joinPath(item.uri, '..');
                if (itemDir.toString() === dirUri.toString()) {
                    await this.deleteTestItem(item.uri);
                }
            }
        }
    }

    public async getOrCreateFile(uri: Uri): Promise<{ item: TestItem; data: TestData; } | undefined> {
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
                const connection = ibmi!.getConnection()!;

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
        const ibmi = getInstance();
        const connection = ibmi!.getConnection()!;

        if (uri.scheme === 'file') {
            // For local files, the directory must contain a testing.json and the file must
            // match its include/exclude patterns
            const dirUri = Uri.joinPath(uri, '..');
            const patterns = await this.readLocalTestingJsonPatterns(dirUri);
            const testingJsonExists = await fs.promises.stat(path.join(dirUri.fsPath, 'testing.json')).then(() => true, () => false);
            if (!testingJsonExists) {
                return;
            }
            const fileName = path.basename(uri.fsPath);
            if (!this.matchesTestSuitePatterns(fileName, patterns)) {
                return;
            }
        } else if (uri.scheme === 'member') {
            // QSYS suffix check — will be replaced in Sub-Task 6
            const testSuffixes = ApiUtils.getTestSuffixes({ rpg: true, cobol: true });
            if (!testSuffixes.qsys.some(suffix => connection.upperCaseName(uri.path).endsWith(suffix))) {
                return;
            }
        } else {
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

    public async createTestRun(request: TestRunRequest, token: CancellationToken | undefined, compileMode: CompileMode): Promise<TestRunResult> {
        const runner = new IBMiTestRunner(this, request, token, compileMode);
        return await runner.runHandler();
    }
}