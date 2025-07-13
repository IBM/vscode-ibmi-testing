import { program } from "commander";
import c from "ansi-colors";
import { LocalSSH } from "./LocalClient";
import IBMi from "vscode-ibmi/src/api/IBMi";

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
    .action(async (options) => {
        const { project, log, coverage } = options;

        const localSSH = new LocalSSH();
        const connection = new IBMi();
        await connection.connect(
            {
                name: "USER@HOST",
                host: "HOST",
                port: 2,
                username: "USER"
            },
            {
                message: (type: string, message: string) => {
                },
                progress: ({ message }) => {
                },
                uiErrorHandler: async (connection, code, data) => {
                    return false;
                },
            },
            false,
            false,
            localSSH as any
        );
    });

program.parse(process.argv);