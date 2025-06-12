export enum LogLevel {
    Off = 0,
    Trace = 1,
    Debug = 2,
    Info = 3,
    Warning = 4,
    Error = 5
}

export interface Logger {
    append: (message: string) => Promise<void>;
    log: (level: LogLevel, message: string) => Promise<void>;
    logWithNotification: (level: LogLevel, message: string, details?: string, buttons?: { label: string, func: () => Promise<void> }[]) => Promise<void>;
}

export interface BasicUri {
    fsPath: string;
    scheme: 'file' | 'member' | 'streamfile';
    fragment: string;
}

export interface TestRequest {
    forceCompile: boolean;
    testBuckets: TestBucket[];
}

// Test bucket is a workspace folder, library, or IFS directory
export interface TestBucket {
    name: string;
    uri: BasicUri;
    testSuites: TestSuite[];
}

// Test suite is a local file, source member, or stream file
export interface TestSuite {
    name: string;
    systemName: string;
    uri: BasicUri;
    testCases: TestCase[];
    isCompiled: boolean;
    isEntireSuite: boolean;
    ccLvl?: '*LINE' | '*PROC'
    testingConfig?: TestingConfig;
}

// Test case is a test procedure
export interface TestCase {
    name: string;
    uri: BasicUri;
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

export type Env = Record<string, string>;

export type TestStatus = 'passed' | 'failed' | 'errored';

export type DeploymentStatus = 'success' | 'failed';

export type CompilationStatus = 'success' | 'failed' | 'skipped';

export type ExecutionStatus = 'passed' | 'failed' | 'errored';

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
    },
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

export interface TestingConfig {
    rpgunit?: {
        rucrtrpg?: RUCRTRPG & WrapperCmd,
        rucrtcbl?: RUCRTCBL & WrapperCmd
    },
    codecov?: CODECOV
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

export interface WrapperCmd {
    cmd?: string,
    params?: Record<string, string | number>
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
    module: string[],
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