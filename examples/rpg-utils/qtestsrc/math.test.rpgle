**free

ctl-opt nomain;

/include qrpgleref/math.rpgleinc
/include qinclude,TESTCASE

dcl-proc test_factorial export;
    dcl-pi *n extproc(*dclcase) end-pi;

    iEqual(1 : factorial(0));
    iEqual(1 : factorial(1));
    iEqual(120 : factorial(5));
    iEqual(2432902008176640000 : factorial(20));
end-proc;

dcl-proc test_fibonacci export;
    dcl-pi *n extproc(*dclcase) end-pi;

    iEqual(0 : fibonacci(0));
    iEqual(1 : fibonacci(1));
    iEqual(1 : fibonacci(2));
    iEqual(5 : fibonacci(5));
    iEqual(55 : fibonacci(10));
    iEqual(832040 : fibonacci(30));
end-proc;

dcl-proc test_oddOrEven export;
    dcl-pi *n extproc(*dclcase) end-pi;

    aEqual('Even' : oddOrEven(0));
    aEqual('Odd' : oddOrEven(1));
    aEqual('Even' : oddOrEven(2));
    aEqual('Odd' : oddOrEven(-3));
    aEqual('Even' : oddOrEven(-4));
    aEqual('Odd' : oddOrEven(99999));
    aEqual('Even' : oddOrEven(100000));
end-proc;