import { ComponentIdentification, ComponentState, IBMiComponent } from "@halcyontech/vscode-ibmi-types/api/components/component";
import IBMi from "@halcyontech/vscode-ibmi-types/api/IBMi";
import { LogLevel } from "vscode";
import { Logger } from "../logger";

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
                Logger.log(LogLevel.Error, `${command} command not found in ${library}.LIB`);
                return 'NotInstalled';
            }
        } catch (error) {
            Logger.log(LogLevel.Error, `Failed to get remote state of CODECOV component. Error: ${error}`);
            return 'Error';
        }
    }

    async update(connection: IBMi, installDirectory: string): Promise<ComponentState> {
        const state = await this.getRemoteState(connection, installDirectory);
        return state;
    }
}