import * as fs from "fs";
import * as tmp from "tmp";
import * as path from "path";
import * as unzipper from "unzipper";
import * as xml2js from "xml2js";
import { CoverageData, LogLevel } from "./types";
import { TestLogger } from "./testLogger";
import IBMi from "@halcyontech/vscode-ibmi-types/api/IBMi";

export class CodeCoverageParser {
    private connection: IBMi;
    private testLogger: TestLogger;

    constructor(connection: IBMi, testLogger: TestLogger) {
        this.connection = connection;
        this.testLogger = testLogger;
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
                const rawSource = fs.readFileSync(sourcePath);
                const sourceCode = rawSource.toString().split(`\n`);

                const realHits = testCase.v2fileHits || testCase.hits;
                const realLines = data.v2fileLines || data.lines;
                const realSigs = data.v2qualifiedSignatures || data.signatures;

                const indexesExecuted = this.getRunLines(sourceCode.length, realHits);
                const activeLines = this.getLines(realLines, indexesExecuted);

                const lineKeys = Object.keys(activeLines).map(Number);;
                let countRan = 0;
                lineKeys.forEach(key => {
                    if (activeLines[key] === true) {
                        countRan++;
                    }
                });
                const percentRan = ((countRan / lineKeys.length) * 100).toFixed(0);

                items.push({
                    basename: path.basename(data.sourceFile),
                    path: data.sourceFile,
                    localPath: sourcePath,
                    coverage: {
                        signitures: realSigs.split(`+`),
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

    private getLines(string: string, indexesExecuted: number[]): { [key: number]: boolean } {
        const lineNumbers = [];
        let line = 0;
        let currentValue = ``;
        let concat = false;

        for (const char of string) {
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

        let lines: { [key: number]: boolean } = {};

        for (const i in lineNumbers) {
            lines[lineNumbers[i]] = indexesExecuted.includes(Number(i));
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