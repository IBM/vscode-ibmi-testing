import { ComponentIdentification, IBMiComponent, SecureComponentState } from "@halcyontech/vscode-ibmi-types/api/components/component";
import { Tools } from "@halcyontech/vscode-ibmi-types/api/Tools";
import IBMi from "@halcyontech/vscode-ibmi-types/api/IBMi";
import { Configuration, Section } from "../../configuration";
import { compareVersions } from 'compare-versions';
import { commands, env, ExtensionContext, LogLevel, ProgressLocation, Uri, window } from "vscode";
import { existsSync } from "fs";
import * as path from "path";
import { getInstance } from "../../extensions/ibmi";
import { testOutputLogger } from "../../extension";
import { LOCAL_SAVE_FILE, OWNER, REPO, GITHUB_SAVE_FILE, SERVER_VERSION_TAG, VERSION } from "./version";
import { GlobalState } from "../../globalState";

export class RPGUnit implements IBMiComponent {
    static readonly ID: string = "RPGUnit";
    static readonly VERSION_REGEX = 'v\\d+(\\.\\d+){2}(\\.b\\d{1,3}|\\.r)?';
    static context: ExtensionContext;

    private readonly localAssetPath: string;

    constructor(context: ExtensionContext) {
        RPGUnit.context = context;
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
        // Get current component state
        const state = await this.getRemoteState(connection, installDirectory);

        // Prompt user to confirm installation process
        const content = connection.getContent();
        const config = connection.getConfig();
        const tempDir = connection.getTempDirectory();
        const remotePath = path.posix.join(tempDir, LOCAL_SAVE_FILE);
        const productLibrary = connection.upperCaseName(Configuration.getOrFallback<string>(Section.productLibrary));
        const tempLibrary = connection.upperCaseName(config.tempLibrary);
        const extensionVersion = RPGUnit.context.extension.packageJSON.version;
        const proceed = await window.showInformationMessage(
            `RPGUnit Installation`,
            {
                modal: true,
                detail: [
                    `IBM i Testing v${extensionVersion} is compatible with RPGUnit v${VERSION}. The following steps will be performed to install this version of RPGUnit:`,
                    ``,
                    `  1. Locate the bundled save file (${LOCAL_SAVE_FILE}) shipped with the extension.`,
                    `  2. Delete the existing product library ${productLibrary}.LIB (if present).`,
                    `  3. Upload the bundled save file (${LOCAL_SAVE_FILE}) to a temporary IFS directory (${tempDir}).`,
                    `  4. Create a save file object (RPGUNIT.FILE) in the temporary library (${tempLibrary}.LIB).`,
                    `  5. Copy the uploaded save file into the save file object.`,
                    `  6. Restore the save file contents into ${productLibrary}.LIB.`,
                    `  7. Delete all temporary files and objects.`
                ].join(`\n`)
            },
            `Proceed`
        );
        if (proceed !== `Proceed`) {
            return state;
        }

        const errorButtons = [
            {
                label: 'Try Again',
                func: async () => {
                    const componentManager = connection.getComponentManager();
                    await componentManager.installComponent(RPGUnit.ID);
                }
            }
        ];

        testOutputLogger.show();

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
        try {
            await testOutputLogger.log(LogLevel.Info, `Uploading ${LOCAL_SAVE_FILE} to ${remotePath}`);
            await content.uploadFiles([{ local: this.localAssetPath, remote: remotePath }]);
        } catch (error: any) {
            await testOutputLogger.appendWithNotification(LogLevel.Error, `Failed to upload ${LOCAL_SAVE_FILE}`, error, errorButtons);
            return state;
        }

        // Creating save file in temporary library
        const createSavfCommand = content.toCl(`QSYS/CRTSAVF`, {
            'FILE': `${tempLibrary}/RPGUNIT`
        });
        await testOutputLogger.log(LogLevel.Info, `Creating ${GITHUB_SAVE_FILE} in ${tempLibrary}.LIB: ${createSavfCommand}`);
        const createSavfResult = await connection.runCommand({ command: createSavfCommand, environment: `ile`, noLibList: true });
        if (createSavfResult.code !== 0 && !createSavfResult.stderr.includes('CPF5813')) {
            await testOutputLogger.appendWithNotification(LogLevel.Error, `Failed to create ${GITHUB_SAVE_FILE}`, createSavfResult.stderr, errorButtons);
            return state;
        }

        // Transfering save file to temporary library
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

        // Deleting temporary file
        try {
            await testOutputLogger.log(LogLevel.Info, `Deleting ${remotePath}`);
            await connection.runCommand({ command: `rm -rf ${remotePath}` });
        } catch (error: any) {
            await testOutputLogger.appendWithNotification(LogLevel.Error, `Failed to delete ${remotePath}`, error);
        }

        // Deleting temporary save file object
        const deleteSavfCommand = content.toCl(`QSYS/DLTF`, {
            FILE: `${tempLibrary}/RPGUNIT`
        });
        await testOutputLogger.log(LogLevel.Info, `Deleting ${GITHUB_SAVE_FILE} in ${tempLibrary}.LIB: ${deleteSavfCommand}`);
        const deleteSavfResult = await connection.runCommand({ command: deleteSavfCommand, environment: `ile`, noLibList: true });
        if (deleteSavfResult.code !== 0) {
            await testOutputLogger.appendWithNotification(LogLevel.Error, `Failed to delete ${GITHUB_SAVE_FILE}`, deleteSavfResult.stderr, errorButtons);
        }

        // Get new component state
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

    static async checkIsInstalled(): Promise<{ status: boolean, error?: string }> {
        const ibmi = getInstance();
        const connection = ibmi!.getConnection()!;

        // Check current installation state
        const componentManager = connection.getComponentManager();
        const state = await componentManager.getRemoteState(RPGUnit.ID);
        const status = state?.status;

        // RPGUnit is installed
        if (status === 'Installed') {
            return { status: true };
        }

        // RPGUnit needs to be installed or updated
        const extensionVersion = RPGUnit.context.extension.packageJSON.version;
        const productLibrary = connection.upperCaseName(Configuration.getOrFallback<string>(Section.productLibrary));
        const title = status === 'NeedsUpdate' ?
            'RPGUnit Update Required' :
            'RPGUnit Installation Required';
        const installMessage = status === 'NeedsUpdate' ?
            `RPGUnit must be updated to v${VERSION} on the IBM i to use v${extensionVersion} of the IBM i Testing extension.` :
            `RPGUnit must be installed with at least v${VERSION} on the IBM i to use v${extensionVersion} of the IBM i Testing extension.`;
        const installQuestion = status === 'NeedsUpdate' ?
            `Can it be updated in ${productLibrary}.LIB?` :
            `Can it be installed into ${productLibrary}.LIB?`;
        const installButton = status === 'NeedsUpdate' ? 'Update' : 'Install';
        const compatabilityMessage = `It is always recommended to stay current to leverage the latest enhancements. However if you would like to keep the current version of RPGUnit, check the documentation to see what version of the extension is compatible.`;
        const configureProductLibraryMessage = `You can also maintain several different versions of RPGUnit by installing it into a different library. Simply configure the product library in the extension settings and make sure to set your library list accordingly.`;
        const progressBarMessage = status === 'NeedsUpdate' ?
            `Updating ${RPGUnit.ID}` :
            `Installing ${RPGUnit.ID}`;

        // Prompt user to install or update RPGUnit
        return await window.showErrorMessage(title, { modal: true, detail: `${installMessage} ${installQuestion}\n\n${compatabilityMessage}\n\n${configureProductLibraryMessage}` }, installButton, 'Configure Product Library', 'View Documentation').then(async (value) => {
            if (value === installButton) {
                const state = await window.withProgress({ title: `Components`, location: ProgressLocation.Notification }, async (progress) => {
                    progress.report({ message: progressBarMessage });
                    return (await componentManager.installComponent(RPGUnit.ID)).state;
                });
                if (state.status === `Installed`) {
                    return { status: true };
                }
            } else if (value === 'Configure Product Library') {
                await commands.executeCommand('workbench.action.openSettings', '@ext:IBM.vscode-ibmi-testing');
            } else if (value === 'View Documentation') {
                await env.openExternal(Uri.parse('https://codefori.github.io/docs/developing/testing/overview/#2-rpgunit'));
            }

            return { status: false, error: installMessage };
        });
    }

    static async checkIsApproved(connection: IBMi): Promise<{ approved: boolean, error?: string }> {
        // Check if user already approved the usage of the product library on the current IBM i
        const state = GlobalState.get();
        const host = connection.currentHost;
        const productLibrary = connection.upperCaseName(Configuration.getOrFallback<string>(Section.productLibrary));
        if (state.approvedLibraries[host]?.includes(productLibrary)) {
            return { approved: true };
        }

        // Retrieve object authorities for the product library to inform the user
        let authoritiesDetail: string[] = [
            `Object authorities for ${productLibrary}.LIB:`
        ];
        try {
            const authRows = await connection.runSQL(`
                SELECT AUTHORIZATION_NAME,
                       OBJECT_AUTHORITY
                FROM QSYS2.OBJECT_PRIVILEGES
                WHERE SYSTEM_OBJECT_SCHEMA = 'QSYS'
                    AND SYSTEM_OBJECT_NAME = '${productLibrary}'
                    AND OBJECT_TYPE = '*LIB'`);
            if (authRows.length > 0) {
                for (const row of authRows) {
                    authoritiesDetail.push(`  • ${row.AUTHORIZATION_NAME}: ${row.OBJECT_AUTHORITY}`);
                }
            } else {
                authoritiesDetail.push(`No authority information found using QSYS2.OBJECT_PRIVILEGES.`);
            }
        } catch (error: any) {
            authoritiesDetail.push(`Failed to retrieve authority information using QSYS2.OBJECT_PRIVILEGES.`);
        }
        await testOutputLogger.log(LogLevel.Info, authoritiesDetail.join(`\n`));

        // Request user to approve usage of product library which exists on the current IBM i
        const useExisting = await window.showInformationMessage(
            `RPGUnit Usage Approval`,
            {
                modal: true,
                detail: [
                    `RPGUnit v${VERSION} is installed in ${productLibrary}.LIB on the IBM i. Since it is the first time you are using this library via this extension, do you approve the usage of it to compile and run your unit tests? If you do not wish to use this existing library, you can configure a different product library and install your own version of RPGUnit.`,
                    ``,
                    ...authoritiesDetail,
                ].join(`\n`)
            },
            `Approve`,
            `Configure Product Library`
        );

        if (useExisting === `Approve`) {
            // User approved the library
            const existingApprovedLibraries = state.approvedLibraries[host] ?? [];
            await GlobalState.set({ ...state, approvedLibraries: { ...state.approvedLibraries, [host]: [...existingApprovedLibraries, productLibrary] } });
            await testOutputLogger.log(LogLevel.Info, `${productLibrary}.LIB approved for usage.`);
            return { approved: true };
        } else if (useExisting === `Configure Product Library`) {
            // User wants to use a different library
            await commands.executeCommand('workbench.action.openSettings', '@ext:IBM.vscode-ibmi-testing');
            return { approved: false, error: `${productLibrary}.LIB was not approved for usage. Configure the product library in the extension settings and install RPGUnit into it before any running tests.` };
        } else {
            // User dismissed the dialog
            return { approved: false, error: `${productLibrary}.LIB was not approved for usage.` };
        }
    }
}