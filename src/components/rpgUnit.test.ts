import { RPGUnit } from './rpgUnit';
import { ComponentState } from "@halcyontech/vscode-ibmi-types/api/components/component";
import IBMi from "@halcyontech/vscode-ibmi-types/api/IBMi";
import { Configuration, Section } from '../configuration';
import { GitHub } from '../github';
import { commands, window, QuickPickItem, QuickPickItemKind, ProgressLocation, LogLevel } from 'vscode';
import { testOutputLogger } from '../extension';

// Mock dependencies
jest.mock('../extensions/ibmi', () => ({
    getInstance: jest.fn()
}));

const mockedGetInstance = require('../extensions/ibmi').getInstance;

jest.mock('../configuration', () => ({
    Configuration: {
        getOrFallback: jest.fn()
    },
    Section: {
        productLibrary: 'PRODUCTLIB'
    }
}));

const mockedConfiguration = require('../configuration');

jest.mock('../github', () => ({
    GitHub: {
        getReleases: jest.fn(),
        downloadReleaseAsset: jest.fn(),
        ASSET_NAME: 'rpgunit.savf'
    }
}));

const mockedGitHub = require('../github');

jest.mock('../extension', () => ({
    testOutputLogger: {
        log: jest.fn(),
        appendWithNotification: jest.fn(),
        show: jest.fn()
    }
}));

jest.mock('../extensions/ibmi', () => ({
    getInstance: jest.fn()
}));

jest.mock('vscode', () => ({
    commands: {
        executeCommand: jest.fn()
    },
    window: {
        showQuickPick: jest.fn(),
        showInformationMessage: jest.fn().mockResolvedValue(null),
        withProgress: jest.fn().mockImplementation(async (options, callback) => await callback({ report: jest.fn() })),
        showErrorMessage: jest.fn().mockReturnValue(Promise.resolve(null))
    },
    QuickPickItemKind: {
        Separator: -1
    },
    ProgressLocation: {
        Notification: 1
    },
    LogLevel: {
        Info: 'info',
        Warning: 'warning',
        Error: 'error',
        Trace: 'trace',
        Debug: 'debug'
    }
}));

const mockedVSCode = require('vscode');

describe('RPGUnit', () => {
    let rpgUnit: RPGUnit;
    let mockConnection: IBMi;
    let mockContent: any;
    let mockConfig: any;

    beforeEach(() => {
        rpgUnit = new RPGUnit();

        // Mock IBMi connection
        mockContent = {
            checkObject: jest.fn(),
            toCl: jest.fn((command, params) => `${command} ${Object.entries(params).map(([key, value]) => `${key}(${value})`).join(' ')}`),
            uploadFiles: jest.fn()
        };

        mockConfig = {
            tempDir: '/tmp',
            tempLibrary: 'QGPL'
        };

        mockConnection = {
            getContent: jest.fn(() => mockContent),
            getConfig: jest.fn(() => mockConfig),
            upperCaseName: jest.fn((str) => str.toUpperCase()),
            runCommand: jest.fn(),
            getComponentManager: jest.fn()
        } as any;

        // Reset mocks
        jest.clearAllMocks();

        // Ensure getRemoteState is properly mocked as a spyable method
        jest.spyOn(rpgUnit, 'getRemoteState').mockImplementation(async (connection, installDir) => 'Installed' as ComponentState);
    });

    describe('getIdentification', () => {
        it('should return correct identification information', () => {
            const identification = rpgUnit.getIdentification();

            expect(identification.name).toBe('RPGUnit');
            expect(identification.version).toBe('5.1.0-beta.005');
            expect(identification.userManaged).toBe(true);
        });
    });

    describe('getRemoteState', () => {
        const installDirectory = '/some/dir';

        it('should return NotInstalled when product library does not exist', async () => {
            // Mock the method to allow overriding
            const getRemoteStateSpy = jest.spyOn(rpgUnit, 'getRemoteState');
            getRemoteStateSpy.mockRestore();  // Restore the original method

            (mockedConfiguration.Configuration.getOrFallback as jest.Mock).mockReturnValue('MYLIB');
            (mockContent.checkObject as jest.Mock).mockResolvedValue(false);

            const state = await rpgUnit.getRemoteState(mockConnection, installDirectory);

            expect(state).toBe('NotInstalled');
        });

        it('should return Installed when RPGUnit is properly installed with sufficient version', async () => {
            const getRemoteStateSpy = jest.spyOn(rpgUnit, 'getRemoteState');
            getRemoteStateSpy.mockRestore();  // Restore the original method

            (mockedConfiguration.Configuration.getOrFallback as jest.Mock).mockReturnValue('RPGUNIT');
            (mockContent.checkObject as jest.Mock).mockResolvedValue(true);
            (mockConnection.runCommand as jest.Mock).mockResolvedValue({
                code: 0,
                stdout: 'v5.2.0 some copyright info'
            });

            const state = await rpgUnit.getRemoteState(mockConnection, installDirectory);

            expect(state).toBe('Installed');
        });

        it('should return NeedsUpdate when installed version is below minimum', async () => {
            const getRemoteStateSpy = jest.spyOn(rpgUnit, 'getRemoteState');
            getRemoteStateSpy.mockRestore();  // Restore the original method

            (mockedConfiguration.Configuration.getOrFallback as jest.Mock).mockReturnValue('RPGUNIT');
            (mockContent.checkObject as jest.Mock).mockResolvedValue(true);
            (mockConnection.runCommand as jest.Mock).mockResolvedValue({
                code: 0,
                stdout: 'v4.0.0 some copyright info'
            });

            const state = await rpgUnit.getRemoteState(mockConnection, installDirectory);

            expect(state).toBe('NeedsUpdate');
        });

        it('should return NeedsUpdate when version parsing fails', async () => {
            const getRemoteStateSpy = jest.spyOn(rpgUnit, 'getRemoteState');
            getRemoteStateSpy.mockRestore();  // Restore the original method

            (mockedConfiguration.Configuration.getOrFallback as jest.Mock).mockReturnValue('RPGUNIT');
            (mockContent.checkObject as jest.Mock).mockResolvedValue(true);
            (mockConnection.runCommand as jest.Mock).mockResolvedValue({
                code: 0,
                stdout: 'invalid output without version'
            });

            const state = await rpgUnit.getRemoteState(mockConnection, installDirectory);

            expect(state).toBe('NeedsUpdate');
        });

        it('should return NeedsUpdate when command execution fails', async () => {
            const getRemoteStateSpy = jest.spyOn(rpgUnit, 'getRemoteState');
            getRemoteStateSpy.mockRestore();  // Restore the original method

            (mockedConfiguration.Configuration.getOrFallback as jest.Mock).mockReturnValue('RPGUNIT');
            (mockContent.checkObject as jest.Mock).mockResolvedValue(true);
            (mockConnection.runCommand as jest.Mock).mockResolvedValue({
                code: 1,
                stderr: 'Error occurred'
            });

            const state = await rpgUnit.getRemoteState(mockConnection, installDirectory);

            expect(state).toBe('NeedsUpdate');
        });

        it('should return Error when an exception occurs', async () => {
            const getRemoteStateSpy = jest.spyOn(rpgUnit, 'getRemoteState');
            getRemoteStateSpy.mockRestore();  // Restore the original method

            (mockedConfiguration.Configuration.getOrFallback as jest.Mock).mockReturnValue('RPGUNIT');
            (mockContent.checkObject as jest.Mock).mockRejectedValue(new Error('Network error'));

            const state = await rpgUnit.getRemoteState(mockConnection, installDirectory);

            expect(state).toBe('Error');
        });
    });

    describe('compareVersions', () => {
        it('should correctly compare two regular versions', async () => {
            const result = await rpgUnit.compareVersions('5.2.0', '5.1.0');
            
            expect(result).toBeGreaterThan(0); // 5.2.0 > 5.1.0
        });

        it('should correctly compare beta versions', async () => {
            const result = await rpgUnit.compareVersions('5.1.9b001', '5.1.9-beta.002');
            
            expect(result).toBeLessThan(0); // 5.1.9b001 < 5.1.9-beta.002
        });

        it('should correctly handle version prefixes', async () => {
            const result = await rpgUnit.compareVersions('v5.2.0', 'v5.1.0');
            
            expect(result).toBeGreaterThan(0); // v5.2.0 > v5.1.0
        });

        it('should handle production suffix removal', async () => {
            const result = await rpgUnit.compareVersions('5.2.0.r', '5.1.0');
            
            expect(result).toBeGreaterThan(0); // 5.2.0.r > 5.1.0 (after removing .r)
        });

        it('should handle error case', async () => {
            const result = await rpgUnit.compareVersions('invalid', '5.1.0');
            
            expect(result).toBe(-1); // Should return -1 on error
        });
    });

    describe('update', () => {
        const installDirectory = '/some/dir';

        it('should return current state when no releases are found', async () => {
            const getRemoteStateSpy = jest.spyOn(rpgUnit, 'getRemoteState');
            const compareVersionsSpy = jest.spyOn(rpgUnit, 'compareVersions');

            (mockedGitHub.GitHub.getReleases as jest.Mock).mockResolvedValue({
                error: 'No releases found'
            });

            getRemoteStateSpy.mockResolvedValue('NotInstalled' as ComponentState);
            compareVersionsSpy.mockResolvedValue(Promise.resolve(0)); // Version comparison returns 0

            const state = await rpgUnit.update(mockConnection, installDirectory);

            expect(state).toBe('NotInstalled');
        });

        it('should return current state when no supported releases are available', async () => {
            const getRemoteStateSpy = jest.spyOn(rpgUnit, 'getRemoteState');
            const compareVersionsSpy = jest.spyOn(rpgUnit, 'compareVersions');

            (mockedGitHub.GitHub.getReleases as jest.Mock).mockResolvedValue({
                data: [{
                    name: 'v4.0.0',
                    tag_name: 'v4.0.0',
                    draft: false,
                    assets: [{ name: 'rpgunit.savf' }],
                    prerelease: false,
                    published_at: '2023-01-01T00:00:00Z'
                }]
            });

            getRemoteStateSpy.mockResolvedValue('NotInstalled' as ComponentState);
            compareVersionsSpy.mockResolvedValue(Promise.resolve(-1)); // Version comparison returns -1

            const state = await rpgUnit.update(mockConnection, installDirectory);

            expect(state).toBe('NotInstalled');
        });

        it('should abort installation when user does not select release', async () => {
            const getRemoteStateSpy = jest.spyOn(rpgUnit, 'getRemoteState');
            const compareVersionsSpy = jest.spyOn(rpgUnit, 'compareVersions');

            (mockedGitHub.GitHub.getReleases as jest.Mock).mockResolvedValue({
                data: [{
                    name: 'v5.2.0',
                    tag_name: 'v5.2.0',
                    draft: false,
                    assets: [{ name: 'rpgunit.savf' }],
                    prerelease: false,
                    published_at: '2023-01-01T00:00:00Z'
                }]
            });

            getRemoteStateSpy.mockResolvedValue('NotInstalled' as ComponentState);
            compareVersionsSpy.mockResolvedValue(Promise.resolve(0)); // Equal versions
            (mockedVSCode.window.showQuickPick as jest.Mock).mockResolvedValue(null); // No selection

            const state = await rpgUnit.update(mockConnection, installDirectory);

            expect(state).toBe('NotInstalled');
        });

        it('should proceed with installation when all conditions are met', async () => {
            // Mock all the necessary responses for a successful installation
            const getRemoteStateSpy = jest.spyOn(rpgUnit, 'getRemoteState');
            const compareVersionsSpy = jest.spyOn(rpgUnit, 'compareVersions');

            (mockedGitHub.GitHub.getReleases as jest.Mock).mockResolvedValue({
                data: [{
                    name: 'v5.2.0',
                    tag_name: 'v5.2.0',
                    draft: false,
                    assets: [{ name: 'rpgunit.savf', browser_download_url: 'https://example.com/rpgunit.savf' }],
                    prerelease: false,
                    published_at: '2023-01-01T00:00:00Z'
                }]
            });

            getRemoteStateSpy
              .mockResolvedValueOnce('NotInstalled' as ComponentState) // First call in update method
              .mockResolvedValueOnce('Installed' as ComponentState); // Second call after installation

            compareVersionsSpy.mockResolvedValue(Promise.resolve(0)); // Equal versions
            (mockedVSCode.window.showQuickPick as jest.Mock).mockResolvedValue({
                label: 'v5.2.0',
                release: {
                    name: 'v5.2.0',
                    tag_name: 'v5.2.0',
                    draft: false,
                    assets: [{ name: 'rpgunit.savf', browser_download_url: 'https://example.com/rpgunit.savf' }],
                    prerelease: false,
                    published_at: '2023-01-01T00:00:00Z'
                }
            });

            // Mock library checks and operations
            (mockedConfiguration.Configuration.getOrFallback as jest.Mock).mockReturnValue('RPGUNIT');
            (mockContent.checkObject as jest.Mock).mockResolvedValue(false); // Library doesn't exist initially
            (mockedGitHub.GitHub.downloadReleaseAsset as jest.Mock).mockResolvedValue({
                data: true
            });

            (mockConnection.runCommand as jest.Mock)
                .mockResolvedValueOnce({ code: 0 }) // CRTSAVF command
                .mockResolvedValueOnce({ code: 0 }) // CPYFRMSTMF command
                .mockResolvedValueOnce({ code: 0 }); // RSTLIB command

            const state = await rpgUnit.update(mockConnection, installDirectory);

            expect(state).toBe('Installed');
        });
    });

    describe('checkInstallation', () => {
        let mockConnection: any;
        let mockComponentManager: any;
        let mockIBMiInstance: any;

        beforeEach(() => {
            jest.spyOn(rpgUnit, 'getRemoteState').mockResolvedValue('Installed');

            mockComponentManager = {
                getRemoteState: jest.fn().mockResolvedValue('Installed'),
                installComponent: jest.fn()
            };

            mockConnection = {
                getComponentManager: jest.fn().mockReturnValue(mockComponentManager),
                upperCaseName: jest.fn().mockReturnValue('RPGUNIT')
            };

            mockIBMiInstance = {
                getConnection: jest.fn().mockReturnValue(mockConnection)
            };

            (require('../extensions/ibmi').getInstance as jest.Mock).mockReturnValue(mockIBMiInstance);
        });

        afterEach(() => {
            jest.restoreAllMocks();
        });

        it('should return status true when component is installed', async () => {
            const result = await RPGUnit.checkInstallation();

            expect(result.status).toBe(true);
            expect(result.error).toBeUndefined();
        });

        it('should handle case when component needs update', async () => {
            mockConnection.getComponentManager().getRemoteState.mockResolvedValue('NeedsUpdate');

            const result = await RPGUnit.checkInstallation();

            expect(result.status).toBe(false);
            expect(result.error).toBeDefined();
        });

        it('should handle case when component is not installed', async () => {
            mockConnection.getComponentManager().getRemoteState.mockResolvedValue('NotInstalled');

            const result = await RPGUnit.checkInstallation();

            expect(result.status).toBe(false);
            expect(result.error).toBeDefined();
        });
    });
});