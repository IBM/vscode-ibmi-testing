export namespace TestEnv {
    enum EnvironmentVariableKeys {
        VITE_IBMI_HOST = 'VITE_IBMI_HOST',
        VITE_IBMI_USER = 'VITE_IBMI_USER',
        VITE_IBMI_PASSWORD = 'VITE_IBMI_PASSWORD',
        VITE_IBMI_SSH_PORT = 'VITE_IBMI_SSH_PORT',
        VITE_IBMI_PRIVATE_KEY_PATH = 'VITE_IBMI_PRIVATE_KEY_PATH',
        VITE_IBMI_PASSPHRASE = 'VITE_IBMI_PASSPHRASE',
        VITE_IBMI_USE_SSH_AGENT = 'VITE_IBMI_USE_SSH_AGENT',
        VITE_IBMI_TEMP_LIB = 'VITE_IBMI_TEMP_LIB',
        VITE_IBMI_IASP = 'VITE_IBMI_IASP',
        VITE_CONNECTION_TIMEOUT = 'VITE_CONNECTION_TIMEOUT'
    }

    type EnvironmentVariables = {
        [EnvironmentVariableKeys.VITE_IBMI_HOST]: string;
        [EnvironmentVariableKeys.VITE_IBMI_USER]: string;
        [EnvironmentVariableKeys.VITE_IBMI_PASSWORD]: string | undefined
        [EnvironmentVariableKeys.VITE_IBMI_SSH_PORT]: number;
        [EnvironmentVariableKeys.VITE_IBMI_PRIVATE_KEY_PATH]: string | undefined;
        [EnvironmentVariableKeys.VITE_IBMI_PASSPHRASE]: string | undefined;
        [EnvironmentVariableKeys.VITE_IBMI_USE_SSH_AGENT]: boolean;
        [EnvironmentVariableKeys.VITE_IBMI_TEMP_LIB]: string;
        [EnvironmentVariableKeys.VITE_IBMI_IASP]: string | undefined;
        [EnvironmentVariableKeys.VITE_CONNECTION_TIMEOUT]: number;
    };

    const DEFAULT_IBMI_SSH_PORT = 22;
    const DEFAULT_IBMI_TEMP_LIB = `ILEDITOR`;
    const DEFAULT_CONNECTION_TIMEOUT = 25000;

    export function getEnvironmentVariables(): EnvironmentVariables {
        const host = process.env.VITE_IBMI_HOST;
        const user = process.env.VITE_IBMI_USER;
        if (!host || !user) {
            const messages = [
                ``,
                `Missing credentials - You must set the following environment variables to specify the IBM i connection:`,
                `\t${EnvironmentVariableKeys.VITE_IBMI_HOST}`,
                `\t${EnvironmentVariableKeys.VITE_IBMI_USER}`,
                `\t${EnvironmentVariableKeys.VITE_IBMI_SSH_PORT}`,
                ``,
                `If you're a developer, make a copy of .env.sample, rename it to .env, and set the values.`,
                ``,
            ];
            console.log(messages.join(`\n`));
            process.exit(1);
        }

        const password = process.env.VITE_IBMI_PASSWORD;
        const privateKeyPath = process.env.VITE_IBMI_PRIVATE_KEY_PATH;
        const useSshAgent = process.env.VITE_IBMI_USE_SSH_AGENT === `true`;
        if (!password && !privateKeyPath && !useSshAgent) {
            const messages = [
                ``,
                `Authentication error - You must set one of the following environment variables to connect to the specified IBM i:`,
                `\t${EnvironmentVariableKeys.VITE_IBMI_PASSWORD} (for password authentication)`,
                `\tOR`,
                `\t${EnvironmentVariableKeys.VITE_IBMI_PRIVATE_KEY_PATH} (for SSH key authentication)`,
                `\tOR`,
                `\t${EnvironmentVariableKeys.VITE_IBMI_USE_SSH_AGENT}=true (for SSH agent authentication)`,
                ``,
            ];
            console.log(messages.join(`\n`));
            process.exit(1);
        }

        const sshPort = process.env.VITE_IBMI_SSH_PORT
            ? parseInt(process.env.VITE_IBMI_SSH_PORT) : DEFAULT_IBMI_SSH_PORT;
        const passphrase = process.env.VITE_IBMI_PASSPHRASE;
        const tempLib = process.env.VITE_IBMI_TEMP_LIB || DEFAULT_IBMI_TEMP_LIB;
        const iasp = process.env.VITE_IBMI_IASP;
        const connectionTimeout = process.env.VITE_CONNECTION_TIMEOUT ?
            parseInt(process.env.VITE_CONNECTION_TIMEOUT) : DEFAULT_CONNECTION_TIMEOUT;

        return {
            VITE_IBMI_HOST: host,
            VITE_IBMI_USER: user,
            VITE_IBMI_PASSWORD: password,
            VITE_IBMI_SSH_PORT: sshPort,
            VITE_IBMI_PRIVATE_KEY_PATH: privateKeyPath,
            VITE_IBMI_PASSPHRASE: passphrase,
            VITE_IBMI_USE_SSH_AGENT: useSshAgent,
            VITE_IBMI_TEMP_LIB: tempLib,
            VITE_IBMI_IASP: iasp,
            VITE_CONNECTION_TIMEOUT: connectionTimeout
        };
    }

    export function logEnvironmentVariables() {
        const envVars = getEnvironmentVariables();

        console.log(`IBM i Connection:`);
        console.log(`  Host: ${envVars.VITE_IBMI_HOST}`);
        console.log(`  User: ${envVars.VITE_IBMI_USER}`);
        console.log(`  SSH Port: ${envVars.VITE_IBMI_SSH_PORT}`);

        console.log(`Authentication:`);
        console.log(`  Password: ${envVars.VITE_IBMI_PASSWORD ? `Configured` : `-`}`);
        console.log(`  Private Key: ${envVars.VITE_IBMI_PRIVATE_KEY_PATH ? `Configured` : `-`}`);
        console.log(`  Passphrase: ${envVars.VITE_IBMI_PASSPHRASE ? `Configured` : `-`}`);
        console.log(`  SSH Agent: ${envVars.VITE_IBMI_USE_SSH_AGENT ? `Enabled` : `-`}`);
        
        console.log(`Connection Settings:`);
        console.log(`  Temporary Library: ${envVars.VITE_IBMI_TEMP_LIB}`);
        console.log(`  IASP: ${envVars.VITE_IBMI_IASP ?? `-`}`);
        
        console.log(`Test Settings:`);
        console.log(`  Connection Timeout: ${envVars.VITE_CONNECTION_TIMEOUT} ms`);
    }
}