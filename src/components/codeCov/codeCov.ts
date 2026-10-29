import { ComponentIdentification, IBMiComponent, SecureComponentState } from "@halcyontech/vscode-ibmi-types/api/components/component";
import IBMi from "@halcyontech/vscode-ibmi-types/api/IBMi";
import { LogLevel } from "vscode";
import { testOutputLogger } from "../../extension";
import { CodeCovInfo } from "./info";

export class CodeCov implements IBMiComponent {
    getIdentification(): ComponentIdentification {
        return {
            name: CodeCovInfo.COMMAND,
            version: CodeCovInfo.MINIMUM_VERSION
        } as any;
    }

    async getRemoteState(connection: IBMi, installDirectory: string): Promise<SecureComponentState> {
        const content = connection.getContent();

        const command = CodeCovInfo.COMMAND;
        try {
            // Check if CODECOV command exists
            const library = CodeCovInfo.LIBRARY;
            const commandExists = await content.checkObject({ library: library, name: command, type: '*CMD' });
            if (commandExists) {
                return { status: `Installed` };
            } else {
                await testOutputLogger.log(LogLevel.Error, `${command} command not found in ${library}.LIB`);
                return { status: `NotInstalled` };
            }
        } catch (error) {
            await testOutputLogger.log(LogLevel.Error, `Failed to get remote state of ${command} component. Error: ${error}`);
            return { status: `Error` };
        }
    }

    update(connection: IBMi, installDirectory: string): Promise<SecureComponentState> {
        return this.getRemoteState(connection, installDirectory);
    }
}