import { CodeForIBMi } from "vscode-ibmi/src/typings";
import Instance from "vscode-ibmi/src/Instance";
import { ComponentRegistry } from "vscode-ibmi/src/api/components/manager";
import { DeployTools } from "vscode-ibmi/src/filesystems/local/deployTools";
import { VscodeTools } from "vscode-ibmi/src/ui/Tools";
import { Extension, extensions } from "vscode";

let baseExtension: Extension<CodeForIBMi> | undefined;

export function loadBase(): CodeForIBMi | undefined {
    if (!baseExtension) {
        baseExtension = (extensions ? extensions.getExtension(`halcyontechltd.code-for-ibmi`) : undefined);
    }

    return (baseExtension && baseExtension.isActive && baseExtension.exports ? baseExtension.exports : undefined);
}

export function getInstance(): Instance | undefined {
    return (baseExtension && baseExtension.isActive && baseExtension.exports ? baseExtension.exports.instance : undefined);
}

export function getDeployTools(): typeof DeployTools | undefined {
    return (baseExtension && baseExtension.isActive && baseExtension.exports ? baseExtension.exports.deployTools : undefined);
}

export function getVSCodeTools(): typeof VscodeTools | undefined {
    return (baseExtension && baseExtension.isActive && baseExtension.exports ? baseExtension.exports.tools : undefined);
}

export function getComponentRegistry(): ComponentRegistry | undefined {
    return (baseExtension && baseExtension.isActive && baseExtension.exports ? baseExtension.exports.componentRegistry : undefined);
}