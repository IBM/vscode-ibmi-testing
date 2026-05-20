// Apply mocks before importing anything that uses them
jest.mock('vscode', () => ({
  workspace: {
    getConfiguration: jest.fn().mockReturnValue({
      get: jest.fn(),
      update: jest.fn()
    })
  },
  ConfigurationTarget: { Global: 'Global' },
  LogLevel: { Info: 'Info' }
}));

jest.mock('./extension', () => ({
  testOutputLogger: {
    log: jest.fn()
  }
}));

import { Configuration, Section, defaultConfigurations, TestStubPreferences, LibraryListValidation } from './configuration';

describe('Configuration Module', () => {
  let mockGet: jest.Mock;
  let mockUpdate: jest.Mock;
  let mockLog: jest.Mock;

  beforeEach(() => {
    // Get references to the mocked functions
    const vscodeMock = require('vscode');
    const extensionMock = require('./extension');
    
    const configObject = vscodeMock.workspace.getConfiguration();
    mockGet = configObject.get;
    mockUpdate = configObject.update;
    mockLog = extensionMock.testOutputLogger.log;
    
    jest.clearAllMocks();
  });

  describe('defaultConfigurations', () => {
    test('should have correct default values', () => {
      expect(defaultConfigurations[Section.productLibrary]).toBe('RPGUNIT');
      expect(defaultConfigurations[Section.testSourceFiles]).toEqual(['QTESTSRC']);
      expect(defaultConfigurations[Section.runOrder]).toBe('*API');
      expect(defaultConfigurations[Section.libraryList]).toBe('*CURRENT');
      
      // Check test stub preferences defaults
      const stubPrefs: TestStubPreferences = defaultConfigurations[Section.testStubPreferences] as TestStubPreferences;
      expect(stubPrefs['Show Test Stub Preview']).toBe(true);
      expect(stubPrefs['Test Source File']).toBe('QTESTSRC');
      expect(stubPrefs['Test Source Directory']).toBe('qtestsrc');
      expect(stubPrefs['Prompt For Test Name']).toBe(false);

      // Check library list validation defaults
      const libValidation: LibraryListValidation = defaultConfigurations[Section.libraryListValidation] as LibraryListValidation;
      expect(libValidation['RPGUNIT']).toBe(true);
      expect(libValidation['QDEVTOOLS']).toBe(true);
    });
  });

  describe('Configuration.get()', () => {
    test('should return the configuration value for a section', () => {
      const expectedValue = 'testValue';
      mockGet.mockReturnValue(expectedValue);

      const result = Configuration.get<string>(Section.productLibrary);
      
      expect(result).toBe(expectedValue);
      expect(mockGet).toHaveBeenCalledWith(Section.productLibrary);
    });

    test('should return undefined when configuration value is undefined', () => {
      mockGet.mockReturnValue(undefined);

      const result = Configuration.get<string>(Section.productLibrary);
      
      expect(result).toBeUndefined();
    });
  });

  describe('Configuration.getOrFallback()', () => {
    test('should return the actual configuration value when defined', () => {
      const actualValue = 'actualValue';
      mockGet.mockReturnValue(actualValue);

      const result = Configuration.getOrFallback<string>(Section.productLibrary);
      
      expect(result).toBe(actualValue);
    });

    test('should return the default value when configuration value is undefined', () => {
      mockGet.mockReturnValue(undefined);

      const result = Configuration.getOrFallback<string>(Section.productLibrary);
      
      expect(result).toBe(defaultConfigurations[Section.productLibrary]);
    });
  });

  describe('Configuration.set()', () => {
    test('should update configuration with the provided value', async () => {
      const section = Section.productLibrary;
      const value = 'newValue';
      
      await Configuration.set(section, value);
      
      expect(mockUpdate).toHaveBeenCalledWith(section, value, 'Global');
    });
  });

  describe('Configuration.initialize()', () => {
    test('should initialize configurations with default values when they are undefined', async () => {
      // Mock all configuration values as undefined to trigger default assignment
      mockGet.mockReturnValue(undefined);

      await Configuration.initialize();

      // Check that all sections were set with their default values
      for (const section of Object.values(Section)) {
        expect(mockUpdate).toHaveBeenCalledWith(
          section,
          defaultConfigurations[section],
          'Global'
        );
      }

      // Verify logging was called
      expect(mockLog).toHaveBeenCalledWith(
        'Info',
        expect.stringContaining('Detected configurations')
      );
    });

    test('should initialize configurations with default values when arrays are empty', async () => {
      // Mock an empty array to trigger default assignment
      mockGet.mockReturnValue([]);

      await Configuration.initialize();

      // Check that at least one section was set with its default value for empty arrays
      expect(mockUpdate).toHaveBeenCalledWith(
        Section.testSourceFiles,
        defaultConfigurations[Section.testSourceFiles],
        'Global'
      );
    });

    test('should use existing configuration values when they are defined', async () => {
      const customValue = 'customValue';
      mockGet.mockReturnValue(customValue);

      await Configuration.initialize();

      // Should not call update when value is already defined
      expect(mockUpdate).not.toHaveBeenCalledWith(
        Section.productLibrary,
        defaultConfigurations[Section.productLibrary],
        'Global'
      );
    });
  });

  describe('Configuration namespace', () => {
    test('should have correct group name', () => {
      expect(Configuration.group).toBe('IBM i Testing');
    });
  });
});