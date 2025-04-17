import { ConfigurationTarget, LogLevel, workspace } from "vscode";
import { Logger } from "./outputChannel";

export enum Section {
    runOrder = 'runOrder',
    libraryList = 'libraryList',
    jobDescription = 'jobDescription',
    jobDescriptionLibrary = 'jobDescriptionLibrary',
    reportDetail = 'reportDetail',
    createReport = 'createReport',
    reclaimResources = 'reclaimResources',
    productLibrary = 'productLibrary'
}

export const defaultConfigurations: { [T in Section]: string } = {
    [Section.runOrder]: '*API',
    [Section.libraryList]: '*CURRENT',
    [Section.jobDescription]: '*DFT',
    [Section.jobDescriptionLibrary]: '',
    [Section.reportDetail]: '*BASIC',
    [Section.createReport]: '*ALLWAYS',
    [Section.reclaimResources]: '*NO',
    [Section.productLibrary]: 'RPGUNIT'
};

export namespace Configuration {
    export const group: string = 'vscode-ibmi-testing';

    export async function initialize(): Promise<void> {
        const configurations: { [key: string]: string } = {};

        for (const section of Object.values(Section)) {
            let value = Configuration.get<string>(section);
            if (!value) {
                value = defaultConfigurations[section];
                await Configuration.set(section, value);
            }

            configurations[section] = value;
        }

        Logger.log(LogLevel.Info, `Detected configurations:\n${JSON.stringify(configurations, null, 2)}`);
    }

    export function get<T>(section: Section): T | undefined {
        return workspace.getConfiguration(Configuration.group).get(section) as T;
    }

    export async function set(section: Section, value: any): Promise<void> {
        return await workspace.getConfiguration(Configuration.group).update(section, value, ConfigurationTarget.Global);
    }
}