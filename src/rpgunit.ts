import { ComponentIdentification, ComponentState, IBMiComponent } from "@halcyontech/vscode-ibmi-types/api/components/component";
import IBMi from "@halcyontech/vscode-ibmi-types/api/IBMi";

export class RPGUnitComponent implements IBMiComponent {
    static ID: string = "RPGUnit";
    private readonly currentVersion: number = 1; // TODO: Set version here

    getIdentification(): ComponentIdentification {
        return {
            name: RPGUnitComponent.ID,
            version: this.currentVersion
        };
    }

    getRemoteState(connection: IBMi, installDirectory: string): ComponentState | Promise<ComponentState> {
        let installedVersion: number;

        try {
            installedVersion = 2;
        } catch (error) {
            return 'Error';
        }

        if (installedVersion) {
            if (installedVersion < this.currentVersion) {
                return 'NeedsUpdate';
            } else {
                return 'Installed';
            }
        } else {
            return 'NotInstalled';
        }
    }

    update(connection: IBMi, installDirectory: string): ComponentState | Promise<ComponentState> {
        throw new Error("Method not implemented.");
    }
}