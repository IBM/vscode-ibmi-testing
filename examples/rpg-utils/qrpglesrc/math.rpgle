**free

ctl-opt nomain;

dcl-proc factorial export;
    dcl-pi factorial int(20);
        n int(3) const;
    end-pi;

    if (n = 0);
        return 1;
    else;
        return n * factorial(n-1);
    endif;
end-proc;

dcl-proc fibonacci export;
    dcl-pi fibonacci int(20);
        n int(3) const;
    end-pi;

    if (n = 0) or (n = 1);
        return n;
    endif;

    return fibonacci(n - 1) + fibonacci(n - 2);
end-proc;

dcl-proc oddOrEven export;
    dcl-pi *n varchar(4);
        num int(10) const;
    end-pi;

    if %rem(num:2) = 0;
        return 'Even';
    else;
        return 'Odd';
    endif;
end-proc;