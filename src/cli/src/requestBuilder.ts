import IBMi from "@halcyontech/vscode-ibmi-types/api/IBMi";
import { ApiUtils } from "./api/apiUtils";
import { LogLevel, TestBucket } from "./api/types";
import { TestOutputLogger } from "./loggers/testOutputLogger";
import Parser from "vscode-rpgle/language/parser";
import { IfsConfigHandler } from "./api/config";
import * as path from "path";
import { IFSFile } from "@halcyontech/vscode-ibmi-types/api/types";

export class RequestBuilder {
    private connection: IBMi;
    private testOutputLogger: TestOutputLogger;
    private projectPath: string;
    private rpgParser: Parser;

    constructor(connection: IBMi, testOutputLogger: TestOutputLogger, projectPath: string) {
        this.connection = connection;
        this.testOutputLogger = testOutputLogger;
        this.projectPath = projectPath;
        this.rpgParser = new Parser();
    }


    async buildTestBucket(): Promise<TestBucket[]> {
        // TODO: Support other types of test buckets
        return this.getIfsTestBuckets();
    }

    async getIfsTestBuckets(): Promise<TestBucket[]> {
        // Build test bucket
        const testBuckets: TestBucket[] = [];
        testBuckets.push({
            name: path.basename(this.projectPath),
            uri: {
                scheme: 'streamfile',
                path: this.projectPath,
                fsPath: '',
                fragment: ''
            },
            testSuites: []
        });

        // Get all files in the IFS directory
        await this.testOutputLogger.log(LogLevel.Info, `Searching for tests in IFS directory: ${this.projectPath}`);
        const allFiles = await this.recursivelyReadIFSDirectory(this.projectPath);

        // Get test files
        const testSuffixes = ApiUtils.getTestSuffixes({ rpg: true, cobol: true });
        const testFiles = allFiles.filter((file) => {
            return testSuffixes.ifs.some(suffix => file.path.toLocaleUpperCase().endsWith(suffix));
        });

        // Get tests cases
        const content = this.connection.getContent();
        for (const testFile of testFiles) {
            const filePath = testFile.path;
            const fileContent = (await content.downloadStreamfileRaw(filePath)).toString();

            // Get testing config
            // TODO: Support other local and member configs
            const configHandler = new IfsConfigHandler(this.connection, this.projectPath, filePath, this.testOutputLogger);
            const testingConfig = await configHandler.getConfig();

            // Add test suites and test cases to test bucket
            const testCases = await this.getTestCases(filePath, fileContent);
            testBuckets[0].testSuites.push({
                name: path.basename(filePath),
                systemName: ApiUtils.getSystemNameFromPath(path.parse(filePath).name),
                uri: {
                    scheme: 'streamfile',
                    path: filePath,
                    fsPath: '',
                    fragment: ''
                },
                testCases: testCases.map(testCase => ({
                    name: testCase,
                    uri: {
                        scheme: 'streamfile',
                        path: filePath,
                        fsPath: '',
                        fragment: testCase
                    }
                })),
                isCompiled: false,
                isEntireSuite: true,
                testingConfig: testingConfig
            });
        }


        return testBuckets;
    }

    async recursivelyReadIFSDirectory(ifsPath: string, allFiles: IFSFile[] = []): Promise<IFSFile[]> {
        const content = this.connection.getContent();
        const fileList = await content.getFileList(ifsPath, { order: 'name', ascending: true }, (errors: string[]) => { });
        for (const item of fileList) {
            if (item.type === "directory") {
                await this.recursivelyReadIFSDirectory(item.path, allFiles);
            } else {
                allFiles.push(item);
            }
        }

        return allFiles;
    }

    private async getTestCases(filePath: string, content: string): Promise<string[]> {
        const testCases: string[] = [];

        // Parse file
        const parsedContent = await this.rpgParser.getDocs(filePath, content);

        // Find RPGLE test procedures
        const rpgleTestCaseRegex = /^TEST.*$/i;
        for (const procedure of parsedContent.procedures) {
            if (rpgleTestCaseRegex.test(procedure.name)) {
                testCases.push(procedure.name);
            }
        }

        return testCases;
    }
}