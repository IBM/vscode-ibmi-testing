import IBMi from "vscode-ibmi/src/api/IBMi";
import { TestStorage } from "./types";
import { getVSCodeTools } from "../src/extensions/ibmi";

export namespace IBMiTestStorage {
    const TEST_OUTPUT_DIRECTORY: string = 'vscode-ibmi-testing';
    const RPGUNIT_DIRECTORY: string = `RPGUNIT`;
    const CODECOV_DIRECTORY: string = `CODECOV`;

    export async function setupTestStorage(connection: IBMi): Promise<void> {
        // Setup test output directory
        const config = connection.getConfig();
        const vsCodeTools = getVSCodeTools();
        const tempDir = vsCodeTools!.ensureFullPath(config.tempDir, config.homeDirectory);
        const testStorage = [
            `${tempDir}/${TEST_OUTPUT_DIRECTORY}/${RPGUNIT_DIRECTORY}`,
            `${tempDir}/${TEST_OUTPUT_DIRECTORY}/${CODECOV_DIRECTORY}`
        ];
        for (const storage of testStorage) {
            await connection.sendCommand({ command: `mkdir -p ${storage}` });
            await connection.sendCommand({ command: `chmod -R 777 ${storage}` });
        }
    }

    export function getTestStorage(connection: IBMi, prefix: string): TestStorage {
        const config = connection.getConfig();
        const vsCodeTools = getVSCodeTools();
        const tempDir = vsCodeTools!.ensureFullPath(config.tempDir, config.homeDirectory);

        const time = new Date().getTime();

        return {
            RPGUNIT: `${tempDir}/${TEST_OUTPUT_DIRECTORY}/${RPGUNIT_DIRECTORY}/${prefix}-%F.%T.<MSECONDS>.xml`,
            CODECOV: `${tempDir}/${TEST_OUTPUT_DIRECTORY}/${CODECOV_DIRECTORY}/${prefix}_${time}.cczip`
        };
    }
}