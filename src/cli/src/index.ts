import { program } from "commander";
import c from "ansi-colors";

// Setup CLI information
program
    .version(`1.0.0`, `-v, --version`, `Display the version number`)
    .description(`The ${c.cyanBright(`IBM i Testing (itest) CLI`)} can be used to run unit tests and generate code\ncoverage results in PASE for RPG and COBOL programs on IBM i. Under the\ncovers, this extension leverages the RPGUnit testing framework.\n\n✨ Documentation: https://codefori.github.io/docs/developing/testing/overview`)
    .helpOption(`-h, --help`, `Display help for command`)
    .showHelpAfterError(true)
    .showSuggestionAfterError(true)
    .configureHelp({ sortOptions: true });

// Setup CLI options
program
    .option(`-p, --project <projectPath>`, `Path to the root of the project`, `.`)
    .option(`-l, --log <logPath>`, `Path to where verbose logs should be stored`, `./logs`)
    // .option(`-c, --coverage`, `Run with code coverage (not supported yet!)`)
    .action((options) => {
        const { project, log, coverage } = options;
    });

program.parse(process.argv);