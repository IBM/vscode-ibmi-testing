import { CodeForIBMi } from "@halcyontech/vscode-ibmi-types";
import Instance from "@halcyontech/vscode-ibmi-types/Instance";
import { ComponentRegistry } from "@halcyontech/vscode-ibmi-types/api/components/manager";
import { DeployTools } from "@halcyontech/vscode-ibmi-types/filesystems/local/deployTools";
import { VscodeTools } from "@halcyontech/vscode-ibmi-types/ui/Tools";
import { CustomUI } from "@halcyontech/vscode-ibmi-types/webviews/CustomUI";
import { FileError } from "@halcyontech/vscode-ibmi-types/api/types";
import { Extension, extensions } from "vscode";

// Mock the vscode module
jest.mock('vscode', () => ({
  extensions: {
    getExtension: jest.fn(),
  },
}));

describe('IBM i Extension Functions', () => {
  // Store original console.error to restore later
  const originalConsoleError = console.error;

  beforeEach(() => {
    // Suppress console.error during tests to avoid noise
    console.error = jest.fn();
    // Reset modules to clear the cached extension reference for each test
    jest.resetModules();
    // Clear any previous mocks to ensure fresh mocks each time
    jest.clearAllMocks();
  });

  afterEach(() => {
    // Restore original console.error
    console.error = originalConsoleError;
  });

  describe('loadBase', () => {
    it('should return undefined when extensions object is undefined', () => {
      // Mock extensions to return undefined
      const mockedVSCode = require('vscode');
      (mockedVSCode.extensions.getExtension as jest.Mock).mockReturnValue(undefined);

      const { loadBase } = require('./ibmi');
      const result = loadBase();

      expect(mockedVSCode.extensions.getExtension).toHaveBeenCalledWith('halcyontechltd.code-for-ibmi');
      expect(result).toBeUndefined();
    });

    it('should return undefined when extension is not active', () => {
      const mockExtension = {
        isActive: false,
        exports: {} as CodeForIBMi,
      } as Extension<CodeForIBMi>;

      // Mock extensions to return the inactive extension
      const mockedVSCode = require('vscode');
      (mockedVSCode.extensions.getExtension as jest.Mock).mockReturnValue(mockExtension);

      const { loadBase } = require('./ibmi');
      const result = loadBase();

      expect(result).toBeUndefined();
    });

    it('should return undefined when extension has no exports', () => {
      const mockExtension = {
        isActive: true,
        exports: undefined,
      } as unknown as Extension<CodeForIBMi>;

      // Mock extensions to return the extension with no exports
      const mockedVSCode = require('vscode');
      (mockedVSCode.extensions.getExtension as jest.Mock).mockReturnValue(mockExtension);

      const { loadBase } = require('./ibmi');
      const result = loadBase();

      expect(result).toBeUndefined();
    });

    it('should return exports when extension is properly loaded', () => {
      // Reset modules to clear the cached extension reference
      jest.resetModules();

      const mockInstance = {} as Instance;
      const mockTools = {} as typeof VscodeTools;
      const mockDeployTools = {} as typeof DeployTools;
      const mockComponentRegistry = {} as ComponentRegistry;
      const mockCustomUI = {} as () => CustomUI;
      const mockEvfeventParser = {} as (lines: string[]) => Map<string, FileError[]>;

      const mockCodeForIBMi = {
        instance: mockInstance,
        deployTools: mockDeployTools,
        tools: mockTools,
        componentRegistry: mockComponentRegistry,
        customUI: mockCustomUI,
        evfeventParser: mockEvfeventParser,
      } as CodeForIBMi;

      const mockExtension = {
        isActive: true,
        exports: mockCodeForIBMi,
      } as Extension<CodeForIBMi>;

      // Mock extensions to return the fully loaded extension
      const mockedVSCode = require('vscode');
      (mockedVSCode.extensions.getExtension as jest.Mock).mockReturnValue(mockExtension);

      const { loadBase } = require('./ibmi');
      const result = loadBase();

      expect(result).toEqual(mockCodeForIBMi);
    });

    it('should cache the extension after first call', () => {
      // Reset modules to clear the cached extension reference
      jest.resetModules();

      const mockInstance = {} as Instance;
      const mockTools = {} as typeof VscodeTools;
      const mockDeployTools = {} as typeof DeployTools;
      const mockComponentRegistry = {} as ComponentRegistry;
      const mockCustomUI = {} as () => CustomUI;
      const mockEvfeventParser = {} as (lines: string[]) => Map<string, FileError[]>;

      const mockCodeForIBMi = {
        instance: mockInstance,
        deployTools: mockDeployTools,
        tools: mockTools,
        componentRegistry: mockComponentRegistry,
        customUI: mockCustomUI,
        evfeventParser: mockEvfeventParser,
      } as CodeForIBMi;

      const mockExtension = {
        isActive: true,
        exports: mockCodeForIBMi,
      } as Extension<CodeForIBMi>;

      // Mock extensions to return the fully loaded extension
      const mockedVSCode = require('vscode');
      const getExtensionMock = mockedVSCode.extensions.getExtension as jest.Mock;
      getExtensionMock.mockReturnValue(mockExtension);

      const { loadBase } = require('./ibmi');

      // First call
      const result1 = loadBase();
      // Second call
      const result2 = loadBase();

      expect(getExtensionMock).toHaveBeenCalledTimes(1);
      expect(result1).toBe(result2);
    });
  });

  describe('getInstance', () => {
    it('should return undefined when base extension is not available', () => {
      // Reset modules to clear the cached extension reference
          
      
      // Mock extensions to return undefined
      const mockedVSCode = require('vscode');
      (mockedVSCode.extensions.getExtension as jest.Mock).mockReturnValue(undefined);

      const { getInstance } = require('./ibmi');
      const result = getInstance();

      expect(result).toBeUndefined();
    });

    it('should return instance from base extension when available', () => {
      // Reset modules to clear the cached extension reference
      jest.resetModules();

      const mockInstance = {} as Instance;
      const mockTools = {} as typeof VscodeTools;
      const mockDeployTools = {} as typeof DeployTools;
      const mockComponentRegistry = {} as ComponentRegistry;
      const mockCustomUI = {} as () => CustomUI;
      const mockEvfeventParser = {} as (lines: string[]) => Map<string, FileError[]>;

      const mockCodeForIBMi = {
        instance: mockInstance,
        deployTools: mockDeployTools,
        tools: mockTools,
        componentRegistry: mockComponentRegistry,
        customUI: mockCustomUI,
        evfeventParser: mockEvfeventParser,
      } as CodeForIBMi;

      const mockExtension = {
        isActive: true,
        exports: mockCodeForIBMi,
      } as Extension<CodeForIBMi>;

      // Mock extensions to return the fully loaded extension BEFORE requiring ibmi module
      const mockedVSCode = require('vscode');
      (mockedVSCode.extensions.getExtension as jest.Mock).mockReturnValue(mockExtension);

      // Now require the ibmi module to get the functions
      const { getInstance, loadBase } = require('./ibmi');
      // Call loadBase first to populate the extension cache
      loadBase();
      const result = getInstance();

      expect(result).toEqual(mockInstance);
    });
  });

  describe('getDeployTools', () => {
    it('should return undefined when base extension is not available', () => {
      // Reset modules to clear the cached extension reference
          
      
      // Mock extensions to return undefined
      const mockedVSCode = require('vscode');
      (mockedVSCode.extensions.getExtension as jest.Mock).mockReturnValue(undefined);

      const { getDeployTools } = require('./ibmi');
      const result = getDeployTools();

      expect(result).toBeUndefined();
    });

    it('should return deployTools from base extension when available', () => {
      // Reset modules to clear the cached extension reference
      jest.resetModules();

      const mockInstance = {} as Instance;
      const mockTools = {} as typeof VscodeTools;
      const mockDeployTools = {} as typeof DeployTools;
      const mockComponentRegistry = {} as ComponentRegistry;
      const mockCustomUI = {} as () => CustomUI;
      const mockEvfeventParser = {} as (lines: string[]) => Map<string, FileError[]>;

      const mockCodeForIBMi = {
        instance: mockInstance,
        deployTools: mockDeployTools,
        tools: mockTools,
        componentRegistry: mockComponentRegistry,
        customUI: mockCustomUI,
        evfeventParser: mockEvfeventParser,
      } as CodeForIBMi;

      const mockExtension = {
        isActive: true,
        exports: mockCodeForIBMi,
      } as Extension<CodeForIBMi>;

      // Mock extensions to return the fully loaded extension
      const mockedVSCode = require('vscode');
      (mockedVSCode.extensions.getExtension as jest.Mock).mockReturnValue(mockExtension);

      // Now require the ibmi module to get the functions
      const { getDeployTools, loadBase } = require('./ibmi');
      // Call loadBase first to populate the extension cache
      loadBase();
      const result = getDeployTools();

      expect(result).toEqual(mockDeployTools);
    });
  });

  describe('getVSCodeTools', () => {
    it('should return undefined when base extension is not available', () => {
      // Reset modules to clear the cached extension reference
          
      
      // Mock extensions to return undefined
      const mockedVSCode = require('vscode');
      (mockedVSCode.extensions.getExtension as jest.Mock).mockReturnValue(undefined);

      const { getVSCodeTools } = require('./ibmi');
      const result = getVSCodeTools();

      expect(result).toBeUndefined();
    });

    it('should return tools from base extension when available', () => {
      // Reset modules to clear the cached extension reference
      jest.resetModules();

      const mockInstance = {} as Instance;
      const mockTools = {} as typeof VscodeTools;
      const mockDeployTools = {} as typeof DeployTools;
      const mockComponentRegistry = {} as ComponentRegistry;
      const mockCustomUI = {} as () => CustomUI;
      const mockEvfeventParser = {} as (lines: string[]) => Map<string, FileError[]>;

      const mockCodeForIBMi = {
        instance: mockInstance,
        deployTools: mockDeployTools,
        tools: mockTools,
        componentRegistry: mockComponentRegistry,
        customUI: mockCustomUI,
        evfeventParser: mockEvfeventParser,
      } as CodeForIBMi;

      const mockExtension = {
        isActive: true,
        exports: mockCodeForIBMi,
      } as Extension<CodeForIBMi>;

      // Mock extensions to return the fully loaded extension
      const mockedVSCode = require('vscode');
      (mockedVSCode.extensions.getExtension as jest.Mock).mockReturnValue(mockExtension);

      // Now require the ibmi module to get the functions
      const { getVSCodeTools, loadBase } = require('./ibmi');
      // Call loadBase first to populate the extension cache
      loadBase();
      const result = getVSCodeTools();

      expect(result).toEqual(mockTools);
    });
  });

  describe('getComponentRegistry', () => {
    it('should return undefined when base extension is not available', () => {
      // Reset modules to clear the cached extension reference
          
      
      // Mock extensions to return undefined
      const mockedVSCode = require('vscode');
      (mockedVSCode.extensions.getExtension as jest.Mock).mockReturnValue(undefined);

      const { getComponentRegistry } = require('./ibmi');
      const result = getComponentRegistry();

      expect(result).toBeUndefined();
    });

    it('should return componentRegistry from base extension when available', () => {
      // Reset modules to clear the cached extension reference
      jest.resetModules();

      const mockInstance = {} as Instance;
      const mockTools = {} as typeof VscodeTools;
      const mockDeployTools = {} as typeof DeployTools;
      const mockComponentRegistry = {} as ComponentRegistry;
      const mockCustomUI = {} as () => CustomUI;
      const mockEvfeventParser = {} as (lines: string[]) => Map<string, FileError[]>;

      const mockCodeForIBMi = {
        instance: mockInstance,
        deployTools: mockDeployTools,
        tools: mockTools,
        componentRegistry: mockComponentRegistry,
        customUI: mockCustomUI,
        evfeventParser: mockEvfeventParser,
      } as CodeForIBMi;

      const mockExtension = {
        isActive: true,
        exports: mockCodeForIBMi,
      } as Extension<CodeForIBMi>;

      // Mock extensions to return the fully loaded extension
      const mockedVSCode = require('vscode');
      (mockedVSCode.extensions.getExtension as jest.Mock).mockReturnValue(mockExtension);

      // Now require the ibmi module to get the functions
      const { getComponentRegistry, loadBase } = require('./ibmi');
      // Call loadBase first to populate the extension cache
      loadBase();
      const result = getComponentRegistry();

      expect(result).toEqual(mockComponentRegistry);
    });
  });
});