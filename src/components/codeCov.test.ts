import { CodeCov } from './codeCov';
import IBMi from '@halcyontech/vscode-ibmi-types/api/IBMi';
import { ComponentState } from '@halcyontech/vscode-ibmi-types/api/components/component';
import { LogLevel } from 'vscode';

// Mock the testOutputLogger
jest.mock('../extension', () => ({
    testOutputLogger: {
        log: jest.fn()
    }
}));

// Import the mocked logger
import { testOutputLogger } from '../extension';

describe('CodeCov', () => {
    let mockConnection: IBMi;
    let mockContent: any;

    beforeEach(() => {
        mockContent = {
            checkObject: jest.fn()
        };

        mockConnection = {
            getContent: jest.fn(() => mockContent)
        } as unknown as IBMi;

        // Reset mocks before each test
        jest.clearAllMocks();
    });

    describe('getIdentification', () => {
        it('should return correct identification', () => {
            const codeCov = new CodeCov();
            const identification = codeCov.getIdentification();

            expect(identification.name).toBe('CODECOV');
            expect(identification.version).toBe('1.0.0');
        });
    });

    describe('getRemoteState', () => {
        it('should return Installed when CODECOV command exists', async () => {
            const codeCov = new CodeCov();
            (mockContent.checkObject as jest.Mock).mockResolvedValue(true);

            const result = await codeCov.getRemoteState(mockConnection, '/install/dir');

            expect(result).toBe('Installed');
            expect(mockContent.checkObject).toHaveBeenCalledWith({
                library: 'QDEVTOOLS',
                name: 'CODECOV',
                type: '*CMD'
            });
            expect(testOutputLogger.log).not.toHaveBeenCalled();
        });

        it('should return NotInstalled when CODECOV command does not exist', async () => {
            const codeCov = new CodeCov();
            (mockContent.checkObject as jest.Mock).mockResolvedValue(false);

            const result = await codeCov.getRemoteState(mockConnection, '/install/dir');

            expect(result).toBe('NotInstalled');
            expect(mockContent.checkObject).toHaveBeenCalledWith({
                library: 'QDEVTOOLS',
                name: 'CODECOV',
                type: '*CMD'
            });
            expect(testOutputLogger.log).toHaveBeenCalledWith(
                LogLevel.Error,
                'CODECOV command not found in QDEVTOOLS.LIB'
            );
        });

        it('should return Error when an exception occurs', async () => {
            const codeCov = new CodeCov();
            const errorMessage = new Error('Test error');
            (mockContent.checkObject as jest.Mock).mockRejectedValue(errorMessage);

            const result = await codeCov.getRemoteState(mockConnection, '/install/dir');

            expect(result).toBe('Error');
            expect(mockContent.checkObject).toHaveBeenCalledWith({
                library: 'QDEVTOOLS',
                name: 'CODECOV',
                type: '*CMD'
            });
            expect(testOutputLogger.log).toHaveBeenCalledWith(
                LogLevel.Error,
                `Failed to get remote state of CODECOV component. Error: ${errorMessage}`
            );
        });
    });

    describe('update', () => {
        it('should delegate to getRemoteState', async () => {
            const codeCov = new CodeCov();
            const getRemoteStateSpy = jest.spyOn(codeCov, 'getRemoteState').mockResolvedValue('Installed');

            const result = await codeCov.update(mockConnection, '/install/dir');

            expect(result).toBe('Installed');
            expect(getRemoteStateSpy).toHaveBeenCalledWith(mockConnection, '/install/dir');
        });
    });

    describe('static properties', () => {
        it('should have correct ID', () => {
            expect(CodeCov.ID).toBe('CODECOV');
        });

        it('should have correct minimum version', () => {
            expect(CodeCov.MINIMUM_VERSION).toBe('1.0.0');
        });
    });
});