import { ExtensionContext, workspace, ConfigurationChangeEvent, LogLevel } from 'vscode';

// Mock the dependencies at the top to intercept them before the extension loads
jest.mock('./loggers/testOutputLogger', () => ({
  TestOutputLogger: jest.fn().mockImplementation(() => ({
    log: jest.fn().mockResolvedValue(Promise.resolve()),
    logOutputChannel: { appendLine: jest.fn(), dispose: jest.fn() },
    append: jest.fn(),
    appendWithNotification: jest.fn(),
    show: jest.fn(),
  }))
}));

jest.mock('./manager', () => ({
  IBMiTestManager: jest.fn().mockImplementation(() => ({
    controller: { dispose: jest.fn() },
    refreshTests: jest.fn()
  }))
}));

jest.mock('./extensions/ibmi', () => ({
  loadBase: jest.fn(),
  getInstance: jest.fn(() => ({
    subscribe: jest.fn(),
    getConnection: jest.fn()
  })),
  getComponentRegistry: jest.fn(() => ({
    registerComponent: jest.fn()
  }))
}));

jest.mock('./configuration', () => {
  const actualConfig = jest.requireActual('./configuration');
  return {
    Configuration: {
      initialize: jest.fn(),
      group: 'testing',
    },
    Section: actualConfig.Section
  };
});

jest.mock('./components/rpgUnit', () => ({
  RPGUnit: jest.fn().mockImplementation(() => ({
    ID: 'rpgunit'
  }))
}));

jest.mock('./components/codeCov', () => ({
  CodeCov: jest.fn().mockImplementation(() => ({}))
}));

jest.mock('./codeActions/testStub', () => ({
  TestStubCodeActions: {
    registerTestStubCodeActions: jest.fn()
  }
}));

// Import after mocks
import { activate, deactivate } from './extension';

describe('Extension', () => {
  const mockExtensionContext: ExtensionContext = {
    extension: {
      packageJSON: {
        version: '1.0.0'
      }
    },
    subscriptions: [],
    asAbsolutePath: jest.fn(),
    globalState: {
      get: jest.fn(),
      update: jest.fn()
    },
    workspaceState: {
      get: jest.fn(),
      update: jest.fn()
    },
    secrets: {
      get: jest.fn(),
      store: jest.fn(),
      delete: jest.fn()
    },
    extensionUri: { fsPath: '/mock/extension/path' } as any,
    extensionPath: '/mock/extension/path',
    environmentVariableCollection: {
      replace: jest.fn(),
      append: jest.fn(),
      prepend: jest.fn(),
      get: jest.fn(),
      forEach: jest.fn(),
      delete: jest.fn(),
      clear: jest.fn()
    },
    storageUri: { fsPath: '/mock/storage/path' } as any,
    storagePath: '/mock/storage/path',
    globalStorageUri: { fsPath: '/mock/global/storage/path' } as any,
    globalStoragePath: '/mock/global/storage/path',
    logUri: { fsPath: '/mock/log/path' } as any,
    logPath: '/mock/log/path'
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('activate', () => {
    it('should initialize the extension correctly with core dependencies', async () => {
      // Mock the IBMi instance and connection
      const mockIBMiInstance = {
        subscribe: jest.fn(),
        getConnection: jest.fn().mockReturnValue(null)
      };
      
      (require('./extensions/ibmi').getInstance as jest.Mock).mockReturnValue(mockIBMiInstance);
      
      // Execute
      await activate(mockExtensionContext);
      
      // Verify basic initialization calls
      expect(require('./extensions/ibmi').loadBase).toHaveBeenCalled();
      expect(require('./extensions/ibmi').getInstance).toHaveBeenCalled();
      expect(require('./configuration').Configuration.initialize).toHaveBeenCalled();
      expect(require('./components/rpgUnit').RPGUnit).toHaveBeenCalled();
      expect(require('./components/codeCov').CodeCov).toHaveBeenCalled();
    });

    it('should register configuration change listeners', async () => {
      const mockIBMiInstance = {
        subscribe: jest.fn(),
        getConnection: jest.fn().mockReturnValue(null)
      };
      
      (require('./extensions/ibmi').getInstance as jest.Mock).mockReturnValue(mockIBMiInstance);
      
      // Execute
      await activate(mockExtensionContext);
      
      // Verify that workspace.onDidChangeConfiguration was called to set up listeners
      expect(workspace.onDidChangeConfiguration).toHaveBeenCalled();
      
      // Get the registered callback
      const configChangeCallback = (workspace.onDidChangeConfiguration as jest.Mock).mock.calls[0][0];
      expect(configChangeCallback).toBeDefined();
    });

    it('should handle configuration changes properly', async () => {
      const mockIBMiInstance = {
        subscribe: jest.fn(),
        getConnection: jest.fn().mockReturnValue(null)
      };
      
      (require('./extensions/ibmi').getInstance as jest.Mock).mockReturnValue(mockIBMiInstance);
      
      // Execute
      await activate(mockExtensionContext);
      
      // Create a mock configuration change event
      const mockEvent: ConfigurationChangeEvent = {
        affectsConfiguration: jest.fn().mockReturnValue(true)
      } as unknown as ConfigurationChangeEvent;
      
      // Get the registered callback and execute it
      const configChangeCallback = (workspace.onDidChangeConfiguration as jest.Mock).mock.calls[0][0];
      await configChangeCallback(mockEvent);
      
      // Verify that configuration was re-initialized
      expect(require('./configuration').Configuration.initialize).toHaveBeenCalledTimes(2);
    });

    it('should register to IBM i connect and disconnect events', async () => {
      const subscribeCallback = jest.fn();
      const mockIBMiInstance = {
        subscribe: jest.fn((context, event, name, callback) => {
          subscribeCallback(event, callback);
          return { dispose: jest.fn() };
        }),
        getConnection: jest.fn()
      };
      
      (require('./extensions/ibmi').getInstance as jest.Mock).mockReturnValue(mockIBMiInstance);
      
      // Execute
      await activate(mockExtensionContext);
      
      // Verify subscribe was called twice (for connected and disconnected)
      expect(mockIBMiInstance.subscribe).toHaveBeenCalledTimes(2);
      
      // Check the calls
      expect(mockIBMiInstance.subscribe).toHaveBeenCalledWith(
        mockExtensionContext,
        'connected',
        expect.any(String), // name
        expect.any(Function) // callback
      );
      expect(mockIBMiInstance.subscribe).toHaveBeenCalledWith(
        mockExtensionContext,
        'disconnected',
        expect.any(String), // name
        expect.any(Function) // callback
      );
    });

    it('should register components properly', async () => {
      const mockComponentRegistry = {
        registerComponent: jest.fn()
      };
      
      (require('./extensions/ibmi').getComponentRegistry as jest.Mock)
        .mockReturnValue(mockComponentRegistry);
      
      const mockIBMiInstance = {
        subscribe: jest.fn(),
        getConnection: jest.fn().mockReturnValue(null)
      };
      
      (require('./extensions/ibmi').getInstance as jest.Mock).mockReturnValue(mockIBMiInstance);
      
      // Execute
      await activate(mockExtensionContext);
      
      // Verify components were registered
      expect(mockComponentRegistry.registerComponent).toHaveBeenCalledTimes(2);
      expect(require('./components/rpgUnit').RPGUnit).toHaveBeenCalled();
      expect(require('./components/codeCov').CodeCov).toHaveBeenCalled();
    });
  });

  describe('deactivate', () => {
    it('should handle deactivation gracefully', async () => {
      // Mock the IBMi instance to make activation work
      const mockIBMiInstance = {
        subscribe: jest.fn(),
        getConnection: jest.fn().mockReturnValue(null)
      };
      
      (require('./extensions/ibmi').getInstance as jest.Mock).mockReturnValue(mockIBMiInstance);
      
      // Activate first to set up state
      await activate(mockExtensionContext);
      
      // Then deactivate - this should not throw errors
      await deactivate();
      
      // If we reach here, deactivation completed without errors
      expect(true).toBe(true);
    });
  });
});