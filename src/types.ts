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
    dltSplf?: string,
    actGrp?: string,
    module?: string,
    rpgPpOpt?: string,
    pOption?: string,
    compileOpt?: string,
    incDir?: string,
    tgtCcsid?: string,
}

export interface RUCRTCBL {
    // TODO: Implmement this
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