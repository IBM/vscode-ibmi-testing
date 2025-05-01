import { LogLevel, Uri, workspace } from "vscode";
import * as tmp from "tmp";
import * as path from "path";
import * as unzipper from "unzipper";
import * as xml2js from "xml2js";
import { getInstance } from "./api/ibmi";
import { Logger } from "./logger";
import { CoverageData } from "./types";

export namespace CodeCoverage {
    export async function setupCodeCoverage() {
        tmp.setGracefulCleanup();
    }

    export async function getCoverage(outputZipPath: string): Promise<CoverageData[] | undefined> {
        // Get ccdata XML from cczip
        const tmpDir = tmp.dirSync({ unsafeCleanup: true });
        const xml = await downloadCczip(outputZipPath, tmpDir);

        // Parse XML to get coverage data
        const coverageData = await getCoverageData(xml, tmpDir);

        return coverageData;
    }

    async function downloadCczip(outputZipPath: string, tmpDir: tmp.DirResult): Promise<any> {
        try {
            const ibmi = getInstance();
            const connection = ibmi!.getConnection();
            const content = connection.getContent();

            // Download remote cczip to local temp file
            const tmpFile = tmp.fileSync();
            await content.downloadStreamfileRaw(outputZipPath, tmpFile.name);
            Logger.log(LogLevel.Info, `Downloaded code coverage results to ${tmpFile.name}`);

            // Extract local temp file contents to temp directory
            const directory = await unzipper.Open.file(tmpFile.name);
            await directory.extract({ path: tmpDir.name });
            Logger.log(LogLevel.Info, `Extracted code coverage results to ${tmpDir.name}`);

            // Read and parse xml file from temp directory
            const ccdata = Uri.file(path.join(tmpDir.name, `ccdata`));
            const ccdataContent = await workspace.fs.readFile(ccdata);
            // TODO: Can we get an interface for the xml?
            const xml = await xml2js.parseStringPromise(ccdataContent);

            return xml;
        } catch (error: any) {
            Logger.logWithNotification(LogLevel.Error, `Failed to download code coverage results`, `${outputZipPath} - ${error}`);
        }
    }

    async function getCoverageData(xml: any, tmpdir: tmp.DirResult): Promise<CoverageData[] | undefined> {
        try {
            const items: CoverageData[] = [];

            for (const source of xml.LLC.lineLevelCoverageClass) {
                const data = source[`$`];
                const testCase = source.testcase === undefined ?
                    { hits: `` } : // Indicates that no lines were ran
                    source.testcase[0][`$`];

                const sourceUri = Uri.file(path.join(tmpdir.name, `src`, data.baseFileName));
                const rawSource = await workspace.fs.readFile(sourceUri);
                const sourceCode = rawSource.toString().split(`\n`);

                const realHits = testCase.v2fileHits || testCase.hits;
                const realLines = data.v2fileLines || data.lines;
                const realSigs = data.v2qualifiedSignatures || data.signatures;

                const indexesExecuted = getRunLines(sourceCode.length, realHits);
                const activeLines = getLines(realLines, indexesExecuted);

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
                    localPath: path.join(tmpdir.name, `src`, data.baseFileName),
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
            Logger.logWithNotification(LogLevel.Error, `Failed to parse code coverage results`, `${error}`);
        }
    }

    function getLines(string: string, indexesExecuted: number[]): { [key: number]: boolean } {
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

    function getRunLines(numLines: number, hits: string): number[] {
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