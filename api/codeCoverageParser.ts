import * as fs from "fs";
import * as tmp from "tmp";
import * as path from "path";
import * as unzipper from "unzipper";
import * as xml2js from "xml2js";
import { CCLVL, CoverageData, LogLevel } from "./types";
import { TestLogger } from "./testLogger";
import IBMi from "vscode-ibmi/src/api/IBMi";
import { TestCallbacks } from "./runner";

export class CodeCoverageParser {
    private connection: IBMi;
    private testCallbacks: TestCallbacks;
    private testLogger: TestLogger;
    private ccLvl: CCLVL;

    constructor(connection: IBMi, testCallbacks: TestCallbacks, testLogger: TestLogger, ccLvl: CCLVL) {
        this.connection = connection;
        this.testCallbacks = testCallbacks;
        this.testLogger = testLogger;
        this.ccLvl = ccLvl;
    }

    async getCoverage(outputZipPath: string): Promise<CoverageData[] | undefined> {
        // Get ccdata XML from cczip
        const tmpDir = tmp.dirSync({ unsafeCleanup: true });
        const xml = await this.downloadCczip(outputZipPath, tmpDir);

        if (xml) {
            // Parse XML to get coverage data
            const coverageData = await this.parseXml(xml, tmpDir);
            return coverageData;
        }
    }

    private async downloadCczip(outputZipPath: string, tmpDir: tmp.DirResult): Promise<any> {
        try {
            const content = this.connection.getContent();

            // Download remote cczip to local temp file
            const tmpFile = tmp.fileSync();
            await content.downloadStreamfileRaw(outputZipPath, tmpFile.name);
            await this.testLogger.testOutputLogger.log(LogLevel.Info, `Downloaded code coverage results to ${tmpFile.name}`);

            // Extract local temp file contents to temp directory
            const directory = await unzipper.Open.file(tmpFile.name);
            await directory.extract({ path: tmpDir.name });
            await this.testLogger.testOutputLogger.log(LogLevel.Info, `Extracted code coverage results to ${tmpDir.name}`);

            // Read and parse xml file from temp directory
            const ccdata = path.join(tmpDir.name, `ccdata`);
            const ccdataContent = fs.readFileSync(ccdata);
            const xml = await xml2js.parseStringPromise(ccdataContent);

            return xml;
        } catch (error: any) {
            await this.testLogger.testOutputLogger.appendWithNotification(LogLevel.Error, `Failed to download code coverage results`, `${outputZipPath} - ${error}`);
        }
    }

    private async parseXml(xml: any, tmpdir: tmp.DirResult): Promise<CoverageData[] | undefined> {
        try {
            const items: CoverageData[] = [];

            for (const source of xml.LLC.lineLevelCoverageClass) {
                const data = source[`$`];
                const testCase = source.testcase === undefined ?
                    { hits: `` } : // Indicates that no lines were ran
                    source.testcase[0][`$`];

                const sourcePath = path.join(tmpdir.name, `src`, data.sourceFile);
                const sourceCode = fs.readFileSync(sourcePath).toString();
                const sourceCodeSplit = sourceCode.split(`\n`);

                const realHits = testCase.v2fileHits || testCase.hits;
                const realLines = data.v2fileLines || data.lines;
                const realSigs = data.v2qualifiedSignatures || data.signatures;
                const realSigsSplit = realSigs.split(`+`);

                const indexesExecuted = this.getRunLines(sourceCodeSplit.length, realHits);
                const activeLines = await this.getLines(realLines, indexesExecuted, realSigsSplit, sourcePath, sourceCode);

                const lineKeys = Object.keys(activeLines).map(Number);;
                let countRan = 0;
                lineKeys.forEach(key => {
                    if (activeLines[key].executed === true) {
                        countRan++;
                    }
                });
                const percentRan = ((countRan / lineKeys.length) * 100).toFixed(0);

                items.push({
                    basename: path.basename(data.sourceFile),
                    path: data.sourceFile,
                    localPath: sourcePath,
                    coverage: {
                        signitures: realSigsSplit,
                        lineString: realLines,
                        activeLines,
                        percentRan
                    },
                });
            }

            return items;
        } catch (error) {
            await this.testLogger.testOutputLogger.appendWithNotification(LogLevel.Error, `Failed to parse code coverage results`, `${error}`);
        }
    }

    private async getLines(realLines: string, indexesExecuted: number[], realSigsSplit: string[], sourcePath: string, sourceCode: string): Promise<{ [key: number]: { name: string; executed: boolean; }; }> {
        const lineNumbers = [];
        let line = 0;
        let currentValue = ``;
        let concat = false;

        for (const char of realLines) {
            switch (char) {
                case `#`:
                    if (currentValue !== ``) {
                        line = Number(currentValue);
                        lineNumbers.push(line);
                    }

                    concat = true;
                    line = 0;
                    currentValue = ``;
                    break;

                case `,`:
                    if (currentValue !== ``) {
                        line = Number(currentValue);
                        lineNumbers.push(line);
                    }
                    currentValue = ``;
                    break;

                case `+`:
                    line = Number(currentValue);
                    lineNumbers.push(line);
                    concat = false;
                    break;

                default:
                    if (concat) {
                        currentValue += char;
                    } else {
                        currentValue = ``;
                        line += Number(char);
                        lineNumbers.push(line);
                    }
                    break;
            }
        }

        let lines: { [key: number]: { name: string, executed: boolean } } = {};

        for (const i in lineNumbers) {
            const lineNumber = lineNumbers[i];

            let name: string = lineNumber.toString();
            if (this.ccLvl === '*PROC') {
                const docs = await this.testCallbacks.getDocs(sourcePath, sourceCode);
                if (docs) {
                    const zeroBasedLine = Number(lineNumber) - 1;
                    const mappedProcedure = docs.procedures.find(p => p.position.path === sourcePath && p.position.range.line === zeroBasedLine);
                    if (mappedProcedure) {
                        name = mappedProcedure.name;
                    } else if (zeroBasedLine === 0 && realSigsSplit.length > 0) {
                        name = realSigsSplit[0];
                    }
                }
            }

            const executed = indexesExecuted.includes(Number(i));
            lines[lineNumber] = { name, executed };
        }

        return lines;
    }

    private getRunLines(numLines: number, hits: string): number[] {
        const hitLines: number[] = [];

        let hitChar;
        for (let i = 0, lineIndex = 0; lineIndex < numLines && i < hits.length; i++) {
            hitChar = hits.charCodeAt(i);

            if (hitChar <= 80) {
                hitChar -= 65;

                if (hitChar === 0) {
                    lineIndex += 4;
                } else {
                    if ((hitChar & 8) !== 0) {
                        hitLines.push(lineIndex);
                    }
                    lineIndex++;

                    if ((hitChar & 4) !== 0 && lineIndex < numLines) {
                        hitLines.push(lineIndex);
                    }
                    lineIndex++;

                    if ((hitChar & 2) !== 0 && lineIndex < numLines) {
                        hitLines.push(lineIndex);
                    }
                    lineIndex++;

                    if ((hitChar & 1) !== 0 && lineIndex < numLines) {
                        hitLines.push(lineIndex);
                    }
                    lineIndex++;
                }
            }
        }

        return hitLines;
    }
}