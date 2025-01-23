import { commands, DocumentSymbol, SymbolKind, TestItem, TestRun, workspace } from "vscode";
import { TestCase } from "./testCase";
import { manager } from "./extension";
import { getInstance } from "./api/ibmi";
import { IBMiTestManager } from "./manager";
import { IBMiTestRunner } from "./runner";
import { RUCRTRPG } from "./types";
import * as path from "path";

export class TestFile {
    static textDecoder = new TextDecoder('utf-8');
    didLoad: boolean;
    didCompile: boolean;
    content: string;
    item: TestItem;

    constructor(item: TestItem) {
        this.didLoad = false;
        this.didCompile = false;
        this.content = '';
        this.item = item;
    }

    async load(content?: string) {
        this.didLoad = true;

        // Load test file content
        if (content) {
            this.content = content;
        } else {
            try {
                const rawContent = await workspace.fs.readFile(this.item.uri!);
                this.content = TestFile.textDecoder.decode(rawContent);
            } catch (error) {
                // TODO: What to do here?
                console.log(`Failed to load test file: ${error}`);
            }
        }

        // Load test cases
        const childItems: TestItem[] = [];
        const documentSymbols = await commands.executeCommand<DocumentSymbol[]>(`vscode.executeDocumentSymbolProvider`, this.item.uri) || [];
        for (const documentSymbol of documentSymbols) {
            if (documentSymbol.kind === SymbolKind.Function && documentSymbol.name.startsWith('test')) {
                const childItem = manager!.controller.createTestItem(`${this.item.uri}/${documentSymbol.name}`, documentSymbol.name, this.item.uri);
                childItem.range = documentSymbol.range;
                const data = new TestCase(childItem);

                manager!.testData.set(childItem, data);
                childItems.push(childItem);
            }
        }
        this.item.children.replace(childItems);
    }

    async compileMember(run: TestRun) {
        const ibmi = getInstance();
        const connection = ibmi!.getConnection();
        const content = ibmi!.getContent();
        const config = ibmi!.getConfig();

        let library: string;
        let srcPf: string;
        let mbr: string;
        let mbrType: string;
        let isUploaded: boolean;

        if (this.item.uri?.scheme === 'file') {
            library = config.currentLibrary;
            srcPf = 'TEMP'; // TODO: What should this be? The parent directory?
            mbr = this.item.label.replace(new RegExp(IBMiTestManager.RPGLE_TEST_SUFFIX, 'i'), IBMiTestManager.TEST_SUFFIX).toLocaleUpperCase();
            mbrType = path.parse(this.item.uri.path).ext.substring(1).toLocaleUpperCase();
            isUploaded = await this.uploadMember(run, library, srcPf, mbr, mbrType);
        } else {
            const parsedPath = connection.parserMemberPath(this.item.uri!.path);
            library = parsedPath.library;
            srcPf = parsedPath.file;
            mbr = parsedPath.name.toLocaleUpperCase();
            mbrType = parsedPath.extension;
            isUploaded = true;
        }

        const compileParams: RUCRTRPG = {
            tstPgm: `${library}/${mbr}`,
            srcFile: `${library}/${srcPf}`,
            srcMbr: mbr
        };

        if (isUploaded) {
            // TODO: RPGUNIT library must be on the library list
            // TODO: Add support for RUCRTCBL
            const compileCommand = content.toCl(`RUCRTRPG`, compileParams as any);
            const compileResult = await connection.runCommand({ command: compileCommand, environment: `ile` });
            if (compileResult.code !== 0) {
                IBMiTestRunner.updateTestRunStatus(run, 'compilation', { compilationResult: 'Compilation Failed', messages: compileResult.stderr.split('\n') });
            } else {
                IBMiTestRunner.updateTestRunStatus(run, 'compilation', { compilationResult: 'Compilation Successful' });
                this.didCompile = true;
                return;
            }
        }
    }

    private async uploadMember(run: TestRun, library: string, srcPf: string, mbr: string, mbrType: string): Promise<boolean> {
        const ibmi = getInstance();
        const connection = ibmi!.getConnection();
        const content = ibmi!.getContent();

        const commands = [
            content.toCl(`CRTSRCPF`, { file: `${library}/${srcPf}`, rcdlen: 112 }),
            content.toCl(`ADDPFM`, { file: `${library}/${srcPf}`, mbr: mbr, srcType: mbrType }),
        ];

        for (const command of commands) {
            try {
                const result = await connection.runCommand({ command: command, environment: `ile`, noLibList: true });
                console.log(result);
            } catch (error) {
                // Ignore error as source file and member may already exist
                // TODO: Need to check for other types of errors?
            }
        }

        let isUploaded: boolean = false;
        try {
            isUploaded = await content.uploadMemberContent(undefined, library, srcPf, mbr, this.content);
            if (!isUploaded) {
                IBMiTestRunner.updateTestRunStatus(run, 'upload', { compilationResult: 'Source Upload Failed' });
            }
        } catch (error: any) {
            IBMiTestRunner.updateTestRunStatus(run, 'upload', { compilationResult: 'Source Upload Failed', messages: error.message.split('\n') });
        }

        return isUploaded;
    }
}