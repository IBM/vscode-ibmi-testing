import { ComponentIdentification, ComponentState, IBMiComponent } from "@halcyontech/vscode-ibmi-types/api/components/component";
import { Tools } from "@halcyontech/vscode-ibmi-types/api/Tools";
import IBMi from "@halcyontech/vscode-ibmi-types/api/IBMi";
import { Configuration, Section } from "../configuration";
import { compareVersions } from 'compare-versions';
import { GitHub, Release } from "../github";
import { commands, env, LogLevel, ProgressLocation, QuickPickItem, QuickPickItemKind, Uri, window } from "vscode";
import * as tmp from "tmp";
import * as path from "path";
import { getInstance } from "../extensions/ibmi";
import { testOutputLogger } from "../extension";

export class RPGUnit implements IBMiComponent {
    static ID: string = "RPGUnit";
    static MINIMUM_VERSION: string = '6.0.0';
    static VERSION_REGEX = 'v\\d+(\\.\\d+){2}(\\.b\\d{1,3}|\\.r)?';
    static EXTENSION_VERSION: string;

    constructor(installedVersion: string) {
        RPGUnit.EXTENSION_VERSION = installedVersion;
    }

    getIdentification(): ComponentIdentification {
        return {
            name: RPGUnit.ID,
            version: RPGUnit.MINIMUM_VERSION,
            userManaged: true
        };
    }

    async getRemoteState(connection: IBMi, installDirectory: string): Promise<ComponentState> {
        const content = connection.getContent();

        try {
            // Check if product library exists
            const productLibrary = connection.upperCaseName(Configuration.getOrFallback<string>(Section.productLibrary));
            const productLibraryExists = await content.checkObject({ library: 'QSYS', name: productLibrary, type: '*LIB' });
            if (productLibraryExists) {
                // Get installed version of RPGUnit
                const versionCommand = content.toCl(`DSPSRVPGM`, { 'SRVPGM': `${productLibrary}/RUTESTCASE`, 'DETAIL': '*COPYRIGHT' });
                const versionResult = await connection.runCommand({ command: versionCommand, environment: `ile`, noLibList: true });

                if (versionResult.code === 0) {
                    const versionMatch = versionResult.stdout.match(RPGUnit.VERSION_REGEX);
                    if (versionMatch && versionMatch[0]) {
                        const installedVersion = versionMatch[0].startsWith('v') ? versionMatch[0].substring(1) : versionMatch[0];

                        // Compare installed version with minimum version
                        if (await this.compareVersions(installedVersion, RPGUnit.MINIMUM_VERSION) >= 0) {
                            await testOutputLogger.log(LogLevel.Info, `Installed version of RPGUnit is v${installedVersion}`);
                            return 'Installed';
                        } else {
                            await testOutputLogger.log(LogLevel.Error, `Installed version of RPGUnit (v${installedVersion}) is lower than minimum version (v${RPGUnit.MINIMUM_VERSION})`);
                            return 'NeedsUpdate';
                        }
                    } else {
                        await testOutputLogger.log(LogLevel.Error, `Failed to parse installed version of RPGUnit`);
                        return 'NeedsUpdate';
                    }
                } else {
                    await testOutputLogger.log(LogLevel.Error, `Failed to get installed version of RPGUnit. Error: ${versionResult.stderr}`);
                    return 'NeedsUpdate';
                }
            } else {
                await testOutputLogger.log(LogLevel.Error, `Product library ${productLibrary}.LIB does not exist`);
                return 'NotInstalled';
            }
        } catch (error) {
            await testOutputLogger.log(LogLevel.Error, `Failed to get remote state of RPGUnit component. Error: ${error}`);
            return 'Error';
        }
    }

    async update(connection: IBMi, installDirectory: string): Promise<ComponentState> {
        const errorButtons = [
            {
                label: 'Try Again',
                func: async () => {
                    const componentManager = connection.getComponentManager();
                    await componentManager.installComponent(RPGUnit.ID);
                }
            }
        ];

        // Get current component state
        const state = await this.getRemoteState(connection, installDirectory);

        // Get releases from GitHub
        const releases = await GitHub.getReleases();
        if (releases.error) {
            await testOutputLogger.appendWithNotification(LogLevel.Error, `Failed to retrieve GitHub releases from tools-400/irpgunit`, releases.error, errorButtons);
            return state;
        }

        // Filter releases (exclude releases which are drafts, do not have the required asset, or are below the minimum version)
        const supportedReleases: Release[] = [];
        const unsupportedReleases: Release[] = [];
        for await (const release of releases.data) {
            let version = release.name || release.tag_name;
            version = version.startsWith('v') ? version.substring(1) : version;
            const isValid = (release.draft === false) &&
                (release.assets.some(asset => asset.name === GitHub.ASSET_NAME)) &&
                (await this.compareVersions(version, RPGUnit.MINIMUM_VERSION)) >= 0;

            if (isValid) {
                supportedReleases.push(release);
            } else {
                unsupportedReleases.push(release);
            }
        }

        if (supportedReleases.length === 0) {
            await testOutputLogger.appendWithNotification(LogLevel.Error, `No GitHub releases found which are above the minimum version (${RPGUnit.MINIMUM_VERSION})`, undefined, errorButtons);
            return state;
        } else {
            await testOutputLogger.log(LogLevel.Info, `Found ${supportedReleases.length} compatible and ${unsupportedReleases.length} incompatible GitHub release(s) in ${GitHub.OWNER}/${GitHub.REPO}`);
        }

        // Prompt user to select a release
        function getQuickPickItems(releases: Release[]): (QuickPickItem & { release: Release })[] {
            const items: (QuickPickItem & { release: Release })[] = releases.map(release => {
                const version = release.name || release.tag_name;
                const publishedAt = release.published_at ? new Date(release.published_at).toLocaleString() : undefined;
                const preRelease = release.prerelease ? ' (Pre-release)' : '';
                const description = (publishedAt ?
                    (preRelease ? `${publishedAt} (Pre-release)` : publishedAt) :
                    (preRelease ? `(Pre-release)` : ''));

                return {
                    label: version,
                    description: description,
                    release: release
                };
            });
            return items;
        }
        const selectedItem = await window.showQuickPick([
            { label: 'Compatible', kind: QuickPickItemKind.Separator },
            ...getQuickPickItems(supportedReleases),
            { label: 'Incompatible', kind: QuickPickItemKind.Separator },
            ...getQuickPickItems(unsupportedReleases)
        ], {
            title: 'Select the GitHub release to install from',
            placeHolder: 'GitHub Release'
        });
        if (!selectedItem) {
            await testOutputLogger.appendWithNotification(LogLevel.Error, `Installation aborted as GitHub release was not selected`, undefined, errorButtons);
            return state;
        }
        const selectedRelease = selectedItem as (QuickPickItem & { release: Release });

        testOutputLogger.show();
        const content = connection.getContent();
        const config = connection.getConfig();

        // Check if product library exists
        const productLibrary = connection.upperCaseName(Configuration.getOrFallback<string>(Section.productLibrary));
        const productLibraryExists = await content.checkObject({ library: 'QSYS', name: productLibrary, type: '*LIB' });
        if (productLibraryExists) {
            const result = await window.showInformationMessage('Delete product library',
                {
                    modal: true,
                    detail: `The product library ${productLibrary}.LIB already exists. Can it be deleted?`
                },
                'Yes', 'No'
            );
            if (result === 'Yes') {
                // Deleting product library
                const deleteLibCommand = content.toCl(`DLTOBJ`, { 'OBJ': `QSYS/${productLibrary}`, 'OBJTYPE': `*LIB` });
                await testOutputLogger.log(LogLevel.Info, `Deleting product library ${productLibrary}.LIB: ${deleteLibCommand}`);
                const deleteLibResult = await connection.runCommand({ command: deleteLibCommand, environment: `ile`, noLibList: true });
                if (deleteLibResult.code !== 0) {
                    // Check for object locks on product library
                    let objectLockInfo: Tools.DB2Row[] | undefined;
                    try {
                        objectLockInfo = await connection.runSQL(`SELECT * FROM QSYS2.OBJECT_LOCK_INFO WHERE SYSTEM_OBJECT_SCHEMA = 'QSYS' AND SYSTEM_OBJECT_NAME = '${productLibrary}' AND OBJECT_TYPE = '*LIB'`);
                    } catch (error) { }
                    await testOutputLogger.appendWithNotification(LogLevel.Error, `Failed to delete product library ${productLibrary}.LIB`, deleteLibResult.stderr, errorButtons);
                    if (objectLockInfo && objectLockInfo.length > 0) {
                        await testOutputLogger.appendWithNotification(LogLevel.Error, `${objectLockInfo.length} object lock(s) found on ${productLibrary}.LIB`, `\n${JSON.stringify(objectLockInfo, null, 2)}`, errorButtons);
                    }
                    return state;
                }
            } else {
                await testOutputLogger.appendWithNotification(LogLevel.Error, `Installation aborted as product library was not deleted`, undefined, errorButtons);
                return state;
            }
        }

        // Downloading save file locally
        const localTempDir = tmp.dirSync({ unsafeCleanup: true });
        await testOutputLogger.log(LogLevel.Info, `Downloading ${GitHub.ASSET_NAME} GitHub release asset from ${selectedRelease.release.name} to ${localTempDir.name}`);
        const asset = selectedRelease.release.assets.find(asset => asset.name === GitHub.ASSET_NAME)!;
        const isDownloaded = await GitHub.downloadReleaseAsset(asset, localTempDir.name);
        if (!isDownloaded.data) {
            await testOutputLogger.appendWithNotification(LogLevel.Error, `Failed to download GitHub release asset ${GitHub.ASSET_NAME}`, isDownloaded.error, errorButtons);
            return state;
        }

        // Uploading save file to IFS
        const localPath = path.join(localTempDir.name, GitHub.ASSET_NAME);
        const remoteTempDir = config.tempDir;
        const remotePath = path.posix.join(remoteTempDir, GitHub.ASSET_NAME);
        try {
            await testOutputLogger.log(LogLevel.Info, `Uploading ${GitHub.ASSET_NAME} to ${remotePath}`);
            await content.uploadFiles([{ local: localPath, remote: remotePath }]);
        } catch (error: any) {
            await testOutputLogger.appendWithNotification(LogLevel.Error, `Failed to upload ${GitHub.ASSET_NAME}`, error, errorButtons);
            return state;
        }

        // Creating save file in temporary library
        const tempLibrary = connection.upperCaseName(config.tempLibrary);
        const createSavfCommand = content.toCl(`CRTSAVF`, {
            'FILE': `${tempLibrary}/RPGUNIT`
        });
        await testOutputLogger.log(LogLevel.Info, `Creating ${GitHub.ASSET_NAME} in ${tempLibrary}.LIB: ${createSavfCommand}`);
        const createSavfResult = await connection.runCommand({ command: createSavfCommand, environment: `ile`, noLibList: true });
        if (createSavfResult.code !== 0 && !createSavfResult.stderr.includes('CPF5813')) {
            await testOutputLogger.appendWithNotification(LogLevel.Error, `Failed to create ${GitHub.ASSET_NAME}`, createSavfResult.stderr, errorButtons);
            return state;
        }

        // Transfer save file to temporary library
        const transferCommand = content.toCl(`CPYFRMSTMF`, {
            'FROMSTMF': remotePath,
            'TOMBR': `\'/QSYS.LIB/${tempLibrary}.LIB/RPGUNIT.FILE\'`,
            'STMFCCSID': 37,
            'MBROPT': `*REPLACE`
        });
        await testOutputLogger.log(LogLevel.Info, `Transferring ${GitHub.ASSET_NAME} to ${tempLibrary}.LIB: ${transferCommand}`);
        const transferResult = await connection.runCommand({ command: transferCommand, environment: `ile`, noLibList: true });
        if (transferResult.code !== 0) {
            await testOutputLogger.appendWithNotification(LogLevel.Error, `Failed to transfer ${GitHub.ASSET_NAME}`, transferResult.stderr, errorButtons);
            return state;
        }

        // Restoring library
        const restoreCommand = content.toCl(`RSTLIB`, {
            'SAVLIB': 'RPGUNIT',
            'DEV': `*SAVF`,
            'SAVF': `${tempLibrary}/RPGUNIT`,
            'RSTLIB': productLibrary
        });
        await testOutputLogger.log(LogLevel.Info, `Restoring ${GitHub.ASSET_NAME} contents into ${productLibrary}.LIB: ${restoreCommand}`);
        const restoreResult = await connection.runCommand({ command: restoreCommand, environment: `ile`, noLibList: true });
        if (restoreResult.code !== 0) {
            await testOutputLogger.appendWithNotification(LogLevel.Error, `Failed to restore ${GitHub.ASSET_NAME} contents`, restoreResult.stderr, errorButtons);
            return state;
        }

        // Clean up
        await testOutputLogger.log(LogLevel.Info, `Cleaning up temporary files`);
        localTempDir.removeCallback();
        await connection.runCommand({ command: `rm -rf ${remotePath}` });

        const newState = await this.getRemoteState(connection, installDirectory);
        if (newState === 'Installed') {
            await testOutputLogger.appendWithNotification(LogLevel.Info, `RPGUnit ${selectedRelease.release.name} installed successfully into ${productLibrary}.LIB`);
        } else {
            await testOutputLogger.appendWithNotification(LogLevel.Error, `RPGUnit ${selectedRelease.release.name} failed to install into ${productLibrary}.LIB`, undefined, errorButtons);
        }
        return newState;
    }

    async compareVersions(v1: string, v2: string): Promise<number> {
        function normalize(v: string) {
            // Remove prefix
            v = v.replace('v', '');

            // Remove production suffix
            v = v.replace('.r', '');

            // Convert beta suffix
            if (!v.includes('-beta.')) {
                v = v.includes('.b') ? v.replace('.b', '-beta.') : v.includes('b') ? v.replace('b', '-beta.') : v;
            }

            return v;
        }

        try {
            return compareVersions(normalize(v1), normalize(v2));
        } catch (error) {
            await testOutputLogger.log(LogLevel.Error, `Failed to compare versions ${v1} and ${v2}. Error: ${error}`);
            return -1;
        }
    }

    static async checkInstallation(): Promise<{ status: boolean, error?: string }> {
        const ibmi = getInstance();
        const connection = ibmi!.getConnection()!;

        const componentManager = connection.getComponentManager();
        const state = await componentManager.getRemoteState(RPGUnit.ID);
        const productLibrary = connection.upperCaseName(Configuration.getOrFallback<string>(Section.productLibrary));
        const title = state === 'NeedsUpdate' ?
            'RPGUnit Update Required' :
            'RPGUnit Installation Required';
        const installMessage = state === 'NeedsUpdate' ?
            `RPGUnit must be updated to v${RPGUnit.MINIMUM_VERSION} on the IBM i to use v${RPGUnit.EXTENSION_VERSION} of the IBM i Testing extension.` :
            (state !== 'Installed' ? `RPGUnit must be installed with at least v${RPGUnit.MINIMUM_VERSION} on the IBM i to use v${RPGUnit.EXTENSION_VERSION} of the IBM i Testing extension.` : undefined);
        const installQuestion = state === 'NeedsUpdate' ?
            `Can it be updated in ${productLibrary}.LIB?` :
            (state !== 'Installed' ? `Can it be installed into ${productLibrary}.LIB?` : undefined);
        const installButton = state === 'NeedsUpdate' ?
            'Update' :
            (state !== 'Installed' ? 'Install' : undefined);
        const compatabilityMessage = `It is always recommended to stay current to leverage the latest enhancements. However if you would like to keep the current version of RPGUnit, check the documentation to see what version of the extension is compatible.`;
        const configreProductLibraryMessage = `You can also maintain several different versions of RPGUnit by installing it into a different library. Simply configure the product library in the extension settings and make sure to set your library list accordingly.`;
        const progressBarMessage = state === 'NeedsUpdate' ?
            `Updating ${RPGUnit.ID}` :
            `Installing ${RPGUnit.ID}`;

        if (installMessage && installQuestion && installButton) {
            // Prompt user to install or update RPGUnit
            window.showErrorMessage(title, { modal: true, detail: `${installMessage} ${installQuestion}\n\n${compatabilityMessage}\n\n${configreProductLibraryMessage}` }, installButton, 'Configure Product Library', 'View Documentation').then(async (value) => {
                if (value === installButton) {
                    await window.withProgress({ title: `Components`, location: ProgressLocation.Notification }, async (progress) => {
                        progress.report({ message: progressBarMessage });
                        await componentManager.installComponent(RPGUnit.ID);
                    });
                } else if (value === 'Configure Product Library') {
                    await commands.executeCommand('workbench.action.openSettings', '@ext:IBM.vscode-ibmi-testing');
                } else if (value === 'View Documentation') {
                    await env.openExternal(Uri.parse('https://codefori.github.io/docs/developing/testing/overview/#2-rpgunit'));
                }
            });
            return { status: false, error: installMessage };
        } else {
            return { status: true };
        }
    }
}