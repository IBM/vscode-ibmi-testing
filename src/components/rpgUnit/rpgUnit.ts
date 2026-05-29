import { ComponentIdentification, IBMiComponent, SecureComponentState } from "@halcyontech/vscode-ibmi-types/api/components/component";
import { Tools } from "@halcyontech/vscode-ibmi-types/api/Tools";
import IBMi from "@halcyontech/vscode-ibmi-types/api/IBMi";
import { Configuration, Section } from "../../configuration";
import { compareVersions } from 'compare-versions';
import { commands, env, ExtensionContext, LogLevel, ProgressLocation, Uri, window } from "vscode";
import { existsSync } from "fs";
import * as path from "path";
import { getInstance, getVSCodeTools } from "../../extensions/ibmi";
import { testOutputLogger } from "../../extension";
import { LOCAL_SAVE_FILE, OWNER, REPO, GITHUB_SAVE_FILE, SERVER_VERSION_TAG, VERSION } from "./version";

export class RPGUnit implements IBMiComponent {
    static ID: string = "RPGUnit";
    static VERSION_REGEX = 'v\\d+(\\.\\d+){2}(\\.b\\d{1,3}|\\.r)?';
    static EXTENSION_VERSION: string;

    private readonly localAssetPath: string;

    constructor(context: ExtensionContext) {
        RPGUnit.EXTENSION_VERSION = context.extension.packageJSON.version;
        this.localAssetPath = path.join(context.extensionPath, `dist`, LOCAL_SAVE_FILE);
    }

    getIdentification(): ComponentIdentification {
        return {
            name: RPGUnit.ID,
            version: VERSION,
            userManaged: true
        } as any;
    }

    async getRemoteState(connection: IBMi, installDirectory: string): Promise<SecureComponentState> {
        const content = connection.getContent();

        try {
            // Check if product library exists
            const productLibrary = connection.upperCaseName(Configuration.getOrFallback<string>(Section.productLibrary));
            const productLibraryExists = await content.checkObject({ library: 'QSYS', name: productLibrary, type: '*LIB' });
            if (productLibraryExists) {
                // Get installed version of RPGUnit
                const copyrightResult = await connection.runSQL(`SELECT COPYRIGHT_STRINGS FROM QSYS2.PROGRAM_INFO WHERE PROGRAM_LIBRARY = '${productLibrary}' AND PROGRAM_NAME = 'RUTESTCASE' AND OBJECT_TYPE = '*SRVPGM'`);
                if (copyrightResult.length > 0) {
                    const copyrightStrings = copyrightResult[0].COPYRIGHT_STRINGS;
                    if (copyrightStrings) {
                        // Parse the copyright strings
                        const copyrightJson = JSON.parse(String(copyrightStrings));
                        const copyrights = copyrightJson.COPYRIGHTS;

                        // Get installed version from copyright strings
                        let installedVersion: string | null = null;
                        for (const copyright of copyrights) {
                            const versionMatch = copyright.match(RPGUnit.VERSION_REGEX);
                            if (versionMatch && versionMatch[0]) {
                                installedVersion = versionMatch[0].startsWith('v') ? versionMatch[0].substring(1) : versionMatch[0];
                                break;
                            }
                        }

                        if (installedVersion) {
                            // Compare installed version with minimum version
                            if (await this.compareVersions(installedVersion, VERSION) >= 0) {
                                await testOutputLogger.log(LogLevel.Info, `Installed version of RPGUnit is v${installedVersion}`);
                                return { status: `Installed` };
                            } else {
                                await testOutputLogger.log(LogLevel.Error, `Installed version of RPGUnit (v${installedVersion}) is lower than minimum version (v${VERSION})`);
                                return { status: `NeedsUpdate` };
                            }
                        } else {
                            await testOutputLogger.log(LogLevel.Error, `Failed to parse installed version of RPGUnit`);
                            return { status: `NeedsUpdate` };
                        }
                    } else {
                        await testOutputLogger.log(LogLevel.Error, `Failed to get installed version of RPGUnit as copyright string format changed.`);
                        return { status: `NeedsUpdate` };
                    }
                } else {
                    await testOutputLogger.log(LogLevel.Error, `Failed to get installed version of RPGUnit as no copyright strings found.`);
                    return { status: `NeedsUpdate` };
                }
            } else {
                await testOutputLogger.log(LogLevel.Error, `Product library ${productLibrary}.LIB does not exist`);
                return { status: `NotInstalled` };
            }
        } catch (error) {
            await testOutputLogger.log(LogLevel.Error, `Failed to get remote state of RPGUnit component. Error: ${error}`);
            return { status: `Error` };
        }
    }

    async update(connection: IBMi, installDirectory: string): Promise<SecureComponentState> {
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

        testOutputLogger.show();
        const content = connection.getContent();
        const config = connection.getConfig();

        // Check if bundled save file exists
        await testOutputLogger.log(LogLevel.Info, `Locating bundled ${LOCAL_SAVE_FILE}: ${this.localAssetPath}`);
        if (!existsSync(this.localAssetPath)) {
            await testOutputLogger.appendWithNotification(LogLevel.Error, `Bundled save file not found at ${this.localAssetPath}. Navigate to the GitHub releases page and install it manually.`, undefined, [
                ...errorButtons,
                {
                    label: 'View GitHub Release',
                    func: async () => {
                        await env.openExternal(Uri.parse(`https://github.com/${OWNER}/${REPO}/releases/tag/${SERVER_VERSION_TAG}`));
                    }
                }
            ]);
            return state;
        }

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
                const deleteLibCommand = content.toCl(`QSYS/DLTOBJ`, { 'OBJ': `QSYS/${productLibrary}`, 'OBJTYPE': `*LIB` });
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

        // Uploading save file to IFS
        const vsCodeTools = getVSCodeTools(); // TODO: Replace with connection.getTempDirectory();
        const remoteTempDir = vsCodeTools!.ensureFullPath(config.tempDir, config.homeDirectory);
        const remotePath = path.posix.join(remoteTempDir, LOCAL_SAVE_FILE);
        try {
            await testOutputLogger.log(LogLevel.Info, `Uploading ${LOCAL_SAVE_FILE} to ${remotePath}`);
            await content.uploadFiles([{ local: this.localAssetPath, remote: remotePath }]);
        } catch (error: any) {
            await testOutputLogger.appendWithNotification(LogLevel.Error, `Failed to upload ${LOCAL_SAVE_FILE}`, error, errorButtons);
            return state;
        }

        // Creating save file in temporary library
        const tempLibrary = connection.upperCaseName(config.tempLibrary);
        const createSavfCommand = content.toCl(`QSYS/CRTSAVF`, {
            'FILE': `${tempLibrary}/RPGUNIT`
        });
        await testOutputLogger.log(LogLevel.Info, `Creating ${GITHUB_SAVE_FILE} in ${tempLibrary}.LIB: ${createSavfCommand}`);
        const createSavfResult = await connection.runCommand({ command: createSavfCommand, environment: `ile`, noLibList: true });
        if (createSavfResult.code !== 0 && !createSavfResult.stderr.includes('CPF5813')) {
            await testOutputLogger.appendWithNotification(LogLevel.Error, `Failed to create ${GITHUB_SAVE_FILE}`, createSavfResult.stderr, errorButtons);
            return state;
        }

        // Transfer save file to temporary library
        const transferCommand = content.toCl(`QSYS/CPYFRMSTMF`, {
            'FROMSTMF': remotePath,
            'TOMBR': `\'/QSYS.LIB/${tempLibrary}.LIB/RPGUNIT.FILE\'`,
            'STMFCCSID': 37,
            'MBROPT': `*REPLACE`
        });
        await testOutputLogger.log(LogLevel.Info, `Transferring ${LOCAL_SAVE_FILE} to ${tempLibrary}.LIB: ${transferCommand}`);
        const transferResult = await connection.runCommand({ command: transferCommand, environment: `ile`, noLibList: true });
        if (transferResult.code !== 0) {
            await testOutputLogger.appendWithNotification(LogLevel.Error, `Failed to transfer ${LOCAL_SAVE_FILE}`, transferResult.stderr, errorButtons);
            return state;
        }

        // Restoring library
        const restoreCommand = content.toCl(`QSYS/RSTLIB`, {
            'SAVLIB': 'RPGUNIT',
            'DEV': `*SAVF`,
            'SAVF': `${tempLibrary}/RPGUNIT`,
            'RSTLIB': productLibrary
        });
        await testOutputLogger.log(LogLevel.Info, `Restoring ${GITHUB_SAVE_FILE} contents into ${productLibrary}.LIB: ${restoreCommand}`);
        const restoreResult = await connection.runCommand({ command: restoreCommand, environment: `ile`, noLibList: true });
        if (restoreResult.code !== 0) {
            await testOutputLogger.appendWithNotification(LogLevel.Error, `Failed to restore ${GITHUB_SAVE_FILE} contents`, restoreResult.stderr, errorButtons);
            return state;
        }

        // Clean up
        await testOutputLogger.log(LogLevel.Info, `Cleaning up temporary files`);
        await connection.runCommand({ command: `rm -rf ${remotePath}` });

        const newState = await this.getRemoteState(connection, installDirectory);
        if (newState.status === 'Installed') {
            await testOutputLogger.appendWithNotification(LogLevel.Info, `RPGUnit v${VERSION} installed successfully into ${productLibrary}.LIB`);
        } else {
            await testOutputLogger.appendWithNotification(LogLevel.Error, `RPGUnit v${VERSION} failed to install into ${productLibrary}.LIB`, undefined, errorButtons);
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
        const status = state?.status;
        const productLibrary = connection.upperCaseName(Configuration.getOrFallback<string>(Section.productLibrary));
        const title = status === 'NeedsUpdate' ?
            'RPGUnit Update Required' :
            'RPGUnit Installation Required';
        const installMessage = status === 'NeedsUpdate' ?
            `RPGUnit must be updated to v${VERSION} on the IBM i to use v${RPGUnit.EXTENSION_VERSION} of the IBM i Testing extension.` :
            (status !== 'Installed' ? `RPGUnit must be installed with at least v${VERSION} on the IBM i to use v${RPGUnit.EXTENSION_VERSION} of the IBM i Testing extension.` : undefined);
        const installQuestion = status === 'NeedsUpdate' ?
            `Can it be updated in ${productLibrary}.LIB?` :
            (status !== 'Installed' ? `Can it be installed into ${productLibrary}.LIB?` : undefined);
        const installButton = status === 'NeedsUpdate' ?
            'Update' :
            (status !== 'Installed' ? 'Install' : undefined);
        const compatabilityMessage = `It is always recommended to stay current to leverage the latest enhancements. However if you would like to keep the current version of RPGUnit, check the documentation to see what version of the extension is compatible.`;
        const configreProductLibraryMessage = `You can also maintain several different versions of RPGUnit by installing it into a different library. Simply configure the product library in the extension settings and make sure to set your library list accordingly.`;
        const progressBarMessage = status === 'NeedsUpdate' ?
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