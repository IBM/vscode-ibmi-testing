import { ComponentIdentification, ComponentState, IBMiComponent } from "@halcyontech/vscode-ibmi-types/api/components/component";
import IBMi from "@halcyontech/vscode-ibmi-types/api/IBMi";
import { Configuration, Section, defaultConfigurations } from "./configuration";
import { compareVersions } from 'compare-versions';
import { GitHub, Tag } from "./github";
import { LogLevel, QuickPickItem, window } from "vscode";
import * as tmp from "tmp";
import * as path from "path";
import * as unzipper from "unzipper";
import { Logger } from "./outputChannel";

export class RPGUnitComponent implements IBMiComponent {
    static ID: string = "RPGUnit";
    static MINIMUM_VERSION: string = '5.1.0';
    static VERSION_REGEX = /copyright information:\n\s*(v\S*)\s*-/i;

    getIdentification(): ComponentIdentification {
        return {
            name: RPGUnitComponent.ID,
            version: semverToNumber(RPGUnitComponent.MINIMUM_VERSION),
            userManaged: true
        };
    }

    async getRemoteState(connection: IBMi, installDirectory: string): Promise<ComponentState> {
        const content = connection.getContent();

        try {
            // Check of library exists
            const productLibrary = Configuration.get<string>(Section.productLibrary) || defaultConfigurations[Section.productLibrary];
            const productLibraryExists = await content.checkObject({ library: 'QSYS', name: productLibrary, type: '*LIB' });
            if (productLibraryExists) {
                // Get installed version of RPGUnit
                const versionCommand = content.toCl(`DSPSRVPGM`, { 'SRVPGM': `${productLibrary}/RUTESTCASE` });
                const versionResult = await connection.runCommand({ command: versionCommand, environment: `ile` });

                if (versionResult.code === 0) {
                    const versionMatch = versionResult.stdout.match(RPGUnitComponent.VERSION_REGEX);
                    if (versionMatch && versionMatch[1]) {
                        const installedVersion = versionMatch[1];

                        // Compare installed version with minimum version
                        if (compareVersions(RPGUnitComponent.MINIMUM_VERSION, installedVersion) > 0) {
                            Logger.log(LogLevel.Error, `Installed version of RPGUnit (${installedVersion}) is lower than minimum version (${RPGUnitComponent.MINIMUM_VERSION})`);
                            return 'NeedsUpdate';
                        } else {
                            Logger.log(LogLevel.Info, `Installed version of RPGUnit is ${installedVersion}`);
                            return 'Installed';
                        }
                    } else {
                        Logger.log(LogLevel.Error, `Failed to parse installed version of RPGUnit`);
                        return 'NeedsUpdate';
                    }
                } else {
                    Logger.log(LogLevel.Error, `Failed to get installed version of RPGUnit. Error: ${versionResult.stderr}`);
                    return 'NeedsUpdate';
                }
            } else {
                Logger.log(LogLevel.Error, `Product library ${productLibrary}.LIB does not exist`);
                return 'NotInstalled';
            }
        } catch (error) {
            Logger.log(LogLevel.Error, `Failed to get remote state of RPGUnit component. Error: ${error}`);
            return 'Error';
        }
    }

    async update(connection: IBMi, installDirectory: string): Promise<ComponentState> {
        // TODO: Instead of getting tags, get the releases
        // TODO: Only show versions above the minimum

        // Get current component state
        const state = await this.getRemoteState(connection, installDirectory);

        // Get tags from GitHub
        const tags = await GitHub.getTags();
        if (tags.error) {
            window.showErrorMessage(`Failed to retrieve GitHub tags. Error: ${tags.error}`);
            return state;
        }

        // Prompt user to select a tag
        const items: (QuickPickItem & { tag: Tag })[] = tags.data.map(tag => {
            return {
                label: tag.name,
                tag: tag
            };
        });
        const selectedTag = await window.showQuickPick(items, {
            title: 'Select the version to install',
            placeHolder: 'Version'
        });
        if (!selectedTag) {
            return state;
        }

        const content = connection.getContent();
        const config = connection.getConfig();

        // Downloading zip locally
        const tmpFile = tmp.fileSync();
        Logger.log(LogLevel.Info, `Downloading zip to ${tmpFile.name}`);
        const isDownlodaded = await GitHub.downloadTag(selectedTag.tag, tmpFile.name);
        if (!isDownlodaded.data) {
            Logger.logWithNotification(LogLevel.Error, `Failed to download zip`, isDownlodaded.error);
            return state;
        }

        // Extracting zip locally
        let localTempDir;
        try {
            localTempDir = tmp.dirSync({ unsafeCleanup: true });
            Logger.log(LogLevel.Info, `Extracting zip to ${localTempDir.name}`);
            const directory = await unzipper.Open.file(tmpFile.name);
            await directory.extract({ path: localTempDir.name });
        } catch (error: any) {
            Logger.logWithNotification(LogLevel.Error, `Failed to extract zip`, error);
            return state;
        }

        // Uploading save file to IFS
        const localPath = path.join(localTempDir.name, `${GitHub.OWNER}-${GitHub.REPO}-${selectedTag.tag.commit.sha.substring(0, 7)}`, 'docs', 'update-site', 'eclipse', 'rdi8.0', 'Server', 'RPGUNIT.SAVF');
        const remoteTempDir = config.tempDir;
        const remotePath = path.posix.join(remoteTempDir, 'RPGUNIT.SAVF');
        try {
            Logger.log(LogLevel.Info, `Uploading RPGUNIT save file to ${remotePath}`);
            await content.uploadFiles([{ local: localPath, remote: remotePath }]);
        } catch (error: any) {
            Logger.logWithNotification(LogLevel.Error, `Failed to upload save file`, error);
            return state;
        }

        // Creating save file in temporary library
        Logger.log(LogLevel.Info, `Creating RPGUNIT save file in ${config.tempLibrary}.LIB`);
        const createSavfCommand = content.toCl(`CRTSAVF`, {
            'FILE': `${config.tempLibrary}/RPGUNIT`
        });
        const createSavfResult = await connection.runCommand({ command: createSavfCommand, environment: `ile` });
        if (createSavfResult.code !== 0 && !createSavfResult.stderr.startsWith('CPF5813')) {
            Logger.logWithNotification(LogLevel.Error, `Failed to create save file`, createSavfResult.stderr);
            return state;
        }

        // Transfer save file to temporary library
        Logger.log(LogLevel.Info, `Transferring RPGUNIT save file to ${config.tempLibrary}.LIB`);
        const transferCommand = content.toCl(`CPY`, {
            'OBJ': remotePath,
            'TOOBJ': `\'/QSYS.LIB/${config.tempLibrary}.LIB/RPGUNIT.FILE\'`,
            'TOCCSID': 37,
            'REPLACE': `*YES`
        });
        const transferResult = await connection.runCommand({ command: transferCommand, environment: `ile` });
        if (transferResult.code !== 0) {
            Logger.logWithNotification(LogLevel.Error, `Failed to transfer save file`, transferResult.stderr);
            return state;
        }

        // Creating product library
        const productLibrary = Configuration.get<string>(Section.productLibrary) || defaultConfigurations[Section.productLibrary];
        Logger.log(LogLevel.Info, `Creating product library ${productLibrary}.LIB`);
        const createLibCommand = content.toCl(`CRTLIB`, { 'LIB': productLibrary });
        const createLibResult = await connection.runCommand({ command: createLibCommand, environment: `ile` });
        if (createLibResult.code !== 0 && createLibResult.stderr.startsWith('CPF2111')) {
            // Clearing product library
            Logger.log(LogLevel.Info, `Clearing product library ${productLibrary}.LIB`);
            const clearCommand = content.toCl(`CLRLIB`, { 'LIB': productLibrary });
            const clearResult = await connection.runCommand({ command: clearCommand, environment: `ile` });
            if (clearResult.code !== 0) {
                Logger.logWithNotification(LogLevel.Error, `Failed to clear library`, clearResult.stderr);
                return state;
            }
        }

        // Restoring library
        Logger.log(LogLevel.Info, `Restoring RPGUNIT save file contents into ${productLibrary}.LIB`);
        const restoreCommand = content.toCl(`RSTLIB`, {
            'SAVLIB': 'RPGUNIT',
            'DEV': `*SAVF`,
            'SAVF': `${config.tempLibrary}/RPGUNIT`,
            'RSTLIB': productLibrary
        });
        const restoreResult = await connection.runCommand({ command: restoreCommand, environment: `ile` });
        if (restoreResult.code !== 0) {
            Logger.logWithNotification(LogLevel.Error, `Failed to restore save file contents`, restoreResult.stderr);
            return state;
        }

        // Clean up
        Logger.log(LogLevel.Info, `Cleaning up temporary files`);
        tmpFile.removeCallback();
        localTempDir.removeCallback();
        await connection.runCommand({ command: `rm -rf ${remotePath}` });

        const newState = await this.getRemoteState(connection, installDirectory);
        if(state === 'Installed') {
            Logger.log(LogLevel.Info, `RPGUnit ${selectedTag.tag.name} installed successfully into ${productLibrary}`);
        }
        return newState;
    }
}

function semverToNumber(version: string): number {
    const [major, minor, patch] = version.split('.').map(Number);
    return major * 1_000_000 + minor * 1_000 + patch;
}