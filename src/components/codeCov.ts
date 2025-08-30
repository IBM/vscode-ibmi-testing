import { ComponentIdentification, ComponentState, IBMiComponent } from "vscode-ibmi/src/api/components/component";
import IBMi from "vscode-ibmi/src/api/IBMi";
import { LogLevel } from "vscode";
import { testOutputLogger } from "../extension";

export class CodeCov implements IBMiComponent {
    static ID: string = "CODECOV";
    static MINIMUM_VERSION = "1.0.0";

    getIdentification(): ComponentIdentification {
        return {
            name: CodeCov.ID,
            version: CodeCov.MINIMUM_VERSION
        };
    }

    async getRemoteState(connection: IBMi, installDirectory: string): Promise<ComponentState> {
        const content = connection.getContent();

        try {
            // Check if CODECOV command exists
            const library = 'QDEVTOOLS';
            const command = 'CODECOV';
            const commandExists = await content.checkObject({ library: library, name: command, type: '*CMD' });
            if (commandExists) {
                return "Installed";
            } else {
                await testOutputLogger.log(LogLevel.Error, `${command} command not found in ${library}.LIB`);
                return 'NotInstalled';
            }
        } catch (error) {
            await testOutputLogger.log(LogLevel.Error, `Failed to get remote state of CODECOV component. Error: ${error}`);
            return 'Error';
        }
    }

    update(connection: IBMi, installDirectory: string): Promise<ComponentState> {
        return this.getRemoteState(connection, installDirectory);
    }
}