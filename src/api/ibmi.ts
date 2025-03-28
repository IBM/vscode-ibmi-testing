import { CodeForIBMi } from "@halcyontech/vscode-ibmi-types";
import Instance from "@halcyontech/vscode-ibmi-types/Instance";
import { DeployTools } from "@halcyontech/vscode-ibmi-types/filesystems/local/deployTools";
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
