import { TestItem } from "vscode";
import { IBMiTestData } from "./manager";

export type TestQueue = { item: TestItem, data: IBMiTestData }[];

export interface TestStorage {
    RPGUNIT: string,
    CODECOV: string
};

interface TestRunMetrics {
    testFilesPassed: number,
    testFilesFailed: number,
    testFilesErroed: number,
    testsPassed: number,
    testsFailed: number,
    testsErrored: number,
    duration: number
}

export type CompilationStatus = 'success' | 'failed' | 'skipped';
export type TestStatus = 'passed' | 'failed' | 'errored';

export interface TestCaseMetrics {
    assertions: number,
    time: number
}

export interface TestingConfig {
    RUCRTRPG?: RUCRTRPG,
    RUCRTCBL?: RUCRTCBL
}

export interface RUCRTRPG {
    tstPgm: string,
    srcFile?: string,
    srcMbr?: string,
    srcStmf?: string,
    text?: string,
    cOption?: string,
    dbgView?: string,
    bndSrvPgm?: string,
    bndDir?: string,
    bOption?: string,
    define?: string,
    dltSplf?: string,
    actGrp?: string,
    module?: string,
    rpgPpOpt?: string,
    option?: string,
    compileOpt?: string,
    tgtRls?: string
    incDir?: string,
    tgtCcsid?: string
}

export interface RUCRTCBL {
    tstPgm: string,
    srcFile?: string,
    srcMbr?: string,
    srcStmf?: string,
    text?: string,
    cOption?: string,
    dbgView?: string,
    bndSrvPgm?: string,
    bndDir?: string,
    bOption?: string,
    define?: string,
    dltSplf?: string,
    actGrp?: string,
    module?: string,
    option?: string,
    compileOpt?: string,
    tgtRls?: string
    incDir?: string,
    tgtCcsid?: string
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