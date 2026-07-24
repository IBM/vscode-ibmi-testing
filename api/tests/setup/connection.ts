import { ConnectionData } from "vscode-ibmi/src/api/types";
import IBMi, { ConnectionErrorCode } from "vscode-ibmi/src/api/IBMi";
import { extensionComponentRegistry } from "vscode-ibmi/src/api/components/manager";
import { Mapepire } from "vscode-ibmi/src/api/components/mapepire";
import { CodeForIStorage } from "vscode-ibmi/src/api/configuration/storage/CodeForIStorage";
import { JsonConfig, JsonStorage } from "./json";
import { TestEnv } from "./env";

const testStorage = new JsonStorage();
const testConfig = new JsonConfig();

export async function createConnection(reloadSettings?: boolean) {
  // Setup credentials
  const envVars = TestEnv.getEnvironmentVariables();
  const credentials: ConnectionData = {
    name: `${envVars.VITE_IBMI_USER}@${envVars.VITE_IBMI_HOST}`,
    host: envVars.VITE_IBMI_HOST,
    username: envVars.VITE_IBMI_USER,
    port: envVars.VITE_IBMI_SSH_PORT,
    password: envVars.VITE_IBMI_PASSWORD,
    privateKeyPath: envVars.VITE_IBMI_PRIVATE_KEY_PATH,
    passphrase: envVars.VITE_IBMI_PASSPHRASE
  };

  // Setup Code4i virtual storage and config
  IBMi.GlobalStorage = new CodeForIStorage(testStorage);
  IBMi.connectionManager.configMethod = testConfig;

  // Override temp library and IASP in Code4i config if set
  const tempLib = envVars.VITE_IBMI_TEMP_LIB;
  const iasp = envVars.VITE_IBMI_IASP;
  const config = await IBMi.connectionManager.load(credentials.name);
  let updateConfig = false;
  if (config.tempLibrary !== tempLib) {
    config.tempLibrary = tempLib;
    updateConfig = true;
  }
  if (config.iasp !== iasp) {
    config.iasp = iasp;
    updateConfig = true;
  }
  if (updateConfig) {
    await IBMi.connectionManager.update(config);
  }

  // Setup components
  const mapepire = new Mapepire(__dirname); // TODO: FIX
  const testingId = `testing`;
  extensionComponentRegistry.registerComponent(testingId, mapepire);

  // Connect to IBM i
  const connection = new IBMi();
  connection.appendOutput = async (data: string) => { };
  const result = await connection.connect(
    credentials,
    {
      callbacks: {
        message: (type: string, message: string) => { },
        progress: ({ message }: { message: string }) => { },
        inputBox: async (prompt: string, placeHolder: string, ignoreFocusOut: boolean) => {
          return undefined;
        },
        uiErrorHandler: async (connection: IBMi, error: ConnectionErrorCode, data?: any) => {
          return false;
        },
      },
      reloadServerSettings: reloadSettings,
      reconnecting: false
    }
  );
  if (!result.success) {
    throw new Error(`Failed to connect to IBM i${result.error ? `: ${result.error}` : '!'}`);
  }

  return connection;
}

export async function disposeConnection(connection?: IBMi) {
  if (connection) {
    await connection.disconnect();
    testStorage.save();
    testConfig.save();
  }
}