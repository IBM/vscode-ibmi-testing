# IBM i Testing CLI

<img src="https://raw.githubusercontent.com/IBM/vscode-ibmi-testing/refs/heads/main/icon.png" align="right" width="160" height="160">

[![NPM Version](https://img.shields.io/npm/v/@ibm/ibmi-testing.svg?label=version)](https://www.npmjs.com/package/@ibm/ibmi-testing)
[![NPM Downloads](https://img.shields.io/npm/dm/@ibm/ibmi-testing.svg)](https://www.npmjs.com/package/@ibm/ibmi-testing)

The IBM i Testing CLI (`itest`) can be used to run unit tests and generate
code coverage results in PASE for RPG and COBOL programs on IBM i. Under the
covers, this extension leverages the RPGUnit testing framework.

✨ Documentation: https://codefori.github.io/docs/developing/testing/overview

Options:
  * `--v, --version`                         Display the version number
  * `--ld, --localDirectory <path>`          Local directory containing tests (defaults: ".")
  * `--id, --ifsDirectory <path>`            IFS directory containing containing tests (defaults: ".")
  * `--l, --library <library>`               Library containing tests.
  * `--sf, --source-files <sourceFiles...>`  Source files to search for tests. (default: ["QTESTSRC"])
  * `--ll, --library-list <libraries...>`    Libraries to add to the library list.
  * `--cl, --current-library <library>`      The current library to use for the test run.
  * `--cc, --code-coverage`                  Run with code coverage (choices: "*LINE", "*PROC")
  * `--sco, --save-command-output [path]`    Save command output logs (defaults: "./.itest/command-output.log")
  * `--sto, --save-test-output [path]`       Save test output logs (defaults: "./.itest/test-output.log")
  * `--str, --save-test-result [path]`       Save test result logs (defaults: "./.itest/test-result.log")
  * `--h, --help`                            Display help for command

Examples:
  * `itest --ld . --id /home/USER/builds/ibmi-company_system --ll RPGUNIT QDEVTOOLS --cl MYLIB`
  * `itest --id /home/USER/builds/ibmi-company_system --ll RPGUNIT QDEVTOOLS --cl MYLIB`
  * `itest --l MYLIB --ll RPGUNIT QDEVTOOLS --cl MYLIB`