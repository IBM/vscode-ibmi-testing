import { getInstance } from "./extensions/ibmi";
import { TestStorage } from "./types";

export namespace IBMiTestStorage {
    const TEST_OUTPUT_DIRECTORY: string = 'vscode-ibmi-testing';
    const RPGUNIT_DIRECTORY: string = `RPGUNIT`;
    const CODECOV_DIRECTORY: string = `CODECOV`;

    export async function setupTestStorage(): Promise<void> {
        // Setup test output directory
        const ibmi = getInstance();
        const connection = ibmi!.getConnection();
        const config = connection.getConfig();
        const testStorage = [
            `${config.tempDir}/${TEST_OUTPUT_DIRECTORY}/${RPGUNIT_DIRECTORY}`,
            `${config.tempDir}/${TEST_OUTPUT_DIRECTORY}/${CODECOV_DIRECTORY}`
        ];
        for (const storage of testStorage) {
            await connection.sendCommand({ command: `mkdir -p ${storage}` });
            await connection.sendCommand({ command: `chmod -R 777 ${storage}` });
        }
    }

    export function getTestStorage(prefix: string): TestStorage {
        const ibmi = getInstance();
        const connection = ibmi!.getConnection();
        const config = connection.getConfig();

        const time = new Date().getTime();

        return {
            RPGUNIT: `${config.tempDir}/${TEST_OUTPUT_DIRECTORY}/${RPGUNIT_DIRECTORY}/${prefix}_${time}.xml`,
            CODECOV: `${config.tempDir}/${TEST_OUTPUT_DIRECTORY}/${CODECOV_DIRECTORY}/${prefix}_${time}.cczip`
        };
    }
}