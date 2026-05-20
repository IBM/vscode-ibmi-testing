import { TestItem, Uri, Range, Position, TestTag, Location, SymbolKind } from "vscode";
import { TestData, TestFileData, TestCaseData, TestType } from "./testData";

// Define a minimal mock TestItemCollection
class MockTestItemCollection {
    private items: Map<string, TestItem> = new Map();

    get size(): number {
        return this.items.size;
    }

    add(item: TestItem): void {
        this.items.set(item.id, item);
    }

    delete(id: string): boolean {
        return this.items.delete(id);
    }

    forEach(callback: (item: TestItem, id: string) => void): void {
        this.items.forEach((item, id) => callback(item, id));
    }

    get(id: string): TestItem | undefined {
        return this.items.get(id);
    }

    replace(items: TestItem[]): void {
        this.items.clear();
        items.forEach(item => this.add(item));
    }
}

// Mock the required dependencies
jest.mock("./extension", () => ({
    testOutputLogger: {
        log: jest.fn()
    },
    manager: {
        createTestItem: jest.fn(),
        testMap: {
            set: jest.fn()
        }
    }
}));

// Mock the entire VSCode module to handle commands
jest.mock("vscode", () => ({
    ...jest.requireActual("vscode"),
    commands: {
        executeCommand: jest.fn()
    },
    Range: jest.fn().mockImplementation((start, end) => ({ start, end })),
    Position: jest.fn().mockImplementation((line, character) => ({ line, character })),
    SymbolKind: {
        Class: 5 // This should match the actual value in VSCode
    }
}));

jest.mock("../api/apiUtils", () => ({
    ApiUtils: {
        isRPGLE: jest.fn(),
        readMember: jest.fn()
    }
}));

jest.mock("./extensions/ibmi", () => {
    const mockConnection = {
        parserMemberPath: jest.fn()
    };

    const mockIbmi = {
        getConnection: jest.fn(() => mockConnection)
    };

    return {
        getInstance: jest.fn(() => mockIbmi)
    };
});

jest.mock("fs", () => ({
    readFileSync: jest.fn()
}));

jest.mock("vscode-rpgle/language/parser", () => ({
    default: jest.fn(() => ({
        getDocs: jest.fn()
    }))
}));

describe('TestData', () => {
    let mockTestItem: TestItem;

    beforeEach(() => {
        mockTestItem = {
            uri: undefined,
            label: 'test-item',
            id: 'test-id',
            children: new MockTestItemCollection() as any,
            canResolveChildren: false,
            range: undefined,
            description: undefined,
            sortText: undefined,
            tags: [],
            parent: undefined,
            busy: false,
            error: undefined
        } as any as TestItem;
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('TestData', () => {
        it('should create an instance with the correct properties', () => {
            const type: TestType = 'file';
            const data = new TestData(mockTestItem, type);

            expect(data.item).toBe(mockTestItem);
            expect(data.type).toBe(type);
        });
    });

    describe('TestFileData', () => {
        let rootItem: TestItem;

        beforeEach(() => {
            rootItem = {
                uri: Uri.parse('file:///root/test.pgm'),
                label: 'root-item',
                id: 'root-id',
                children: new MockTestItemCollection() as any,
                canResolveChildren: false,
                range: undefined,
                description: undefined,
                sortText: undefined,
                tags: [],
                parent: undefined,
                busy: false,
                error: undefined
            } as any as TestItem;
        });

        it('should create an instance with the correct properties', () => {
            const fileData = new TestFileData(mockTestItem, rootItem);

            expect(fileData.item).toBe(mockTestItem);
            expect(fileData.type).toBe('file');
            expect(fileData.rootItem).toBe(rootItem);
            expect(fileData.isLoaded).toBe(false);
            expect(fileData.isCompiled).toBe(false);
        });

        it('should initialize with isLoaded and isCompiled as false', () => {
            const fileData = new TestFileData(mockTestItem, rootItem);

            expect(fileData.isLoaded).toBe(false);
            expect(fileData.isCompiled).toBe(false);
        });

        it('should load test procedures for RPGLE files', async () => {
            // Create a new mock test item with URI
            const mockRpgleTestItem = {
                uri: {
                    fsPath: '/path/test.rpgle',
                    scheme: 'file',
                    path: '/path/test.rpgle',
                    toString: () => 'file:///path/test.rpgle',
                    with: jest.fn().mockReturnValue({ fsPath: '/path/test.rpgle#fragment', path: '/path/test.rpgle#fragment' }),
                    fragment: ''
                },
                label: 'test-item',
                id: 'test-id',
                children: new MockTestItemCollection() as any,
                canResolveChildren: false,
                range: undefined,
                description: undefined,
                sortText: undefined,
                tags: [],
                parent: undefined,
                busy: false,
                error: undefined
            } as any as TestItem;

            const fileData = new TestFileData(mockRpgleTestItem, rootItem);

            // Mock ApiUtils.isRPGLE to return true
            const { ApiUtils } = require("../api/apiUtils");
            ApiUtils.isRPGLE.mockReturnValue(true);

            // Clear any previous mock calls
            const fs = require("fs");
            fs.readFileSync.mockClear();

            // Mock fs.readFileSync to return sample RPGLE content
            fs.readFileSync.mockReturnValue(`
     H* Test Program
     D TestProc       PR
     P TestProc       B                   Export
     P* Test Procedure Implementation
     P TestProc       E

     P TESTCASE1      B                   Export
     D TESTCASE1      PI
     P
     P* Test Case 1 Implementation
     P TESTCASE1      E

     P TESTCASE2      B                   Export
     D TESTCASE2      PI
     P
     P* Test Case 2 Implementation
     P TESTCASE2      E
            `);

            // Mock the parser to return procedure info
            const ParserMock = require("vscode-rpgle/language/parser").default;
            ParserMock.mockImplementation(() => ({
                getDocs: jest.fn().mockResolvedValue({
                    procedures: [
                        {
                            name: 'TESTCASE1',
                            range: { start: 10, end: 15 }
                        },
                        {
                            name: 'TESTCASE2',
                            range: { start: 18, end: 23 }
                        },
                        {
                            name: 'NORMALPROC',
                            range: { start: 5, end: 9 }
                        }
                    ]
                })
            }));

            // Mock manager.createTestItem
            const { manager } = require("./extension");
            const mockChildItem = {
                uri: Uri.parse('file:///path/test.rpgle#fragment'),
                label: 'test-label',
                id: 'child-id',
                canResolveChildren: false,
                range: new Range(new Position(0, 0), new Position(0, 0)),
                children: new MockTestItemCollection() as any,
                description: undefined,
                sortText: undefined,
                tags: [],
                parent: undefined,
                busy: false,
                error: undefined
            } as any as TestItem;
            manager.createTestItem.mockReturnValue(mockChildItem);

            await fileData.load();

            expect(fileData.isLoaded).toBe(true);
            // Check that fs.readFileSync was called for local file URIs
            expect(fs.readFileSync).toHaveBeenCalledWith('/path/test.rpgle', 'utf8');
            expect(manager.createTestItem).toHaveBeenCalledTimes(2); // Only TESTCASE1 and TESTCASE2 should be matched
        });

        it('should load test procedures for COBOL files', async () => {
            // Create a new mock test item with URI
            const mockCobolTestItem = {
                uri: {
                    fsPath: '/path/test.cbl',
                    scheme: 'file',
                    path: '/path/test.cbl',
                    toString: () => 'file:///path/test.cbl',
                    with: jest.fn().mockReturnValue({ fsPath: '/path/test.cbl#fragment', path: '/path/test.cbl#fragment' }),
                    fragment: ''
                },
                label: 'test-item',
                id: 'test-id',
                children: new MockTestItemCollection() as any,
                canResolveChildren: false,
                range: undefined,
                description: undefined,
                sortText: undefined,
                tags: [],
                parent: undefined,
                busy: false,
                error: undefined
            } as any as TestItem;

            const fileData = new TestFileData(mockCobolTestItem, rootItem);

            // Mock ApiUtils.isRPGLE to return false for COBOL
            const { ApiUtils } = require("../api/apiUtils");
            ApiUtils.isRPGLE.mockReturnValue(false);

            // Clear any previous mock calls
            const { manager } = require("./extension");
            manager.createTestItem.mockClear();

            // Mock the commands.executeCommand properly
            const { commands } = require("vscode");
            const mockExecuteCommand = jest.fn().mockResolvedValue([
                {
                    name: 'PROGRAM-ID. TESTCASE1',
                    kind: require("vscode").SymbolKind.Class,
                    range: new Range(new Position(0, 0), new Position(10, 0))
                },
                {
                    name: 'PROGRAM-ID. TESTCASE2',
                    kind: require("vscode").SymbolKind.Class,
                    range: new Range(new Position(11, 0), new Position(20, 0))
                },
                {
                    name: 'PROGRAM-ID. NORMALPROGRAM',
                    kind: require("vscode").SymbolKind.Class,
                    range: new Range(new Position(21, 0), new Position(30, 0))
                }
            ]);

            jest.spyOn(commands, 'executeCommand')
              .mockImplementation((...args) => mockExecuteCommand(...args));

            // Mock manager.createTestItem
            const mockChildItem = {
                uri: Uri.parse('file:///path/test.cbl#fragment'),
                label: 'test-label',
                id: 'child-id',
                canResolveChildren: false,
                range: new Range(new Position(0, 0), new Position(0, 0)),
                children: new MockTestItemCollection() as any,
                description: undefined,
                sortText: undefined,
                tags: [],
                parent: undefined,
                busy: false,
                error: undefined
            } as any as TestItem;
            manager.createTestItem.mockReturnValue(mockChildItem);

            await fileData.load();

            expect(fileData.isLoaded).toBe(true);
            expect(manager.createTestItem).toHaveBeenCalledTimes(2); // Only TESTCASE1 and TESTCASE2 should be matched
        });

        it('should not reload if already loaded', async () => {
            // Create a new mock test item with URI
            const mockReloadTestItem = {
                uri: {
                    fsPath: '/path/test.rload',
                    scheme: 'file',
                    path: '/path/test.rload',
                    toString: () => 'file:///path/test.rload',
                    with: jest.fn().mockReturnValue({ fsPath: '/path/test.rload#fragment', path: '/path/test.rload#fragment' }),
                    fragment: ''
                },
                label: 'test-item',
                id: 'test-id',
                children: new MockTestItemCollection() as any,
                canResolveChildren: false,
                range: undefined,
                description: undefined,
                sortText: undefined,
                tags: [],
                parent: undefined,
                busy: false,
                error: undefined
            } as any as TestItem;

            const fileData = new TestFileData(mockReloadTestItem, rootItem);

            await fileData.load();
            const isLoadedAfterFirstCall = fileData.isLoaded;

            await fileData.load(); // Second call
            const isLoadedAfterSecondCall = fileData.isLoaded;

            expect(isLoadedAfterFirstCall).toBe(true);
            expect(isLoadedAfterSecondCall).toBe(true);
        });

        it('should handle errors during loading gracefully', async () => {
            // Create a new mock test item with URI
            const mockErrorTestItem = {
                uri: {
                    fsPath: '/path/test.err',
                    scheme: 'file',
                    path: '/path/test.err',
                    toString: () => 'file:///path/test.err',
                    with: jest.fn().mockReturnValue({ fsPath: '/path/test.err#fragment', path: '/path/test.err#fragment' }),
                    fragment: ''
                },
                label: 'test-item',
                id: 'test-id',
                children: new MockTestItemCollection() as any,
                canResolveChildren: false,
                range: undefined,
                description: undefined,
                sortText: undefined,
                tags: [],
                parent: undefined,
                busy: false,
                error: undefined
            } as any as TestItem;

            const fileData = new TestFileData(mockErrorTestItem, rootItem);

            // Mock ApiUtils.isRPGLE to return true
            const { ApiUtils } = require("../api/apiUtils");
            ApiUtils.isRPGLE.mockReturnValue(true);

            // Mock fs.readFileSync to throw an error
            const fs = require("fs");
            fs.readFileSync.mockImplementation(() => {
                throw new Error('File read error');
            });

            await fileData.load();

            expect(fileData.isLoaded).toBe(true); // Should still be marked as loaded
        });
    });

    describe('TestCaseData', () => {
        let rootItem: TestItem;
        let fileItem: TestItem;

        beforeEach(() => {
            rootItem = {
                uri: Uri.parse('file:///root/test.pgm'),
                label: 'root-item',
                id: 'root-id',
                children: new MockTestItemCollection() as any,
                canResolveChildren: false,
                range: undefined,
                description: undefined,
                sortText: undefined,
                tags: [],
                parent: undefined,
                busy: false,
                error: undefined
            } as any as TestItem;

            fileItem = {
                uri: Uri.parse('file:///file/test.pgm'),
                label: 'file-item',
                id: 'file-id',
                children: new MockTestItemCollection() as any,
                canResolveChildren: false,
                range: undefined,
                description: undefined,
                sortText: undefined,
                tags: [],
                parent: undefined,
                busy: false,
                error: undefined
            } as any as TestItem;
        });

        it('should create an instance with the correct properties', () => {
            const testCaseData = new TestCaseData(mockTestItem, rootItem, fileItem);

            expect(testCaseData.item).toBe(mockTestItem);
            expect(testCaseData.type).toBe('case');
            expect(testCaseData.rootItem).toBe(rootItem);
            expect(testCaseData.fileItem).toBe(fileItem);
        });
    });
});