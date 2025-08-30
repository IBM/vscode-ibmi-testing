# IBM i Testing CLI

<img src="https://raw.githubusercontent.com/IBM/vscode-ibmi-testing/refs/heads/main/icon.png" align="right" width="160" height="160">

[![NPM Version](https://img.shields.io/npm/v/@ibm/itest.svg?label=version)](https://www.npmjs.com/package/@ibm/itest)
[![NPM Downloads](https://img.shields.io/npm/dm/@ibm/itest.svg)](https://www.npmjs.com/package/@ibm/itest)

The [IBM i Testing CLI](https://www.npmjs.com/package/@ibm/itest) (`itest`) is a companion to the [IBM i Testing](https://marketplace.visualstudio.com/items?itemName=IBM.vscode-ibmi-testing) VS Code extension, which allows you to run unit tests and generate code coverage results for RPG and COBOL programs on IBM i. With this CLI, you can run tests in your terminal on your local PC or in PASE on IBM i. This enables you to even script the execution of tests in a CI/CD pipeline.

✨ Documentation: https://codefori.github.io/docs/developing/testing/cli

### Options
  * `--v, --version`                                Display the version number
  * `--ld, --local-directory [path]`                Local directory containing tests (preset: ".")
  * `--id, --ifs-directory [path]`                  IFS directory containing containing tests (preset: ".")
  * `--l, --library <library>`                      Library containing tests.
  * `--sf, --source-files <sourceFiles...>`         Source files to search for tests. (default: ["QTESTSRC"])
  * `--ll, --library-list <libraries...>`           Libraries to add to the library list.
  * `--cl, --current-library <library>`             The current library to use for the test run.
  * `--cc, --code-coverage [ccLvl]`                 Run with code coverage (choices: "*LINE", "*PROC", preset: "*LINE")
  * `--ct, --coverage-thresholds <threshholds...>`  Set the code coverage thresholds (yellow and green). (default: ["60","90"])
  * `--sc, --skip-compilation`                      Skip compilation
  * `--sr, --summary-report [path]`                 Save summary report (preset: "./.itest/summary-report.md")
  * `--tr, --test-result [path]`                    Save test result logs (preset: "./.itest/test-result.log")
  * `--to, --test-output [path]`                    Save test output logs (preset: "./.itest/test-output.log")
  * `--co, --command-output [path]`                 Save command output logs (preset: "./.itest/command-output.log")
  * `--h, --help`                                   Display help for command

### Examples
1. Run tests in local directory:
    ```
    itest --ld . --id /home/USER/builds/ibmi-company_system --ll RPGUNIT QDEVTOOLS --cl MYLIB
    ```

2. Run tests in IFS directory:
    ```
    itest --id /home/USER/builds/ibmi-company_system --ll RPGUNIT QDEVTOOLS --cl MYLIB
    ```

3. Run tests in library:
    ```
    itest --l RPGUTILS --ll RPGUNIT QDEVTOOLS --cl RPGUTILS
    ````