import { TestRunRequest, TestItem, TestRun, TestRunProfileKind, Uri, CancellationToken, Position, Range, Location, TestMessage } from "vscode";
import { IBMiTestManager } from "./manager";
import { IBMiTestRunner } from "./runner";
import { TestBucket, TestRequest, CompileMode, CCLVL, MergedCoverageData, BasicUri, Env, RUCALLTST, DeploymentStatus } from "../api/types";
import { RPGUnit } from "./components/rpgUnit";
import { Runner } from "../api/runner";
import { TestFileData, TestCaseData } from "./testData";
import { IBMiFileCoverage } from "./fileCoverage";


// Mock all dependencies
jest.mock('./components/rpgUnit', () => ({
    RPGUnit: {
        checkInstallation: jest.fn()
    }
}));

jest.mock('../api/runner', () => ({
    Runner: jest.fn()
}));

jest.mock('./fileCoverage', () => ({
    IBMiFileCoverage: jest.fn()
}));

jest.mock('../api/testLogger', () => ({
    TestLogger: jest.fn().mockImplementation((outputLogger, resultLogger) => ({
        logComponentError: jest.fn(),
        logRunTimeWarning: jest.fn(),
        log: jest.fn(),
        testResultLogger: {
            append: jest.fn()
        }
    }))
}));

jest.mock('./extensions/ibmi', () => ({
    getInstance: jest.fn(() => ({
        getConnection: jest.fn(() => ({
            parserMemberPath: jest.fn(() => ({
                asp: undefined,
                library: 'TESTLIB',
                file: 'TESTFILE',
                name: 'TESTMBR',
                extension: 'RPGLE'
            })),
            upperCaseName: jest.fn((str) => str.toUpperCase()),
            getConfig: jest.fn(() => ({
                defaultDeploymentMethod: 'compare',
                homeDirectory: '/home/user'
            }))
        })),
        getLibraryList: jest.fn(() => ({
            currentLibrary: 'TESTLIB',
            libraryList: ['RPGUNIT', 'QGPL']
        }))
    })),
    getDeployTools: jest.fn().mockReturnValue({
        launchDeploy: jest.fn().mockResolvedValue(true),
        getRemoteDeployDirectory: jest.fn().mockReturnValue('/tmp/deploy')
    })
}));

jest.mock('./configuration', () => ({
    Configuration: {
        get: jest.fn((key) => {
            const config: Record<string, any> = {
                'testing.productLibrary': 'RPGUNIT',
                'testing.runOrder': '*SAME',
                'testing.reportDetail': '*ALL',
                'testing.createReport': '*XML',
                'testing.libraryList': '*LICPGM',
                'testing.jobDescription': '*NONE',
                'testing.reclaimResources': '*YES',
                'testing.libraryListValidation': {
                    RPGUNIT: true,
                    QDEVTOOLS: true
                }
            };
            return config[`testing.${key.split('.')[1]}`] || '';
        }),
        getOrFallback: jest.fn((key, fallback) => {
            if (key === 'testing.productLibrary') return 'RPGUNIT';
            return fallback;
        }),
        set: jest.fn()
    },
    Section: {
        productLibrary: 'testing.productLibrary',
        runOrder: 'testing.runOrder',
        reportDetail: 'testing.reportDetail',
        createReport: 'testing.createReport',
        libraryList: 'testing.libraryList',
        jobDescription: 'testing.jobDescription',
        reclaimResources: 'testing.reclaimResources',
        libraryListValidation: 'testing.libraryListValidation'
    }
}));

jest.mock('./loggers/testResultLogger', () => ({
    TestResultLogger: jest.fn().mockImplementation(() => ({
        started: jest.fn(),
        passed: jest.fn(),
        failed: jest.fn(),
        skipped: jest.fn(),
        errored: jest.fn(),
        end: jest.fn()
    }))
}));

jest.mock('./testData', () => ({
    TestFileData: jest.fn(),
    TestCaseData: jest.fn()
}));

jest.mock('./extension', () => ({
    testOutputLogger: {
        log: jest.fn(),
        appendWithNotification: jest.fn()
    }
}));

jest.mock('../api/apiUtils', () => ({
    ApiUtils: {
        getSystemNameFromPath: jest.fn((filename) => filename.replace(/\.[^/.]+$/, "")), // Remove extension
        getEnvConfig: jest.fn().mockResolvedValue({})
    }
}));

jest.mock('../api/config', () => ({
    IfsConfigHandler: jest.fn().mockImplementation(() => ({
        getConfig: jest.fn().mockResolvedValue({})
    })),
    LocalConfigHandler: jest.fn().mockImplementation(() => ({
        getConfig: jest.fn().mockResolvedValue({})
    })),
    QsysConfigHandler: jest.fn().mockImplementation(() => ({
        getConfig: jest.fn().mockResolvedValue({})
    }))
}));

describe('IBMiTestRunner', () => {
    let mockManager: jest.Mocked<IBMiTestManager>;
    let mockRequest: TestRunRequest;
    let mockToken: CancellationToken;
    let mockTestRun: TestRun;
    let mockTestItem: TestItem;

    beforeEach(() => {
        jest.clearAllMocks();

        // Mock the IBMiTestManager
        mockManager = {
            controller: {
                createTestRun: jest.fn(),
                items: {
                    forEach: jest.fn()
                } as any
            },
            testMap: new Map(),
            getFlattenedTestItems: jest.fn().mockReturnValue([])
        } as any;

        // Mock the TestRunRequest with correct structure
        mockRequest = {
            include: undefined,
            exclude: undefined,
            profile: undefined,
            preserveFocus: false
        } as TestRunRequest;

        // Mock the CancellationToken
        mockToken = {
            isCancellationRequested: false
        } as CancellationToken;

        // Mock TestRun
        mockTestRun = {
            enqueued: jest.fn(),
            started: jest.fn(),
            skipped: jest.fn(),
            passed: jest.fn(),
            failed: jest.fn(),
            errored: jest.fn(),
            addCoverage: jest.fn(),
            end: jest.fn()
        } as any;

        // Mock a test item with proper structure
        mockTestItem = {
            id: 'test-item',
            uri: Uri.file('/path/to/test.rpgle'),
            label: 'test-item-label',
            children: {
                forEach: jest.fn()
            } as any,
            parent: undefined,
            canResolveChildren: true,
            tags: [],
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } } as any,
            busy: false,
            error: undefined
        } as TestItem;
    });

    describe('constructor', () => {
        it('should initialize properties correctly', () => {
            const runner = new IBMiTestRunner(mockManager, mockRequest, mockToken, 'test' as CompileMode);

            expect((runner as any).manager).toBe(mockManager);
            expect((runner as any).request).toBe(mockRequest);
            expect((runner as any).token).toBe(mockToken);
            expect((runner as any).compileMode).toBe('test' as CompileMode);
        });
    });
});