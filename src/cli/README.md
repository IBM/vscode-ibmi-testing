# IBM i Testing CLI

The IBM i Testing CLI (`itest` - v1.0.0) can be used to run unit tests and generate
code coverage results in PASE for RPG and COBOL programs on IBM i. Under the
covers, this extension leverages the RPGUnit testing framework.

✨ Documentation: https://codefori.github.io/docs/developing/testing/overview

Options:
  `-v, --version`                    Display the version number
  `--project <path>`                 Path to the project containing tests (default: ".")
  `--library <library>`              Library containing tests.
  `--source-files <sourceFiles...>`  Source files to search for tests. (default: ["QTESTSRC"])
  `--library-list <libraries...>`    Libraries to add to the library list.
  `--current-library <library>`      The current library to use for the test run.
  `--save-command-output [path]`     Save command output logs (defaults: "./logs/ibmi-testing/command-output.log")
  `--save-test-output [path]`        Save test output logs (defaults: "./logs/ibmi-testing/test-output.log")
  `--save-test-result [path]`        Save test result logs (defaults: "./logs/ibmi-testing/test-result.log")
  `-h, --help`                       Display help for command

Example Usage:
  `itest --library MYLIB --library-list RPGUNIT QDEVTOOLS --current-library MYLIB`
  `itest --project /home/USER/ibmi-company_system --library-list RPGUNIT QDEVTOOLS --current-library MYLIB`