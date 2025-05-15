**free

ctl-opt nomain;

dcl-proc isPalindrome export;
    dcl-pi *n ind;
        str varchar(30) const;
    end-pi;

    dcl-s i int(5);
    dcl-s new_str varchar(30);
    dcl-s alphnum varchar(62) inz('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789');
    dcl-s char_to_check char(1);
    dcl-s new_len int(5);
    dcl-s ispal ind inz(*off);

    for i = 1 to %len(str);
        char_to_check = %subst(str:i:1);
        if %check(alphnum: char_to_check) = 0;
            new_str = new_str + %lower(char_to_check);
        endif;
    endfor;

    new_len = %len(new_str);
    i = 1;
    dow (i < new_len) and (%subst(new_str:i:1) = %subst(new_str:new_len:1));
        i += 1;
        new_len -= 1;
    enddo;

    if i >= new_len;
        ispal = *on;
    endif;

    return ispal;
end-proc;