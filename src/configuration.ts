import { ConfigurationTarget, LogLevel, workspace } from "vscode";
import { testOutputLogger } from "./extension";

export interface TestStubPreferences {
    "Show Test Stub Preview": boolean;
    "Test Source File": string;
    "Test Source Directory": string;
    "Prompt For Test Name": boolean;
    "Add Control Options and Directives": boolean;
    "Add Includes": boolean;
    "Add Prototypes": boolean;
    "Add Stub Comments": boolean;
}

export interface LibraryListValidation {
    "RPGUNIT": boolean;
    "QDEVTOOLS": boolean;
}

type ValueType = string | string[] | TestStubPreferences | LibraryListValidation;

export enum Section {
    productLibrary = 'productLibrary',
    testSourceFiles = 'testSourceFiles',
    testStubPreferences = 'testStubPreferences',
    libraryListValidation = 'libraryListValidation',
    runOrder = 'runOrder',
    libraryList = 'libraryList',
    jobDescription = 'jobDescription',
    reportDetail = 'reportDetail',
    createReport = 'createReport',
    reclaimResources = 'reclaimResources',
    onFailure = 'onFailure'
}

export const defaultConfigurations: { [T in Section]: ValueType } = {
    [Section.productLibrary]: 'RPGUNIT',
    [Section.testSourceFiles]: ['QTESTSRC'],
    [Section.testStubPreferences]: {
        "Show Test Stub Preview": true,
        "Test Source File": "QTESTSRC",
        "Test Source Directory": "qtestsrc",
        "Prompt For Test Name": false,
        "Add Control Options and Directives": true,
        "Add Includes": true,
        "Add Prototypes": true,
        "Add Stub Comments": false
    },
    [Section.libraryListValidation]: {
        "RPGUNIT": true,
        "QDEVTOOLS": true
    },
    [Section.runOrder]: '*API',
    [Section.libraryList]: '*CURRENT',
    [Section.jobDescription]: '*DFT',
    [Section.reportDetail]: '*BASIC',
    [Section.createReport]: '*ALLWAYS',
    [Section.reclaimResources]: '*NO',
    [Section.onFailure]: '*ABORT',
};

export namespace Configuration {
    export const group: string = 'IBM i Testing';

    export async function initialize(): Promise<void> {
        const configurations: { [key: string]: ValueType } = {};

        for (const section of Object.values(Section)) {
            let value = Configuration.get<ValueType>(section);
            if (value === undefined || (Array.isArray(value) && value.length === 0)) {
                value = defaultConfigurations[section];
                await Configuration.set(section, value);
            }

            configurations[section] = value;
        }

        await testOutputLogger.log(LogLevel.Info, `Detected configurations:\n${JSON.stringify(configurations, null, 2)}`);
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