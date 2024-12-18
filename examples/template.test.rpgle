**free
//=====================================================================
//  Empty Unit Test Case. Prints a protocol of the execution flow.
//=====================================================================
//  Command to create the service program:
//  RUCRTRPG TSTPGM(RPGUNIT/TEMPLATE) SRCFILE(RPGUNIT/QSRC)
//=====================================================================
//  Tools/400 STRPREPRC instructions:
//   >>PRE-COMPILER<<
//     >>CRTCMD<<  RUCRTRPG    TSTPGM(&LI/&OB) +
//                             SRCFILE(&SL/&SF) +
//                             SRCMBR(&SM);
//     >>COMPILE<<
//       >>PARM<< COPTION(*EVENTF);
//       >>PARM<< DBGVIEW(*LIST);
//       >>PARM<< BNDDIR(*N);
//     >>END-COMPILE<<
//     >>EXECUTE<<
//   >>END-PRE-COMPILER<<
//=====================================================================
//  Compile options:
//    *SrcStmt       - Assign SEU line numbers when compiling the
//                     source member. This option is required to
//                     position the LPEX editor to the line in error
//                     when the source member is opened from the
//                     RPGUnit view.
//    *NoDebugIO     - Do not generate breakpoints for input and
//                     output specifications. Optional but useful.
//=====================================================================
ctl-opt NoMain Option(*SrcStmt : *NoDebugIO);
dcl-f QSYSPRT printer(80) oflind(*in70) usropn;

/include qinclude,TESTCASE                  iRPGUnit Test Suite

/include qinclude,SDS                       Program status data structure

// ------------------------------------------------------------
//  Global type templates.
// ------------------------------------------------------------

dcl-ds sql_status_t qualified template;
  ignSQLWarn ind inz(*off);
end-ds;

// ------------------------------------------------------------
//  Global Program Status.
// ------------------------------------------------------------

dcl-ds g_status qualified;
  srcSeq int(10);
  srcSeq2 int(10);
  sql likeds(sql_status_t) inz(*likeds);
end-ds;

// ============================================================
//  Opens the printer.
// ============================================================
dcl-proc openPrinter;
  dcl-pi *n extproc(*dclcase) end-pi;

  open QSYSPRT;

end-proc;

// ============================================================
//  Prints a message.
// ============================================================
dcl-proc print;
  dcl-pi *n extproc(*dclcase);
    text varchar(128) value options(*nopass);
  end-pi;

  dcl-ds lineOutput len(80);
  end-ds;

  if (%parms() >= 1);
    lineOutput = text;
  else;
    lineOutput = '';
  endif;
  write QSYSPRT lineOutput;

end-proc;

// ============================================================
//  Closes the printer.
// ============================================================
dcl-proc closePrinter;
  dcl-pi *n extproc(*dclcase) end-pi;

  if (%open(QSYSPRT));
    close QSYSPRT;
  endif;

end-proc;

// ------------------------------------------------------------
//  Specifies whether SQL warnings are ignored when
//  calling isSQLError().
// ------------------------------------------------------------
dcl-proc setIgnSQLWarn;
  dcl-pi *n extproc(*dclcase);
    i_ignore ind const;
  end-pi;

  g_status.sql.ignSQLWarn = i_ignore;

end-proc;

// ------------------------------------------------------------
//  Returns *on, when the last SQL statement ended with an
//  error, else *off;
// ------------------------------------------------------------
dcl-proc isSQLError;
  dcl-pi *n ind extproc(*dclcase);
    i_state   char(5) const;
  end-pi;

  dcl-ds sqlState qualified;
    class char(2);
    qualifier char(3);
  end-ds;

  dcl-ds sql likeds(sql_status_t);

  sqlState = i_state;
  sql = g_status.sql;

  reset g_status.sql;

  select;
  // SQL code 00: Unqualified Successful Completion
  when (sqlState = '00000');
    // Execution of the operation was successful and did not
    // result in any type of warning or exception condition.
    return *off;

  // SQL code 01: Warning
  When (sqlState.class = '01');
    // Valid warning SQLSTATEs returned by an SQL routine.
    // Also used for RAISE_ERROR and SIGNAL.
    if (sql.ignSQLWarn);
      return *off;
    else;
      return *on;
    endif;

  // SQL code 02: No data
  When (sqlState = '02000');
    return *off;

  other;
    // Other problem or error
    return *on;
  endsl;

end-proc;

// ============================================================
//  Set up test suite. Executed once per RUCALLTST.
// ============================================================
dcl-proc setUpSuite export;
  dcl-pi *n extproc(*dclcase) end-pi;

  dcl-s rc char(1);

  runCmd('OVRPRTF FILE(QSYSPRT) TOFILE(*FILE) +
          SPLFNAME(PROC_FLOW) OVRSCOPE(*JOB)');
  monitor;
    openPrinter();
    print('Executing:   setUpSuite()');
  on-error;
  // ignore errors ...
  endmon;

  // ... but try to remove the override.
  monitor;
    runCmd('DLTOVR FILE(QSYSPRT) LVL(*JOB)');
  on-error;
    dsply '*** Failed to delete QSYSPRT override! ***' rc;
  endmon;

end-proc;

// ============================================================
//  Tear down test suite.
// ============================================================
dcl-proc tearDownSuite export;
  dcl-pi *n extproc(*dclcase) end-pi;

  print('Executing:   tearDownSuite()');
  closePrinter();

end-proc;

// ============================================================
//  Set up test case.
// ============================================================
dcl-proc setUp export;
  dcl-pi *n extproc(*dclcase) end-pi;

  print('Executing:   - setUp()');

end-proc;

// ============================================================
//  Tear down test case.
// ============================================================
dcl-proc tearDown export;
  dcl-pi *n extproc(*dclcase) end-pi;

  print('Executing:   - tearDown()');

end-proc;

// ============================================================
//  RPGUnit test case.
// ============================================================
dcl-proc testWhatever_1 export;
  dcl-pi *n extproc(*dclcase) end-pi;

  print('Executing:       * testWhatever_1()');

// Run
assert(sds.pgmName = 'TEMPLATE': 'Name of the test suite should be ''TEMPLATE''');

// Place your assertions here.

end-proc;

// ============================================================
//  RPGUnit test case.
// ============================================================
dcl-proc testWhatever_2 export;
  dcl-pi *n extproc(*dclcase) end-pi;

  print('Executing:       * testWhatever_2()');

// Run

// Place your assertions here.
assert(sds.excData = '': 'There should be no exception data in SDS');

end-proc;
