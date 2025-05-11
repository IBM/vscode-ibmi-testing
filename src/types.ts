import { TestItem } from "vscode";
import { TestFile } from "./testFile";
import { TestCase } from "./testCase";
import { TestDirectory } from "./testDirectory";
import { TestObject } from "./testObject";

export type Env = Record<string, string>;

export type IBMiTestData = TestDirectory | TestObject | TestFile | TestCase;

export type TestQueue = { item: TestItem, data: TestFile | TestCase }[];

export type CompilationStatus = 'success' | 'failed' | 'skipped';

export type TestStatus = 'passed' | 'failed' | 'errored';

export interface TestStorage {
    RPGUNIT: string,
    CODECOV: string
};

export interface TestMetrics {
    duration: number,
    assertions: number,
    deployments: {
        success: number,
        failed: number
    }
    compilations: {
        success: number,
        failed: number,
        skipped: number
    },
    testFiles: {
        passed: number,
        failed: number,
        errored: number
    },
    testCases: {
        passed: number,
        failed: number,
        errored: number
    }
}

export interface TestCaseResult {
    name: string,
    status: TestStatus,
    time?: number,
    assertions?: number,
    failure?: {
        line?: number,
        message: string
    }[],
    error?: {
        line?: number,
        message: string
    }[]
}

export interface TestingConfig {
    RPGUnit?: {
        RUCRTRPG?: RUCRTRPG,
        RUCRTCBL?: RUCRTCBL
    }
}

export interface RUCRTRPG {
    tstPgm: string,
    srcFile?: string,
    srcMbr?: string,
    srcStmf?: string,
    text?: string,
    cOption?: string[],
    dbgView?: string,
    bndSrvPgm?: string[],
    bndDir?: string[],
    bOption?: string,
    define?: string[],
    dltSplf?: string,
    actGrp?: string,
    module?: string[],
    rpgPpOpt?: string,
    pOption?: string[],
    compileOpt?: string,
    tgtRls?: string
    incDir?: string[],
    tgtCcsid?: number
}

export interface RUCRTCBL {
    tstPgm: string,
    srcFile?: string,
    srcMbr?: string,
    srcStmf?: string,
    text?: string,
    cOption?: string[],
    dbgView?: string,
    bndSrvPgm?: string[],
    bndDir?: string[],
    bOption?: string,
    define?: string[],
    dltSplf?: string,
    actGrp?: string,
    module?: string[],
    pOption?: string[],
    compileOpt?: string,
    tgtRls?: string
    incDir?: string[],
    tgtCcsid?: number
}

export interface RUCALLTST {
    tstPgm: string,
    tstPrc?: string,
    order?: string,
    detail?: string,
    output?: string,
    libl?: string,
    jobD?: string,
    rclRsc?: string,
    xmlStmf: string
}

export interface CODECOV {
    cmd: string,
    module: string,
    ccLvl: string,
    ccView?: string,
    outDir?: string,
    outStmf: string,
    testId?: string
}

export interface CoverageData {
    basename: string,
    path: string,
    localPath: string,
    coverage: {
        signitures: string[],
        lineString: string,
        activeLines: { [key: number]: boolean },
        percentRan: string
    }
}