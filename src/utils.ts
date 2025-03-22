export namespace Utils {
    /**
     * Reuse logic used in Source Orbit to convert a given file name to a 10 character system name.
     * 
     * Explanation:     https://ibm.github.io/sourceorbit/#/./pages/general/rules?id=long-file-names
     * Original Source: https://github.com/IBM/sourceorbit/blob/main/cli/src/utils.ts#L12
     */
    export function getSystemName(inputName: string) {
        let baseName = inputName.includes(`-`) ? inputName.split(`-`)[0] : inputName;

        // If the name is of valid length, return it
        if (baseName.length <= 10) {
            return baseName.toUpperCase();
        }

        // We also support prefixes to the name, such as UA_
        let prefix = ``;
        let name = baseName;

        if (baseName.includes(`_`)) {
            const parts = baseName.split(`_`);
            prefix = parts[0];
            name = parts[1];
        }

        // We start the system name with the suppliedPrefix
        let systemName = prefix;

        for (let i = 0; i < name.length && systemName.length <= 10; i++) {
            const char = name[i];
            if (char === char.toUpperCase() || i === 0) {
                systemName += char;
            }
        }

        // If we only have one character, then no capitals were used in the name. Let's just use the first 10 characters
        if (systemName.length === 1) {
            systemName = name.substring(0, 10);
        }

        return systemName.toUpperCase();
    }
}