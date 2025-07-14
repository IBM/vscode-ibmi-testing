import * as fs from 'fs/promises';
import * as path from "path";
import lodash from "lodash";
import { ConfigHandler, Logger, LogLevel, TestingConfig } from "./types";
import IBMi, { MemberParts } from '@halcyontech/vscode-ibmi-types/api/IBMi';

const TESTING_CONFIG_NAME = 'testing';
const TESTING_CONFIG_EXT = 'json';
const TESTING_CONFIG_BASENAME = `${TESTING_CONFIG_NAME}.${TESTING_CONFIG_EXT}`;
const GLOBAL_CONFIG_DIRECTORY = '.vscode';
const GLOBAL_CONFIG_SOURCE_FILE = 'VSCODE';

export class LocalConfigHandler implements ConfigHandler {
    private testOutputLogger: Logger;
    private workspaceFolderPath: string;
    private localPath: string;

    constructor(testOutputLogger: Logger, workspaceFolderPath: string, localPath: string) {
        this.testOutputLogger = testOutputLogger;
        this.workspaceFolderPath = workspaceFolderPath;
        this.localPath = localPath;
    }

    async getConfig(): Promise<TestingConfig | undefined> {
        try {
            const directoryConfigPath = await this.findConfig(this.localPath);
            const directoryConfig = directoryConfigPath ? await this.readConfig(directoryConfigPath) : undefined;
            if (directoryConfigPath && directoryConfig) {
                await this.testOutputLogger.log(LogLevel.Info, `Found directory testing configuration at ${directoryConfigPath}:\n${JSON.stringify(directoryConfig, null, 2)}`);
            }

            const globalConfigPath = path.join(this.workspaceFolderPath, GLOBAL_CONFIG_DIRECTORY, TESTING_CONFIG_BASENAME);
            const globalConfig = await this.readConfig(globalConfigPath);
            if (globalConfig) {
                await this.testOutputLogger.log(LogLevel.Info, `Found global testing configuration at ${globalConfigPath}:\n${JSON.stringify(globalConfig, null, 2)}`);
            }

            const mergedConfig = lodash.merge({}, globalConfig, directoryConfig);
            await this.testOutputLogger.log(LogLevel.Info, `Merged testing configuration:\n${JSON.stringify(mergedConfig, null, 2)}`);
            return mergedConfig;
        } catch (error: any) {
            await this.testOutputLogger.appendWithNotification(LogLevel.Error, `Failed to retrieve testing configuration`, error);
            return;
        }
    }

    private async findConfig(localPath: string): Promise<string | undefined> {
        const parentDirectory = path.dirname(localPath);
        if (parentDirectory.startsWith(this.workspaceFolderPath)) {
            const configFilePath = path.join(parentDirectory, TESTING_CONFIG_BASENAME);

            try {
                const stat = await fs.stat(configFilePath);
                if (stat.isFile()) {
                    return configFilePath;
                }
            } catch {
                // Testing config not found, continue to check parent directory
            }

            return this.findConfig(parentDirectory);
        }
    }

    private async readConfig(testingConfigPath: string): Promise<TestingConfig | undefined> {
        try {
            // Check if file exists
            await fs.stat(testingConfigPath);
        } catch (error: any) {
            await this.testOutputLogger.log(LogLevel.Info, `No local testing configuration found at ${testingConfigPath}`);
            return;
        }

        try {
            // Read and parse file
            const testingConfig = await fs.readFile(testingConfigPath, 'utf-8');
            return JSON.parse(testingConfig) as TestingConfig;
        } catch (error: any) {
            this.testOutputLogger.appendWithNotification(LogLevel.Error, `Failed to read local testing configuration`, `${testingConfigPath} - ${error}`);
            return;
        }
    }
}

export class IfsConfigHandler implements ConfigHandler {
    private connection: IBMi;
    private testOutputLogger: Logger;
    private rootIfsPath: string;
    private ifsPath: string;

    constructor(connection: IBMi, testOutputLogger: Logger, rootIfsPath: string, ifsPath: string) {
        this.connection = connection;
        this.testOutputLogger = testOutputLogger;
        this.rootIfsPath = rootIfsPath;
        this.ifsPath = ifsPath;
    }

    async getConfig(): Promise<TestingConfig | undefined> {
        try {
            const directoryConfigPath = await this.findConfig(this.ifsPath);
            const directoryConfig = directoryConfigPath ? await this.readConfig(directoryConfigPath) : undefined;
            if (directoryConfigPath && directoryConfig) {
                await this.testOutputLogger.log(LogLevel.Info, `Found directory testing configuration at ${directoryConfigPath.toString()}:\n${JSON.stringify(directoryConfig, null, 2)}`);
            }

            const globalConfigPath = path.posix.join(this.rootIfsPath, GLOBAL_CONFIG_DIRECTORY, TESTING_CONFIG_BASENAME);
            const globalConfig = await this.readConfig(globalConfigPath);
            if (globalConfig) {
                await this.testOutputLogger.log(LogLevel.Info, `Found global testing configuration at ${globalConfigPath.toString()}:\n${JSON.stringify(globalConfig, null, 2)}`);
            }

            const mergedConfig = lodash.merge({}, globalConfig, directoryConfig);
            await this.testOutputLogger.log(LogLevel.Info, `Merged testing configuration:\n${JSON.stringify(mergedConfig, null, 2)}`);
            return mergedConfig;
        } catch (error: any) {
            await this.testOutputLogger.appendWithNotification(LogLevel.Error, `Failed to retrieve testing configuration`, error);
            return;
        }
    }

    private async findConfig(ifsPath: string): Promise<string | undefined> {
        const parentDirectory = path.posix.dirname(ifsPath);
        if (parentDirectory.startsWith(this.rootIfsPath)) {
            const configFilePath = path.join(parentDirectory, TESTING_CONFIG_BASENAME);

            try {
                const exists = await this.connection.getContent().testStreamFile(configFilePath, 'r');
                if (exists) {
                    return configFilePath;

                }
            } catch {
                // Testing config not found, continue to check parent directory
            }

            return this.findConfig(parentDirectory);
        }
    }

    private async readConfig(testingConfigPath: string): Promise<TestingConfig | undefined> {
        // Check if file exists
        const exists = await this.connection.getContent().testStreamFile(testingConfigPath, 'r');
        if (!exists) {
            await this.testOutputLogger.log(LogLevel.Info, `No IFS testing configuration found at ${testingConfigPath}`);
            return;
        }

        try {
            // Read and parse file
            const content = this.connection.getContent();
            const testingConfig = await content.downloadStreamfileRaw(testingConfigPath);
            return JSON.parse(testingConfig.toString()) as TestingConfig;
        } catch (error: any) {
            this.testOutputLogger.appendWithNotification(LogLevel.Error, `Failed to read IFS testing configuration`, `${testingConfigPath} - ${error}`);
            return;
        }
    }
}

export class QsysConfigHandler implements ConfigHandler {
    private connection: IBMi;
    private testOutputLogger: Logger;
    private memberPath: string;

    constructor(connection: IBMi, testOutputLogger: Logger, memberPath: string) {
        this.connection = connection;
        this.testOutputLogger = testOutputLogger;
        this.memberPath = memberPath;
    }

    async getConfig(): Promise<TestingConfig | undefined> {
        try {
            const parsedMemberPath = this.connection.parserMemberPath(this.memberPath);
            parsedMemberPath.name = TESTING_CONFIG_NAME;
            parsedMemberPath.extension = TESTING_CONFIG_EXT;
            parsedMemberPath.basename = TESTING_CONFIG_BASENAME;

            const memberConfigPath = parsedMemberPath.asp ?
                `/${path.posix.join(parsedMemberPath.asp, parsedMemberPath.library, parsedMemberPath.file, TESTING_CONFIG_BASENAME)}` :
                `/${path.posix.join(parsedMemberPath.library, parsedMemberPath.file, TESTING_CONFIG_BASENAME)}`;
            const memberConfig = await this.readConfig(parsedMemberPath, memberConfigPath);
            if (memberConfig) {
                await this.testOutputLogger.log(LogLevel.Info, `Found source file testing configuration at ${memberConfigPath}:\n${JSON.stringify(memberConfig, null, 2)}`);
            }

            const parsedGlobalPath = parsedMemberPath;
            parsedGlobalPath.file = GLOBAL_CONFIG_SOURCE_FILE;

            const globalConfigPath = parsedMemberPath.asp ?
                `/${path.posix.join(parsedMemberPath.asp, parsedMemberPath.library, GLOBAL_CONFIG_SOURCE_FILE, TESTING_CONFIG_BASENAME)}` :
                `/${path.posix.join(parsedMemberPath.library, GLOBAL_CONFIG_SOURCE_FILE, TESTING_CONFIG_BASENAME)}`;
            const globalConfig = await this.readConfig(parsedGlobalPath, globalConfigPath);
            if (globalConfig) {
                await this.testOutputLogger.log(LogLevel.Info, `Found global testing configuration at ${globalConfigPath}:\n${JSON.stringify(globalConfig, null, 2)}`);
            }

            const mergedConfig = lodash.merge({}, globalConfig, memberConfig);
            await this.testOutputLogger.log(LogLevel.Info, `Merged testing configuration:\n${JSON.stringify(mergedConfig, null, 2)}`);
            return mergedConfig;
        } catch (error: any) {
            await this.testOutputLogger.appendWithNotification(LogLevel.Error, `Failed to retrieve testing configuration`, error);
            return;
        }
    }

    private async readConfig(parsedMemberPath: MemberParts, testingConfigPath: string): Promise<TestingConfig | undefined> {
        // Check if file exists
        const content = this.connection.getContent();
        const configExists = await content.checkObject({
            library: parsedMemberPath.library,
            name: parsedMemberPath.file,
            member: parsedMemberPath.name.toLocaleUpperCase(),
            type: '*FILE',
        });
        if (!configExists) {
            await this.testOutputLogger.log(LogLevel.Info, `No QSYS testing configuration found at ${testingConfigPath}`);
            return;
        }

        try {
            // Read and parse file
            const testingConfig = await content.downloadMemberContent(parsedMemberPath.library, parsedMemberPath.file, parsedMemberPath.name);
            return JSON.parse(testingConfig.toString()) as TestingConfig;
        } catch (error: any) {
            this.testOutputLogger.appendWithNotification(LogLevel.Error, `Failed to read QSYS testing configuration`, `${testingConfigPath} - ${error}`);
            return;
        }
    }
}