import { ConfigurationTarget, LogLevel, workspace } from "vscode";
import { Logger } from "./logger";

export enum Section {
    productLibrary = 'productLibrary',
    testSourceFiles = 'testSourceFiles',
    runOrder = 'runOrder',
    libraryList = 'libraryList',
    jobDescription = 'jobDescription',
    jobDescriptionLibrary = 'jobDescriptionLibrary',
    reportDetail = 'reportDetail',
    createReport = 'createReport',
    reclaimResources = 'reclaimResources'
}

export const defaultConfigurations: { [T in Section]: string | string[] } = {
    [Section.productLibrary]: 'RPGUNIT',
    [Section.testSourceFiles]: ['QTESTSRC'],
    [Section.runOrder]: '*API',
    [Section.libraryList]: '*CURRENT',
    [Section.jobDescription]: '*DFT',
    [Section.jobDescriptionLibrary]: '',
    [Section.reportDetail]: '*BASIC',
    [Section.createReport]: '*ALLWAYS',
    [Section.reclaimResources]: '*NO'
};

export namespace Configuration {
    export const group: string = 'IBM i Testing';

    export async function initialize(): Promise<void> {
        const configurations: { [key: string]: string | string[] } = {};

        for (const section of Object.values(Section)) {
            let value = Configuration.get<string | string[]>(section);
            if (!value || (Array.isArray(value) && value.length === 0)) {
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

    export function getOrFallback<T>(section: Section): T {
        const value = get<T>(section);
        if (value === undefined) {
            return defaultConfigurations[section] as T;
        }

        return value;
    }

    export async function set(section: Section, value: any): Promise<void> {
        return await workspace.getConfiguration(Configuration.group).update(section, value, ConfigurationTarget.Global);
    }
}