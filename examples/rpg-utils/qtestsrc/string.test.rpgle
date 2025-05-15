**free

ctl-opt nomain;

/include qrpgleref/string.rpgleinc
/include qinclude,TESTCASE

dcl-proc test_isPalindrome export;
  dcl-pi *n extproc(*dclcase) end-pi;

  nEqual(*on : isPalindrome(''));
  nEqual(*on : isPalindrome('AAA'));
  nEqual(*on : isPalindrome('123321'));
  nEqual(*off : isPalindrome('123123'));
  nEqual(*on : isPalindrome('^&**&^'));
end-proc;