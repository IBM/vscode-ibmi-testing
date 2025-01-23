export interface RUCRTRPG {
    tstPgm: string,
    srcFile: string,
    srcMbr: string,
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
    pOption?: string,
    compileOpt?: string,
    tgtRls?: string,
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