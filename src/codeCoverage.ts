import { LogLevel, Uri, workspace } from "vscode";
import * as tmp from "tmp";
import * as path from "path";
import * as unzipper from "unzipper";
import * as xml2js from "xml2js";
import { getInstance } from "./api/ibmi";
import { Logger } from "./outputChannel";

export namespace CodeCoverage {
    export async function getCoverage(outputZipPath: string) {
        const tmpdir = tmp.dirSync();
        const xml = await downloadCczip(outputZipPath, tmpdir);
        return await parseXml(xml, tmpdir);
    }

    async function downloadCczip(outputZipPath: string, tmpdir: tmp.DirResult): Promise<any> {
        try {
            const ibmi = getInstance();
            const connection = ibmi!.getConnection();
            const content = connection.getContent();

            // Download remote cczip to local temp file
            const tmpFile = tmp.fileSync();
            await content.downloadStreamfileRaw(outputZipPath, tmpFile.name);

            // Extract local temp file contents to temp directory
            const directory = await unzipper.Open.file(tmpFile.name);
            await directory.extract({ path: tmpdir.name });

            // Read and parse xml file from temp directory
            const ccdata = Uri.file(path.join(tmpdir.name, `ccdata`));
            const ccdataContent = await workspace.fs.readFile(ccdata);
            // TODO: Can we get an interface for the xml?
            const xml = await xml2js.parseStringPromise(ccdataContent);

            // Clean up
            tmpFile.removeCallback();

            return xml;
        } catch (error: any) {
            Logger.getInstance().logWithErrorNotification(LogLevel.Error, `Failed to download code coverage results`, `${outputZipPath} - ${error}`);
        }
    }

    async function parseXml(xml: any, tmpdir: tmp.DirResult) {
        let data;
        let testCase;
        let sourceCode;
        let activeLines: any;
        let indexesExecuted;

        let lineKeys;
        let percentRan;
        let countRan: any;

        let items = [];
        for (const source of xml.LLC.lineLevelCoverageClass) {
            data = source[`$`];

            if (source.testcase === undefined) {
                //Indicates that no lines were ran
                testCase = { hits: `` };
            } else {
                testCase = source.testcase[0][`$`];
            }

            sourceCode = (
                await workspace.fs.readFile(Uri.file(path.join(tmpdir.name, `src`, data.baseFileName)))
            ).toString().split(`\n`);

            const realHits = testCase.v2fileHits || testCase.hits;
            const realLines = data.v2fileLines || data.lines;
            const realSigs = data.v2qualifiedSignatures || data.signatures;

            indexesExecuted = getRunLines(sourceCode.length, realHits);
            activeLines = getLines(realLines, indexesExecuted);

            lineKeys = Object.keys(activeLines);

            countRan = 0;
            lineKeys.forEach(key => {
                if (activeLines[key] === true) countRan++;
            })

            percentRan = ((countRan / lineKeys.length) * 100).toFixed(0);

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
    }

    function getLines(string: string, indexesExecuted: number[]) {
        let lineNumbers = [];
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
                        currentValue = ``
                        line += Number(char);
                        lineNumbers.push(line);
                    }
                    break;
            }
        }

        let lines: any = {};

        for (const i in lineNumbers) {
            lines[lineNumbers[i]] = indexesExecuted.includes(Number(i));
        }

        return lines;
    }

    function getRunLines(numLines: number, hits: string) {
        let hitLines: number[] = [];

        let hitChar;
        for (let i = 0, lineIndex = 0; lineIndex < numLines && i < hits.length; i++) {
            hitChar = hits.charCodeAt(i);

            if (hitChar <= 80) {
                hitChar -= 65;

                if (hitChar === 0) {
                    lineIndex += 4;
                } else {
                    if ((hitChar & 8) !== 0)
                        hitLines.push(lineIndex);
                    lineIndex++;
                    if ((hitChar & 4) !== 0 && lineIndex < numLines)
                        hitLines.push(lineIndex);
                    lineIndex++;
                    if ((hitChar & 2) !== 0 && lineIndex < numLines)
                        hitLines.push(lineIndex);
                    lineIndex++;
                    if ((hitChar & 1) !== 0 && lineIndex < numLines)
                        hitLines.push(lineIndex);
                    lineIndex++;
                }
            }
        }

        return hitLines;
    }
}