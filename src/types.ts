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