import { CancellationToken, ExtensionContext, TestController, TestItem, TestRunProfileKind, TestRunRequest, Uri, WorkspaceFolder } from "vscode";

// Mock the dependencies before any imports
jest.mock('vscode', () => ({
    commands: {
        executeCommand: jest.fn()
    },
    tests: {
        createTestController: jest.fn()
    },
    workspace: {
        onDidOpenTextDocument: jest.fn(),
        onDidChangeTextDocument: jest.fn(),
        findFiles: jest.fn().mockResolvedValue([]),
        workspaceFolders: [],
        getWorkspaceFolder: jest.fn(),
        textDocuments: [],
        createFileSystemWatcher: jest.fn(() => ({
            onDidCreate: jest.fn(),
            onDidChange: jest.fn(),
            onDidDelete: jest.fn(),
            dispose: jest.fn()
        }))
    },
    window: {
        visibleTextEditors: []
    },
    TestRunProfileKind: {
        Run: 'Run',
        Coverage: 'Coverage'
    },
    Uri: {
        file: jest.fn((path) => ({
            scheme: 'file',
            path,
            fsPath: path,
            toString: () => `file://${path}`,
            with: jest.fn()
        })),
        from: jest.fn((components) => ({
            scheme: components.scheme,
            path: components.path,
            toString: () => `${components.scheme}://${components.path}`,
            with: jest.fn()
        })),
        joinPath: jest.fn((base, path) => ({
            scheme: base.scheme,
            path: `${base.path}/${path}`,
            toString: () => `${base.scheme}://${base.path}/${path}`,
            fsPath: `${base.path}/${path}`
        }))
    },
    TestTag: jest.fn().mockImplementation((id) => ({ id })),
    LogLevel: {
        Info: 'Info',
        Error: 'Error'
    },
    Position: jest.fn().mockImplementation((line, character) => ({ line, character })),
    Range: jest.fn().mockImplementation((start, end) => ({ start, end })),
    SymbolKind: {
        Class: 5
    }
}), { virtual: true });

import { IBMiTestManager } from "./manager";
import { IBMiTestRunner } from "./runner";
import { IBMiFileCoverage } from "./fileCoverage";
import { TestData, TestFileData } from "./testData";

// Mock the dependencies
jest.mock("./runner", () => ({
    IBMiTestRunner: jest.fn()
}));

jest.mock("./fileCoverage", () => ({
    IBMiFileCoverage: {
        loadDetailedCoverage: jest.fn()
    }
}));

jest.mock("./extensions/ibmi", () => ({
    getInstance: jest.fn(() => ({
        getConnection: jest.fn(() => ({
            parserMemberPath: jest.fn(() => ({
                asp: undefined,
                library: 'TESTLIB',
                file: 'TESTFILE',
                name: 'TESTMBR',
                extension: 'RPGLE'
            })),
            upperCaseName: jest.fn((str) => str.toUpperCase())
        })),
        getLibraryList: jest.fn(() => ({
            currentLibrary: 'TESTLIB',
            libraryList: []
        }))
    }))
}));

jest.mock("../api/apiUtils", () => ({
    ApiUtils: {
        getTestSuffixes: jest.fn(() => ({
            ifs: ['.rpgle', '.RPGLE'],
            qsys: ['.PGM', '.SRVPGM']
        })),
        getMemberList: jest.fn().mockResolvedValue([]),
        isRPGLE: jest.fn((path) => path.endsWith('.rpgle') || path.endsWith('.RPGLE')),
        readMember: jest.fn().mockResolvedValue('')
    }
}));

jest.mock("./configuration", () => ({
    Configuration: {
        getOrFallback: jest.fn(() => [])
    },
    Section: {
        testSourceFiles: 'testSourceFiles'
    }
}));

jest.mock("./extension", () => ({
    testOutputLogger: {
        log: jest.fn()
    }
}));

describe('IBMiTestManager', () => {
    let mockContext: Partial<ExtensionContext>;
    let mockController: Partial<TestController>;
    let mockTestItem: Partial<TestItem>;

    beforeEach(() => {
        // Reset mocks
        jest.clearAllMocks();

        mockTestItem = {
            id: 'test-id',
            uri: Uri.file('/path/to/test'),
            children: {
                forEach: jest.fn(),
                get: jest.fn(),
                add: jest.fn(),
                delete: jest.fn(),
                size: 0,
                [Symbol.iterator]: function* () {}
            } as any,
            parent: undefined,
            canResolveChildren: true,
            tags: []
        };

        mockController = {
            items: {
                forEach: jest.fn((callback, thisArg) => {}),
                get: jest.fn().mockReturnValue(undefined),
                add: jest.fn(),
                delete: jest.fn(),
                size: 0,
                [Symbol.iterator]: function* () {},
                replace: jest.fn()
            } as any,
            resolveHandler: undefined,
            refreshHandler: undefined,
            createTestItem: jest.fn((id, label, uri) => ({
                id,
                label,
                uri,
                canResolveChildren: true,
                tags: [],
                children: {
                    forEach: jest.fn(),
                    get: jest.fn(),
                    add: jest.fn(),
                    delete: jest.fn(),
                    size: 0,
                    [Symbol.iterator]: function* () {},
                    replace: jest.fn()
                },
                parent: undefined,
                busy: false,
                range: undefined,
                error: undefined
            })),
            createRunProfile: jest.fn((label, kind, runHandler, isDefault) => {
                return {
                    label,
                    kind,
                    runHandler,
                    isDefault: isDefault || false, // Convert undefined to false
                    loadDetailedCoverage: undefined,
                    onDidChangeDefault: jest.fn(),
                    supportsContinuousRun: false,
                    tag: undefined,
                    configureHandler: undefined,
                    dispose: jest.fn()
                };
            })
        };

        mockContext = {
            subscriptions: [],
            extensionUri: Uri.file('/path/to/extension'),
            extensionPath: '/path/to/extension',
            storagePath: '/path/to/storage',
            globalStoragePath: '/path/to/global/storage',
            logPath: '/path/to/log'
        };

        // Setup the vscode mock to return the mocked controller
        const { tests } = require('vscode');
        (tests.createTestController as jest.Mock).mockReturnValue(mockController);
    });

    describe('constructor', () => {
        it('should initialize properties correctly', () => {
            const manager = new IBMiTestManager(mockContext as ExtensionContext);
            
            expect(manager.context).toBe(mockContext);
            expect(manager.testMap).toBeDefined();
            expect(manager.controller).toBeDefined();
        });

        it('should create test controller with correct id and label', () => {
            const { tests } = require('vscode');
            const mockCreateTestController = jest.fn(() => mockController);
            (tests.createTestController as jest.Mock).mockReturnValue(mockCreateTestController());
            
            const manager = new IBMiTestManager(mockContext as ExtensionContext);
            
            expect(tests.createTestController).toHaveBeenCalledWith(
                'IBMi', 
                'IBM i Testing'
            );
        });

        it('should create run profiles for different test modes', () => {
            const { tests } = require('vscode');
            (tests.createTestController as jest.Mock).mockReturnValue(mockController);
            
            const manager = new IBMiTestManager(mockContext as ExtensionContext);
            
            // There should be 9 profiles created (3 types × 3 compile modes each)
            expect(mockController.createRunProfile).toHaveBeenCalledTimes(9);
        });
    });

    describe('refreshTests', () => {
        it('should clear all existing test items and reload tests', async () => {
            const { tests } = require('vscode');
            (tests.createTestController as jest.Mock).mockReturnValue(mockController);
            
            const manager = new IBMiTestManager(mockContext as ExtensionContext);
            const mockLoadInitialTests = jest.spyOn(manager, 'loadInitialTests').mockResolvedValue();

            const mockItem = { id: 'test-item', canResolveChildren: true, children: { [Symbol.iterator]: function* () {} } as any };
            (mockController.items as any).forEach = jest.fn((callback, thisArg) => callback(mockItem, mockController.items));
            (mockController.items as any).delete = jest.fn();
            
            await manager.refreshTests();
            
            expect((mockController.items as any).delete).toHaveBeenCalledWith('test-item');
            expect(mockLoadInitialTests).toHaveBeenCalled();
            
            mockLoadInitialTests.mockRestore();
        });
    });

    describe('createTestItem', () => {
        it('should create a test item with correct properties', () => {
            const { tests } = require('vscode');
            (tests.createTestController as jest.Mock).mockReturnValue(mockController);
            
            const manager = new IBMiTestManager(mockContext as ExtensionContext);
            const uri = Uri.file('/path/to/test.rpgle');
            const label = 'test-label';
            const id = 'test-id';
            
            const testItem = manager.createTestItem(id, uri, label);
            
            expect(testItem.id).toBe(id);
            expect(testItem.label).toBe(label);
            expect(testItem.uri).toEqual(uri);
            expect(testItem.canResolveChildren).toBe(true);
        });

        it('should assign correct tags for local files', () => {
            const { tests } = require('vscode');
            (tests.createTestController as jest.Mock).mockReturnValue(mockController);
            
            const manager = new IBMiTestManager(mockContext as ExtensionContext);
            const uri = Uri.file('/path/to/test.rpgle');
            const label = 'test-label';
            const id = 'test-id';
            
            const testItem = manager.createTestItem(id, uri, label);
            
            expect(testItem.tags).toHaveLength(1);
            expect(testItem.tags![0].id).toBe('local');
        });

        it('should assign correct tags for remote members', () => {
            const { tests } = require('vscode');
            (tests.createTestController as jest.Mock).mockReturnValue(mockController);
            
            const manager = new IBMiTestManager(mockContext as ExtensionContext);
            const uri = Uri.from({ scheme: 'member', path: '/TESTLIB/TESTFILE/TESTMBR.RPGLE' });
            const label = 'test-label';
            const id = 'test-id';
            
            const testItem = manager.createTestItem(id, uri, label);
            
            expect(testItem.tags).toHaveLength(1);
            expect(testItem.tags![0].id).toBe('qsys');
        });
    });

    describe('getFlattenedTestItems', () => {
        it('should return all test items in a flattened array', () => {
            const { tests } = require('vscode');
            (tests.createTestController as jest.Mock).mockReturnValue(mockController);
            
            const manager = new IBMiTestManager(mockContext as ExtensionContext);
            const mockChildTestItem = {
                id: 'child-test-id',
                uri: Uri.file('/path/to/child'),
                children: {
                    [Symbol.iterator]: function* () {}
                }
            };
            
            const mockParentTestItem = {
                id: 'parent-test-id',
                uri: Uri.file('/path/to/parent'),
                children: {
                    [Symbol.iterator]: function* () {
                        yield ['child-key', mockChildTestItem as any];
                    }
                }
            };
            
            (mockController.items as any)[Symbol.iterator] = function* () {
                yield ['parent-key', mockParentTestItem as any];
            };
            
            const result = manager.getFlattenedTestItems();
            
            expect(result).toContain(mockParentTestItem);
            expect(result).toContain(mockChildTestItem);
        });
    });
});