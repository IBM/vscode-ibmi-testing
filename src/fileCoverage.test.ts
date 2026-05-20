import { CancellationToken, DeclarationCoverage, FileCoverage, Position, StatementCoverage, TestCoverageCount, TestRun, Uri } from "vscode";
import { IBMiFileCoverage } from "./fileCoverage";
import { MergedCoverageData, BasicUri, CCLVL } from "../api/types";

// Helper to create BasicUri
function createBasicUri(scheme: 'file' | 'member' | 'streamfile' | 'object', path: string, fsPath: string = path, fragment: string = ''): BasicUri {
    return {
        scheme,
        path,
        fsPath,
        fragment
    };
}

// Mock MergedCoverageData for testing
const mockMergedCoverageData: MergedCoverageData = {
    uri: createBasicUri('file', '/mock/path/test.ts', '/mock/path/test.ts'),
    activeLines: {
        "1": true,
        "2": false,
        "3": true,
        "4": false,
        "5": true
    },
    ccLvl: '*LINE' // Statement coverage level
};

describe('IBMiFileCoverage', () => {
    describe('constructor', () => {
        it('should initialize with correct URI and coverage count', () => {
            const coverage = new IBMiFileCoverage(mockMergedCoverageData);

            expect(coverage.uri.scheme).toBe('file');
            expect(coverage.uri.path).toBe('/mock/path/test.ts');
            // The statement coverage gets updated during construction based on activeLines
            // For the mock data: 5 total lines, 3 executed (lines 1, 3, 5)
            expect(coverage.statementCoverage.covered).toBe(3);
            expect(coverage.statementCoverage.total).toBe(5);
        });

        it('should set isStatementCoverage to true when ccLvl is "*LINE"', () => {
            const coverage = new IBMiFileCoverage(mockMergedCoverageData);
            
            expect(coverage.isStatementCoverage).toBe(true);
        });

        it('should set isStatementCoverage to false when ccLvl is not "*LINE"', () => {
            const mockDataWithProcLevel: MergedCoverageData = {
                ...mockMergedCoverageData,
                ccLvl: '*PROC' // Different coverage level
            };

            const coverage = new IBMiFileCoverage(mockDataWithProcLevel);

            expect(coverage.isStatementCoverage).toBe(false);
        });

        it('should create statement coverage when isStatementCoverage is true', () => {
            const coverage = new IBMiFileCoverage(mockMergedCoverageData);

            expect(coverage.lines.length).toBe(5); // 5 lines in activeLines
            expect(coverage.lines[0]).toHaveProperty('executed'); // Check if it has expected properties
            expect(coverage.lines[0]).toHaveProperty('location'); // Check if it has expected properties
            // Just test that the location property exists
            expect(coverage.lines[0].location).toBeDefined();
        });

        it('should create procedure coverage when isStatementCoverage is false', () => {
            const mockDataWithProcLevel: MergedCoverageData = {
                ...mockMergedCoverageData,
                ccLvl: '*PROC'
            };

            const coverage = new IBMiFileCoverage(mockDataWithProcLevel);

            expect(coverage.procedures.length).toBe(5); // 5 lines in activeLines
            expect(coverage.procedures[0]).toHaveProperty('name'); // Check if it has expected properties
            expect(coverage.procedures[0]).toHaveProperty('executed'); // Check if it has expected properties
            expect(coverage.procedures[0]).toHaveProperty('location'); // Check if it has expected properties
            expect(coverage.procedures[0].location).toBeDefined(); // Has location property
            expect(coverage.procedures[0].name).toBe("1"); // Line number as string
        });

        it('should update statementCoverage count when isStatementCoverage is true', () => {
            const coverage = new IBMiFileCoverage(mockMergedCoverageData);

            // Total should be 5 (all lines), covered should be 3 (lines 1, 3, 5)
            expect(coverage.statementCoverage.total).toBe(5);
            expect(coverage.statementCoverage.covered).toBe(3);
        });

        it('should update declarationCoverage count when isStatementCoverage is false', () => {
            const mockDataWithProcLevel: MergedCoverageData = {
                ...mockMergedCoverageData,
                ccLvl: '*PROC'
            };

            const coverage = new IBMiFileCoverage(mockDataWithProcLevel);

            // Total should be 5 (all lines), covered should be 3 (lines 1, 3, 5)
            expect(coverage.declarationCoverage?.total).toBe(5);
            expect(coverage.declarationCoverage?.covered).toBe(3);
        });

        it('should handle empty activeLines', () => {
            const mockEmptyData: MergedCoverageData = {
                ...mockMergedCoverageData,
                activeLines: {}
            };
            
            const coverage = new IBMiFileCoverage(mockEmptyData);
            
            expect(coverage.lines.length).toBe(0);
            expect(coverage.procedures.length).toBe(0);
            expect(coverage.statementCoverage.total).toBe(0);
            expect(coverage.statementCoverage.covered).toBe(0);
        });

        it('should handle different URI schemes', () => {
            const mockUriData: MergedCoverageData = {
                uri: createBasicUri('member', '/path/file/mbr', '/path/file/mbr', ''),
                activeLines: {
                    "1": true
                },
                ccLvl: '*LINE'
            };

            const coverage = new IBMiFileCoverage(mockUriData);

            expect(coverage.uri.path).toBe('/path/file/mbr');
        });
    });

    describe('loadDetailedCoverage', () => {
        it('should return lines when fileCoverage is IBMiFileCoverage and isStatementCoverage is true', async () => {
            const coverage = new IBMiFileCoverage(mockMergedCoverageData);
            const mockTestRun = {} as TestRun;
            const mockToken = {} as CancellationToken;

            const result = await IBMiFileCoverage.loadDetailedCoverage(mockTestRun, coverage, mockToken);

            expect(result.length).toBe(coverage.lines.length);
            // Verify that the returned elements have the expected properties
            if (result.length > 0) {
                expect(result[0]).toHaveProperty('executed');
                expect(result[0]).toHaveProperty('location');
            }
        });

        it('should return procedures when fileCoverage is IBMiFileCoverage and isStatementCoverage is false', async () => {
            const mockDataWithProcLevel: MergedCoverageData = {
                ...mockMergedCoverageData,
                ccLvl: '*PROC'
            };
            const coverage = new IBMiFileCoverage(mockDataWithProcLevel);
            const mockTestRun = {} as TestRun;
            const mockToken = {} as CancellationToken;

            const result = await IBMiFileCoverage.loadDetailedCoverage(mockTestRun, coverage, mockToken);

            expect(result.length).toBe(coverage.procedures.length);
            // Verify that the returned elements have the expected properties
            if (result.length > 0) {
                expect(result[0]).toHaveProperty('name');
                expect(result[0]).toHaveProperty('executed');
                expect(result[0]).toHaveProperty('location');
            }
        });

        it('should return empty array when fileCoverage is not IBMiFileCoverage', async () => {
            // Create a mock of FileCoverage that is NOT IBMiFileCoverage
            const mockStandardFileCoverage = {
                uri: Uri.file('/mock/path/test.ts'),
                statementCoverage: new TestCoverageCount(0, 0)
            } as FileCoverage;
            
            const mockTestRun = {} as TestRun;
            const mockToken = {} as CancellationToken;

            const result = await IBMiFileCoverage.loadDetailedCoverage(mockTestRun, mockStandardFileCoverage, mockToken);

            expect(result).toEqual([]);
        });

        it('should return empty array when fileCoverage is IBMiFileCoverage but procedures length is 0 and not statement coverage', async () => {
            const mockDataEmpty: MergedCoverageData = {
                ...mockMergedCoverageData,
                ccLvl: '*PROC',
                activeLines: {}
            };
            const coverage = new IBMiFileCoverage(mockDataEmpty);
            const mockTestRun = {} as TestRun;
            const mockToken = {} as CancellationToken;

            const result = await IBMiFileCoverage.loadDetailedCoverage(mockTestRun, coverage, mockToken);

            expect(result).toEqual([]);
        });
    });
});