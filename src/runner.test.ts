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

    describe('runHandler', () => {
        it('should end test run if cancellation is requested before checking RPGUnit installation', async () => {
            const cancelledToken = { isCancellationRequested: true } as CancellationToken;
            const runner = new IBMiTestRunner(mockManager, mockRequest, cancelledToken, 'test' as CompileMode);

            // Mock the test run creation
            (mockManager.controller.createTestRun as jest.Mock).mockReturnValue(mockTestRun);

            await runner.runHandler();

            expect(mockTestRun.end).toHaveBeenCalled();
        });

        it('should log error and end test run if RPGUnit installation check fails', async () => {
            (RPGUnit.checkInstallation as jest.Mock).mockResolvedValue({
                status: false,
                error: 'RPGUnit not installed'
            });

            const runner = new IBMiTestRunner(mockManager, mockRequest, mockToken, 'test' as CompileMode);

            // Mock the test run creation
            (mockManager.controller.createTestRun as jest.Mock).mockReturnValue(mockTestRun);

            await runner.runHandler();

            expect(mockTestRun.end).toHaveBeenCalled();
        });

        it('should proceed with test execution when RPGUnit is installed', async () => {
            (RPGUnit.checkInstallation as jest.Mock).mockResolvedValue({
                status: true
            });

            // Mock the test run creation
            (mockManager.controller.createTestRun as jest.Mock).mockReturnValue(mockTestRun);

            const runner = new IBMiTestRunner(mockManager, mockRequest, mockToken, 'test' as CompileMode);

            // Mock buildTestBucket to return some test data
            const buildTestBucketSpy = jest.spyOn(runner as any, 'buildTestBucket').mockResolvedValue([]);

            // Mock validateLibraryList
            const validateLibraryListSpy = jest.spyOn(runner as any, 'validateLibraryList').mockResolvedValue(undefined);

            // Mock the Runner class to avoid actually running tests
            const mockRunnerInstance = {
                run: jest.fn().mockResolvedValue(undefined)
            };
            (Runner as jest.Mock).mockReturnValue(mockRunnerInstance);

            await runner.runHandler();

            // Check that all expected steps were performed
            expect(mockManager.controller.createTestRun).toHaveBeenCalledWith(mockRequest);
            expect(buildTestBucketSpy).toHaveBeenCalled();
            expect(validateLibraryListSpy).toHaveBeenCalled();
            expect(Runner).toHaveBeenCalled();
            expect(mockRunnerInstance.run).toHaveBeenCalled();
        });
    });

    describe('Test Callbacks', () => {
        it('should define all test callbacks correctly', async () => {
            (RPGUnit.checkInstallation as jest.Mock).mockResolvedValue({
                status: true
            });

            const runner = new IBMiTestRunner(mockManager, mockRequest, mockToken, 'test' as CompileMode);

            // Mock the test run creation
            (mockManager.controller.createTestRun as jest.Mock).mockReturnValue(mockTestRun);

            // Mock buildTestBucket to return some test data
            (runner as any).buildTestBucket = jest.fn().mockResolvedValue([]);

            // Mock validateLibraryList
            (runner as any).validateLibraryList = jest.fn().mockResolvedValue(undefined);

            // Mock the Runner class to check callbacks
            let capturedCallbacks: any;
            (Runner as jest.Mock).mockImplementation((connection, request, callbacks, logger) => {
                capturedCallbacks = callbacks;
                return {
                    run: jest.fn().mockResolvedValue(undefined)
                };
            });

            await runner.runHandler();

            // Check that all expected callbacks are defined
            expect(capturedCallbacks).toBeDefined();
            expect(typeof capturedCallbacks.deploy).toBe('function');
            expect(typeof capturedCallbacks.getDeployDirectory).toBe('function');
            expect(typeof capturedCallbacks.getLibraryList).toBe('function');
            expect(typeof capturedCallbacks.isDiagnosticsCleared).toBe('function');
            expect(typeof capturedCallbacks.clearDiagnostics).toBe('function');
            expect(typeof capturedCallbacks.loadDiagnostics).toBe('function');
            expect(typeof capturedCallbacks.getEnvConfig).toBe('function');
            expect(typeof capturedCallbacks.getProductLibrary).toBe('function');
            expect(typeof capturedCallbacks.getBaseExecutionParams).toBe('function');
            expect(typeof capturedCallbacks.setIsCompiled).toBe('function');
            expect(typeof capturedCallbacks.started).toBe('function');
            expect(typeof capturedCallbacks.skipped).toBe('function');
            expect(typeof capturedCallbacks.passed).toBe('function');
            expect(typeof capturedCallbacks.failed).toBe('function');
            expect(typeof capturedCallbacks.errored).toBe('function');
            expect(typeof capturedCallbacks.addCoverageDatasets).toBe('function');
            expect(typeof capturedCallbacks.shouldLogCoverage).toBe('function');
            expect(typeof capturedCallbacks.getCoverageThresholds).toBe('function');
            expect(typeof capturedCallbacks.isCancellationRequested).toBe('function');
            expect(typeof capturedCallbacks.end).toBe('function');
        });

        it('should handle test result callbacks properly', async () => {
            (RPGUnit.checkInstallation as jest.Mock).mockResolvedValue({
                status: true
            });

            const testItem = {
                id: 'test-id',
                uri: Uri.file('/path/to/test.rpgle'),
                label: 'test-label',
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } } as any,
                children: {
                    forEach: jest.fn()
                } as any,
                parent: undefined,
                canResolveChildren: true,
                tags: [],
                error: undefined,
                busy: false
            } as TestItem;

            mockManager.getFlattenedTestItems = jest.fn().mockReturnValue([testItem]);

            const runner = new IBMiTestRunner(mockManager, mockRequest, mockToken, 'test' as CompileMode);

            // Mock the test run creation
            (mockManager.controller.createTestRun as jest.Mock).mockReturnValue(mockTestRun);

            // Mock buildTestBucket to return some test data
            (runner as any).buildTestBucket = jest.fn().mockResolvedValue([]);

            // Mock validateLibraryList
            (runner as any).validateLibraryList = jest.fn().mockResolvedValue(undefined);

            // Mock the Runner class to check callbacks
            let capturedCallbacks: any;
            (Runner as jest.Mock).mockImplementation((connection, request, callbacks, logger) => {
                capturedCallbacks = callbacks;
                return {
                    run: jest.fn().mockResolvedValue(undefined)
                };
            });

            await runner.runHandler();

            // Create a mock URI to test with
            const mockUri: BasicUri = {
                scheme: 'file',
                path: '/path/to/test.rpgle',
                fsPath: '/path/to/test.rpgle',
                fragment: 'test-label'
            };

            // Test the 'passed' callback
            await capturedCallbacks.passed(mockUri, 100);
            expect(mockTestRun.passed).toHaveBeenCalledWith(testItem, 100);

            // Test the 'failed' callback
            await capturedCallbacks.failed(mockUri, [{ line: 5, message: 'Test failed message' }], 200);
            expect(mockTestRun.failed).toHaveBeenCalledWith(
                testItem,
                expect.arrayContaining([
                    expect.any(Object) // TestMessage from mocked vscode
                ]),
                200
            );

            // Test the 'errored' callback
            await capturedCallbacks.errored(mockUri, [{ message: 'Test error message' }], 300);
            expect(mockTestRun.errored).toHaveBeenCalledWith(
                testItem,
                expect.arrayContaining([
                    expect.any(Object) // TestMessage from mocked vscode
                ]),
                300
            );
        });
    });
});