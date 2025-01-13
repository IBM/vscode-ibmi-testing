export interface RUCRTRPG {
    TSTPGM: string,
    SRCFILE: string,
    SRCMBR: string,
    TEXT?: string,
    COPTION?: string,
    DBGVIEW?: string,
    BNDSRVPGM?: string,
    BNDDIR?: string,
    BOPTION?: string,
    DEFINE?: string,
    DLTSPLF?: string,
    ACTGRP?: string,
    MODULE?: string,
    RPGPPOPT?: string,
    POPTION?: string,
    COMPILEOPT?: string,
    TGTRLS?: string,
}

export interface RUCALLTST {
    TSTPGM: string,
    TSTPRC?: string,
    ORDER?: string,
    DETAIL?: string,
    OUTPUT?: string,
    LIBL?: string,
    JOBD?: string,
    RCLRSC?: string,
    XMLSTMF: string
}