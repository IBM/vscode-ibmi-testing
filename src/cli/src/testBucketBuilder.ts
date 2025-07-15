import IBMi from "@halcyontech/vscode-ibmi-types/api/IBMi";
import { ApiUtils } from "./api/apiUtils";
import { LogLevel, TestBucket } from "./api/types";
import { TestOutputLogger } from "./loggers/testOutputLogger";
import Parser from "vscode-rpgle/language/parser";
import { IfsConfigHandler, LocalConfigHandler, QsysConfigHandler } from "./api/config";
import { IFSFile } from "@halcyontech/vscode-ibmi-types/api/types";
import * as fs from 'fs';
import * as path from 'path';

export abstract class TestBucketBuilder {
    protected testOutputLogger: TestOutputLogger;
    protected rpgParser: Parser;

    constructor(testOutputLogger: TestOutputLogger) {
        this.testOutputLogger = testOutputLogger;
        this.rpgParser = new Parser();
    }

    abstract getTestBuckets(): Promise<TestBucket[]>;

    protected async getTestCases(filePath: string, content: string): Promise<string[]> {
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

export class LocalTestBucketBuilder extends TestBucketBuilder {
    private localDirectory: string;

    constructor(testOutputLogger: TestOutputLogger, localDirectory: string) {
        super(testOutputLogger);
        this.localDirectory = localDirectory;
    }

    async getTestBuckets(): Promise<TestBucket[]> {
        // Build test bucket
        const testBuckets: TestBucket[] = [];
        testBuckets.push({
            name: path.basename(this.localDirectory),
            uri: {
                scheme: 'file',
                path: '',
                fsPath: this.localDirectory,
                fragment: ''
            },
            testSuites: []
        });

        // Get all files in the IFS directory
        await this.testOutputLogger.log(LogLevel.Info, `Searching for tests in directory: ${this.localDirectory}`);
        const allFiles = await this.recursivelyReadDirectory(this.localDirectory);

        // Get test files
        const testSuffixes = ApiUtils.getTestSuffixes({ rpg: true, cobol: true });
        const testFiles = allFiles.filter((file) => {
            return testSuffixes.ifs.some(suffix => file.toLocaleUpperCase().endsWith(suffix));
        });

        // Get tests cases
        for (const testFile of testFiles) {
            const filePath = testFile;
            const fileContent = await fs.promises.readFile(filePath, 'utf-8');

            // Get testing config
            const configHandler = new LocalConfigHandler(this.testOutputLogger, this.localDirectory, filePath);
            const testingConfig = await configHandler.getConfig();

            // Add test suites and test cases to test bucket
            const testCases = await this.getTestCases(filePath, fileContent);
            testBuckets[0].testSuites.push({
                name: path.basename(filePath),
                systemName: ApiUtils.getSystemNameFromPath(path.parse(filePath).name),
                uri: {
                    scheme: 'file',
                    path: '',
                    fsPath: filePath,
                    fragment: ''
                },
                testCases: testCases.map(testCase => ({
                    name: testCase,
                    uri: {
                        scheme: 'file',
                        path: '',
                        fsPath: filePath,
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

    async recursivelyReadDirectory(localPath: string, allFiles: string[] = []): Promise<string[]> {
        const entries = await fs.promises.readdir(localPath, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(localPath, entry.name);
            if (entry.isDirectory()) {
                await this.recursivelyReadDirectory(fullPath, allFiles);
            } else {
                allFiles.push(fullPath);
            }
        }

        return allFiles;
    }
}

export class IfsTestBucketBuilder extends TestBucketBuilder {
    private connection: IBMi;
    private ifsDirectory: string;

    constructor(connection: IBMi, testOutputLogger: TestOutputLogger, ifsDirectory: string) {
        super(testOutputLogger);
        this.connection = connection;
        this.ifsDirectory = ifsDirectory;
    }

    async getTestBuckets(): Promise<TestBucket[]> {
        // Build test bucket
        const testBuckets: TestBucket[] = [];
        testBuckets.push({
            name: path.basename(this.ifsDirectory),
            uri: {
                scheme: 'streamfile',
                path: this.ifsDirectory,
                fsPath: '',
                fragment: ''
            },
            testSuites: []
        });

        // Get all files in the IFS directory
        await this.testOutputLogger.log(LogLevel.Info, `Searching for tests in IFS directory: ${this.ifsDirectory}`);
        const allFiles = await this.recursivelyReadDirectory(this.ifsDirectory);

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
            const configHandler = new IfsConfigHandler(this.connection, this.testOutputLogger, this.ifsDirectory, filePath);
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

    async recursivelyReadDirectory(ifsPath: string, allFiles: IFSFile[] = []): Promise<IFSFile[]> {
        const content = this.connection.getContent();
        const fileList = await content.getFileList(ifsPath, { order: 'name', ascending: true }, (errors: string[]) => { });
        for (const item of fileList) {
            if (item.type === "directory") {
                await this.recursivelyReadDirectory(item.path, allFiles);
            } else {
                allFiles.push(item);
            }
        }

        return allFiles;
    }
}

export class QsysTestBucketBuilder extends TestBucketBuilder {
    private connection: IBMi;
    private library: string;
    private testSourceFiles: string[];

    constructor(connection: IBMi, testOutputLogger: TestOutputLogger, library: string, testSourceFiles: string[]) {
        super(testOutputLogger);
        this.connection = connection;
        this.library = library;
        this.testSourceFiles = testSourceFiles;
    }

    async getTestBuckets(): Promise<TestBucket[]> {
        // Build test bucket
        const testBuckets: TestBucket[] = [];
        testBuckets.push({
            name: path.basename(`/${this.library}`),
            uri: {
                scheme: 'object',
                path: `/${this.library}`,
                fsPath: '',
                fragment: ''
            },
            testSuites: []
        });

        // Get test members
        await this.testOutputLogger.log(LogLevel.Info, `Searching for tests in : ${this.library}.LIB`);
        const testSuffixes = ApiUtils.getTestSuffixes({ rpg: true, cobol: true });
        const qsysExtensions = testSuffixes.qsys.map((suffix) => suffix.slice(1));
        const testMembers = await ApiUtils.getMemberList(this.connection, [this.library], this.testSourceFiles, qsysExtensions);

        // Get tests cases
        const content = this.connection.getContent();
        for (const testMember of testMembers) {
            const memberPath = testMember.asp ?
                path.posix.join(testMember.asp, testMember.library, testMember.file, `${testMember.name}.${testMember.extension}`) :
                path.posix.join(testMember.library, testMember.file, `${testMember.name}.${testMember.extension}`);
            const memberContent = await content.downloadMemberContent(testMember.library, testMember.file, testMember.name);

            // Get testing config
            const configHandler = new QsysConfigHandler(this.connection, this.testOutputLogger, memberPath);
            const testingConfig = await configHandler.getConfig();

            // Add test suites and test cases to test bucket
            const testCases = await this.getTestCases(memberPath, memberContent);
            testBuckets[0].testSuites.push({
                name: path.basename(memberPath),
                systemName: ApiUtils.getSystemNameFromPath(path.parse(memberPath).name),
                uri: {
                    scheme: 'member',
                    path: memberPath,
                    fsPath: '',
                    fragment: ''
                },
                testCases: testCases.map(testCase => ({
                    name: testCase,
                    uri: {
                        scheme: 'member',
                        path: memberPath,
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
}