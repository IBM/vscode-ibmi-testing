import { ExtensionContext } from "vscode";

export interface IGlobalState {
    /**
     * Libraries that have been approved by the user for use with RPGUnit,
     * keyed by IBM i hostname. Stored as `{ '<host>': ['<productLibrary>', '<productLibrary>'] }`.
     */
    approvedLibraries: Record<string, string[]>;
}

const defaultGlobalState: IGlobalState = {
    approvedLibraries: {}
};

export class GlobalState {
    static readonly key = `vscode-ibmi-testing`;
    static context: ExtensionContext;

    static initialize(context: ExtensionContext) {
        GlobalState.context = context;
    }

    static get(): IGlobalState {
        return GlobalState.context.globalState.get<IGlobalState>(GlobalState.key, defaultGlobalState);
    }

    static async set(value: IGlobalState): Promise<void> {
        await GlobalState.context.globalState.update(GlobalState.key, value);
    }
}
