export const TEST_LIBRARY = `IBMITEST`;

export const CREATE_LIBRARY = `QSYS/CRTLIB LIB(${TEST_LIBRARY}) TEXT('IBM i Testing')`;

export const CREATE_DEPARTMENT_TABLE = `
CREATE OR REPLACE TABLE ${TEST_LIBRARY}.DEPARTMENT (
    DEPTNO    CHAR(3)           NOT NULL,
    DEPTNAME  VARCHAR(36)       NOT NULL,
    MGRNO     CHAR(6)           NOT NULL,
    ADMRDEPT  CHAR(3)           NOT NULL, 
    LOCATION  CHAR(16)          NOT NULL,
    PRIMARY KEY (DEPTNO)
);
`;

export const CREATE_EMPLOYEE_TABLE = `
CREATE OR REPLACE TABLE ${TEST_LIBRARY}.EMPLOYEE (
    EMPNO      CHAR(6)         NOT NULL,
    FIRSTNME    VARCHAR(12)     NOT NULL,
    MIDINIT     CHAR(1)         NOT NULL,
    LASTNAME    VARCHAR(15)     NOT NULL,
    WORKDEPT    CHAR(3)                 ,
    PHONENO     CHAR(4)                 ,
    HIREDATE    DATE                    ,
    JOB         CHAR(8)                 ,
    EDLEVEL     SMALLINT        NOT NULL,
    SEX         CHAR(1)                 ,
    BIRTHDATE   DATE                    ,
    SALARY      DECIMAL(9,2)            ,
    BONUS       DECIMAL(9,2)            ,
    COMM        DECIMAL(9,2)            ,    
    PRIMARY KEY (EMPNO)
); 
`;

export const INSERT_DEPARTMENTS = `
INSERT INTO ${TEST_LIBRARY}.DEPARTMENT (
    DEPTNO, DEPTNAME, MGRNO, ADMRDEPT, LOCATION
) VALUES
    ('A00', 'SPIFFY COMPUTER SERVICE DIV.', '000010', 'A00', 'NEW YORK'),
    ('B01', 'PLANNING', '000020', 'A00', 'ATLANTA');
`;

export const INSERT_EMPLOYEES = `
INSERT INTO ${TEST_LIBRARY}.EMPLOYEE (
    EMPNO, FIRSTNME, MIDINIT, LASTNAME, WORKDEPT, PHONENO,
    HIREDATE, JOB, EDLEVEL, SEX, BIRTHDATE, SALARY, BONUS, COMM
) VALUES 
    ('000010', 'CHRISTINE', 'I', 'HAAS', 'A00', '3978', '01/01/65',
    'PRES', 18, 'F', NULL, 52750, 1000, 4220),
    ('000020', 'MICHAEL', 'L', 'THOMPSON', 'B01', '3476', '10/10/73',
    'MANAGER', 18, 'M', '02/02/48', 41250, 800, 3300),
    ('200120', 'GREG', '', 'ORLANDO', 'A00', '2167', '05/05/72',
    'CLERK', 14, 'M', '10/18/42', 29250, 600, 2340);
`;

// -------------------------------------------------------------------------
// Scalar function
// -------------------------------------------------------------------------

export const CREATE_SCALAR_FUNCTION = `
CREATE OR REPLACE FUNCTION ${TEST_LIBRARY}.GET_SALARY (
    P_EMPNO CHAR(6)
)
RETURNS DECIMAL(9,2)
LANGUAGE SQL
BEGIN
    DECLARE V_SALARY DECIMAL(9,2);

    SELECT SALARY
      INTO V_SALARY
      FROM ${TEST_LIBRARY}.EMPLOYEE
     WHERE EMPNO = P_EMPNO;

    RETURN V_SALARY;
END
`;

// -------------------------------------------------------------------------
// Table function
// -------------------------------------------------------------------------

export const CREATE_TABLE_FUNCTION = `
CREATE OR REPLACE FUNCTION ${TEST_LIBRARY}.GET_EMPLOYEES (
    P_DEPTNO CHAR(3)
)
RETURNS TABLE (
    EMPNO    CHAR(6),
    FIRSTNME VARCHAR(12),
    LASTNAME VARCHAR(15),
    SALARY   DECIMAL(9,2)
)
LANGUAGE SQL
RETURN
    SELECT EMPNO, FIRSTNME, LASTNAME, SALARY
      FROM ${TEST_LIBRARY}.EMPLOYEE
     WHERE WORKDEPT = P_DEPTNO
`;

// -------------------------------------------------------------------------
// Procedure
// -------------------------------------------------------------------------

export const CREATE_PROCEDURE = `
CREATE OR REPLACE PROCEDURE ${TEST_LIBRARY}.APPLY_BONUS (
    IN    P_EMPNO      CHAR(6),
    INOUT P_BONUS      DECIMAL(9,2),
    OUT   P_NEW_SALARY DECIMAL(9,2)
)
LANGUAGE SQL
BEGIN
    SET P_BONUS = P_BONUS * 1.10;

    UPDATE ${TEST_LIBRARY}.EMPLOYEE
       SET BONUS  = P_BONUS
     WHERE EMPNO  = P_EMPNO;

    SELECT SALARY + P_BONUS
      INTO P_NEW_SALARY
      FROM ${TEST_LIBRARY}.EMPLOYEE
     WHERE EMPNO = P_EMPNO;
END
`;
