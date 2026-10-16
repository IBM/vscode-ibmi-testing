export namespace RPGUnitInfo {
    export const OWNER = `tools-400`;
    export const REPO = `irpgunit`;
    export const LIBRARY_NAME = `RPGUNIT`;
    export const FRAMEWORK_NAME = `RPGUnit`;
    export const MINIMUM_VERSION = `6.0.0`;
    export const BUNDLED_VERSION = `6.0.7`;
    export const SERVER_VERSION_TAG = `v${BUNDLED_VERSION}.r`;
    export const GITHUB_SAVE_FILE = `${LIBRARY_NAME}.SAVF`;
    export const LOCAL_SAVE_FILE = `${LIBRARY_NAME}-${BUNDLED_VERSION}.SAVF`;

    /**
     * Convert from GitHub version tags (eg. v6.0.7.r) to version (6.0.7)
     */
    export function versionTagToVersion(versionTag: string) {
        // Remove version prefix
        if (versionTag.startsWith('v')) {
            versionTag = versionTag.slice(1)
        }

        // Remove production suffix
        if (versionTag.endsWith('.v') || versionTag.endsWith('.r')) {
            versionTag = versionTag.slice(0, -2);
        }

        // Convert beta suffix
        if (!versionTag.includes('-beta.')) {
            versionTag = versionTag.includes('.b') ? versionTag.replace('.b', '-beta.') : (versionTag.includes('b') ? versionTag.replace('b', '-beta.') : versionTag);
        }

        return versionTag;
    }
}