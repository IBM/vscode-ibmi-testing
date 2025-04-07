import { ComponentIdentification, ComponentState, IBMiComponent } from "@halcyontech/vscode-ibmi-types/api/components/component";
import IBMi from "@halcyontech/vscode-ibmi-types/api/IBMi";
import { Configuration, Section, defaultConfigurations } from "./configuration";
import { compareVersions } from 'compare-versions';
import { GitHub, Tag } from "./github";
import { ProgressLocation, QuickPickItem, window } from "vscode";
import * as tmp from "tmp";
import * as path from "path";
import * as unzipper from "unzipper";

export class RPGUnitComponent implements IBMiComponent {
    static ID: string = "RPGUnit";
    static VERSION_REGEX = /copyright information:\\n\s*(v\S*)\s*-/i;
    private minimumVersion: string = '5.1.0'; // TODO: Minimum might be 5.2.0?

    getIdentification(): ComponentIdentification {
        return {
            name: RPGUnitComponent.ID,
            version: 1
        };
    }

    async getRemoteState(connection: IBMi, installDirectory: string): Promise<ComponentState> {
        const content = connection.getContent();

        try {
            // Get installed version of RPGUnit
            const productLibrary = Configuration.get<string>(Section.productLibrary) || defaultConfigurations[Section.productLibrary];
            const versionCommand = content.toCl(`DSPSRVPGM`, { 'SRVPGM': `${productLibrary}/RUTESTCASE` });
            const versionResult = await connection.runCommand({ command: versionCommand, environment: `ile` });

            // Compare installed version with minimum version
            if (versionResult.code === 0) {
                const versionMatch = versionResult.stdout.match(RPGUnitComponent.VERSION_REGEX);
                if (versionMatch && versionMatch[1]) {
                    const installedVersion = versionMatch[1];
                    if (compareVersions(this.minimumVersion, installedVersion) > 0) {
                        return 'NeedsUpdate';
                    } else {
                        return 'Installed';
                    }
                } else {
                    return 'Error';
                }
            } else {
                return 'Error';
            }
        } catch (error) {
            return 'NotInstalled';
        }
    }

    async update(connection: IBMi, installDirectory: string): Promise<ComponentState> {
        // Get tags from GitHub
        const tags = await GitHub.getTags();
        if (tags.error) {
            window.showErrorMessage(`Failed to retrieve GitHub tags. Error: ${tags.error}`);
            return 'Error';
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
            return 'Error';
        }

        await window.withProgress({
            location: ProgressLocation.Notification,
            title: `Installing RPGUnit ${selectedTag.label}`
        }, async (progress) => {
            const content = connection.getContent();
            const config = connection.getConfig();

            progress.report({ message: `Downloading zip locally` });
            const tmpFile = tmp.fileSync();
            const isDownlodaded = await GitHub.downloadTag(selectedTag.tag, tmpFile.name);
            if (!isDownlodaded.data) {
                window.showErrorMessage(`Failed to download zip. Error: ${isDownlodaded.error}`);
                return 'Error';
            }

            progress.report({ message: `Extracting zip locally` });
            let tmpDir;
            try {
                tmpDir = tmp.dirSync({ unsafeCleanup: true });
                const directory = await unzipper.Open.file(tmpFile.name);
                await directory.extract({ path: tmpDir.name });
            } catch (error) {
                window.showErrorMessage(`Failed to extract zip. Error: ${error}`);
                return 'Error';
            }

            progress.report({ message: `Uploading save file to IFS` });
            const localPath = path.join(tmpDir.name, `${GitHub.OWNER}-${GitHub.REPO}-${selectedTag.tag.commit.sha.substring(0, 7)}`, 'docs', 'update-site', 'eclipse', 'rdi8.0', 'Server', 'RPGUNIT.SAVF');
            const remotePath = path.posix.join(installDirectory, 'RPGUNIT.SAVF');
            try {
                await content.uploadFiles([{ local: localPath, remote: remotePath }]);
            } catch (error) {
                window.showErrorMessage(`Failed to upload save file. Error: ${error}`);
                return 'Error';
            }

            progress.report({ message: `Creating save file in ${config.tempLibrary}` });
            const createSavfCommand = content.toCl(`CRTSAVF`, {
                'FILE': `${config.tempLibrary}/RPGUNIT`
            });
            const createSavfResult = await connection.runCommand({ command: createSavfCommand, environment: `ile` });
            if (createSavfResult.code !== 0 && !createSavfResult.stderr.startsWith('CPF5813')) {
                window.showErrorMessage(`Failed to create save file. Error: ${createSavfResult.stderr}`);
                return 'Error';
            }

            progress.report({ message: `Transfering save file to ${config.tempLibrary}` });
            const transferCommand = content.toCl(`CPY`, {
                'OBJ': remotePath,
                'TOOBJ': `\'/QSYS.LIB/${config.tempLibrary}.LIB/RPGUNIT.FILE\'`,
                'TOCCSID': 37,
                'REPLACE': `*YES`
            });
            const transferResult = await connection.runCommand({ command: transferCommand, environment: `ile` });
            if (transferResult.code !== 0) {
                window.showErrorMessage(`Failed to transfer save file. Error: ${transferResult.stderr}`);
                return 'Error';
            }

            const productLibrary = Configuration.get<string>(Section.productLibrary) || defaultConfigurations[Section.productLibrary];
            progress.report({ message: `Creating library ${productLibrary}` });
            const createLibCommand = content.toCl(`CRTLIB`, { 'LIB': productLibrary });
            const createLibResult = await connection.runCommand({ command: createLibCommand, environment: `ile` });
            if (createLibResult.code !== 0 && createLibResult.stderr.startsWith('CPF2111')) {
                progress.report({ message: `Clearing library ${productLibrary}` });
                const clearCommand = content.toCl(`CLRLIB`, { 'LIB': productLibrary });
                const clearResult = await connection.runCommand({ command: clearCommand, environment: `ile` });
                if (clearResult.code !== 0) {
                    window.showErrorMessage(`Failed to clear library. Error: ${clearResult.stderr}`);
                    return 'Error';
                }
            }

            progress.report({ message: `Restoring library` });
            const restoreCommand = content.toCl(`RSTLIB`, {
                'SAVLIB': productLibrary,
                'DEV': `*SAVF`,
                'SAVF': `${config.tempLibrary}/RPGUNIT`
            });
            const restoreResult = await connection.runCommand({ command: restoreCommand, environment: `ile` });
            if (restoreResult.code !== 0) {
                window.showErrorMessage(`Failed to restore library. Error: ${restoreResult.stderr}`);
            }

            progress.report({ message: `Clean up` });
            tmpFile.removeCallback();
            tmpDir.removeCallback();
            await connection.runCommand({ command: `rm -rf ${remotePath}` });
        });

        return 'Installed';
    }
}