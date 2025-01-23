import { ConfigurationTarget, workspace } from "vscode";

export enum Section {
    runOrder = 'runOrder',
    libraryList = 'libraryList',
    jobDescription = 'jobDescription',
    jobDescriptionLibrary = 'jobDescriptionLibrary',
    reportDetail = 'reportDetail',
    createReport = 'createReport',
    reclaimResources = 'reclaimResources',
    xmlStreamFile = 'xmlStreamFile',
    productLibrary = 'productLibrary'
}

export const defaults: { [T in Section]: string } = {
    [Section.runOrder]: '*API',
    [Section.libraryList]: '*CURRENT',
    [Section.jobDescription]: '*DFT',
    [Section.jobDescriptionLibrary]: '',
    [Section.reportDetail]: '*BASIC',
    [Section.createReport]: '*ALWAYS',
    [Section.reclaimResources]: '*NO',
    [Section.xmlStreamFile]: '/tmp/iRPGUnit_<TSTPGM>-%F.%T.log',
    [Section.productLibrary]: '*LIBL'
};

export namespace Configurations {
    export const group: string = 'vscode-ibmi-testing';

    export async function initialize(): Promise<void> {
        for (const section of Object.values(Section)) {
            const value = Configurations.get<string>(section);
            if (!value) {
                await Configurations.set(section, defaults[section]);
            }
        }
    }

    export function get<T>(section: Section): T | undefined {
        return workspace.getConfiguration(Configurations.group).get(section) as T;
    }

    export async function set(section: Section, value: any): Promise<void> {
        return await workspace.getConfiguration(Configurations.group).update(section, value, ConfigurationTarget.Global);
    }
}