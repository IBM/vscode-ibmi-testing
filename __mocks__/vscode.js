// Mock for VSCode API
module.exports = {
    // Enums
    TestRunProfileKind: {
        Run: 'run',
        Debug: 'debug',
        Coverage: 'coverage'
    },

    // Functions
    tests: {
        createTestController: jest.fn().mockReturnValue({
            items: {
                forEach: jest.fn(),
                delete: jest.fn(),
                add: jest.fn(),
                get: jest.fn()
            },
            createTestItem: jest.fn(),
            createRunProfile: jest.fn()
        })
    },

    // Classes
    CancellationTokenSource: jest.fn(),
    Disposable: jest.fn(),
    EventEmitter: jest.fn().mockImplementation(() => ({
        event: jest.fn(),
        fire: jest.fn()
    })),
    
    // Objects
    workspace: {
        onDidOpenTextDocument: jest.fn(),
        onDidChangeTextDocument: jest.fn(),
        findFiles: jest.fn(),
        workspaceFolders: [],
        getWorkspaceFolder: jest.fn(),
        textDocuments: [],
        onDidChangeConfiguration: jest.fn(),
        createFileSystemWatcher: jest.fn().mockReturnValue({
            onDidCreate: jest.fn(),
            onDidChange: jest.fn(),
            onDidDelete: jest.fn(),
            dispose: jest.fn()
        })
    },
    
    window: {
        showErrorMessage: jest.fn(),
        showInformationMessage: jest.fn(),
        createOutputChannel: jest.fn().mockReturnValue({
            appendLine: jest.fn(),
            show: jest.fn()
        }),
        visibleTextEditors: []
    },

    // Mock classes that just return objects with the right properties
    Uri: {
        file: jest.fn(path => ({ 
            scheme: 'file', 
            path, 
            fsPath: path, 
            toString: () => `file:${path}`,
            joinPath: jest.fn()
        })),
        parse: jest.fn(uri => ({ 
            scheme: uri.split(':')[0], 
            path: uri.substring(uri.indexOf(':') + 1),
            toString: () => uri 
        })),
        from: jest.fn(params => params)
    },

    RelativePattern: jest.fn().mockImplementation((folder, pattern) => ({
        base: folder.uri?.fsPath || '',
        pattern
    })),

    TestTag: jest.fn().mockImplementation((id) => ({ id })),
    
    TestItem: jest.fn().mockImplementation((id, label, uri) => ({
        id,
        label,
        uri,
        children: new Map(),
        parent: null,
        canResolveChildren: true,
        tags: []
    })),

    // Coverage types - properly implement to match actual VS Code API
    TestCoverageCount: jest.fn().mockImplementation((covered, total) => ({
        covered: covered ?? 0,
        total: total ?? 0
    })),

    // FileCoverage - properly implement to match actual VS Code API (do not mock this since IBMiFileCoverage extends it)
    FileCoverage: function(uri, statementCoverage, declarationCoverage) {
        this.uri = uri;
        this.statementCoverage = statementCoverage || new module.exports.TestCoverageCount(0, 0);
        this.declarationCoverage = declarationCoverage || null;
    },

    // StatementCoverage - properly implement to match actual VS Code API
    StatementCoverage: jest.fn().mockImplementation((executed, location) => ({
        executed,
        location,
        branches: []
    })),

    // DeclarationCoverage - properly implement to match actual VS Code API
    DeclarationCoverage: jest.fn().mockImplementation((name, executed, location) => ({
        name,
        executed,
        location,
        branches: []
    })),

    // Enum values
    LogLevel: {
        Info: 'info',
        Warning: 'warning',
        Error: 'error'
    },

    // Position class for fileCoverage
    Position: jest.fn().mockImplementation((line, character) => ({
        line,
        character
    })),
    // Range class
    Range: jest.fn().mockImplementation((start, end) => ({
        start,
        end,
        isEmpty: false,
        isSingleLine: start.line === end.line
    })),
    // Location class
    Location: jest.fn().mockImplementation((uri, range) => ({
        uri,
        range
    })),
    // TestMessage class
    TestMessage: jest.fn().mockImplementation((message) => ({
        message,
        location: undefined,
        expectedOutput: undefined,
        actualOutput: undefined
    }))
};