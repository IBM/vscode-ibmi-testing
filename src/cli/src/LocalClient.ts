import { SSHExecCommandOptions, SSHExecCommandResponse, SSHPutFilesOptions, SSHGetPutDirectoryOptions, Config } from 'node-ssh';
import { Client, SFTPWrapper, TransferOptions } from 'ssh2';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';

export class LocalSSH {
    connection: Client | null;

    constructor() {
        this.connection = new LocalClient();
    }

    async connect(givenConfig: Config): Promise<this> {
        return this;
    }

    isConnected(): boolean {
        return true;
    }

    async execCommand(givenCommand: string, options?: SSHExecCommandOptions): Promise<SSHExecCommandResponse> {
        const cwd = options?.cwd ?? process.cwd();

        return new Promise((resolve, reject) => {
            const child = spawn(givenCommand, {
                cwd,
                shell: true,
                stdio: ['pipe', 'pipe', 'pipe'],
            });

            let stdout = '';
            let stderr = '';

            if (options?.stdin) {
                child.stdin.write(options.stdin);
                child.stdin.end();
            }

            child.stdout.on('data', (chunk) => {
                const str = chunk.toString();
                stdout += str;
                options?.onStdout?.(chunk);
            });

            child.stderr.on('data', (chunk) => {
                const str = chunk.toString();
                stderr += str;
                options?.onStderr?.(chunk);
            });

            child.on('close', (code, signal) => {
                resolve({ stdout, stderr, code, signal });
            });

            child.on('error', (err) => {
                reject(err);
            });
        });
    }

    async getFile(localFile: string, remoteFile: string, givenSftp?: SFTPWrapper | null, transferOptions?: TransferOptions | null): Promise<void> {
        await fs.copyFile(remoteFile, localFile);
    }

    async putFile(localFile: string, remoteFile: string, givenSftp?: SFTPWrapper | null, transferOptions?: TransferOptions | null): Promise<void> {
        await fs.copyFile(localFile, remoteFile);
    }

    async putFiles(files: { local: string; remote: string; }[], options?: SSHPutFilesOptions): Promise<void> {
        await Promise.all(files.map(f => this.putFile(f.local, f.remote)));
    }

    async putDirectory(localDirectory: string, remoteDirectory: string, options?: SSHGetPutDirectoryOptions): Promise<boolean> {
        const entries = await fs.readdir(localDirectory, { withFileTypes: true });
        await fs.mkdir(remoteDirectory, { recursive: true });

        for (const entry of entries) {
            const localPath = path.join(localDirectory, entry.name);
            const remotePath = path.join(remoteDirectory, entry.name);

            if (entry.isDirectory()) {
                if (options?.recursive) {
                    await this.putDirectory(localPath, remotePath, options);
                }
            } else {
                if (!options?.validate || options.validate(localPath)) {
                    try {
                        await this.putFile(localPath, remotePath);
                        options?.tick?.(localPath, remotePath, null);
                    } catch (err) {
                        options?.tick?.(localPath, remotePath, err as Error);
                    }
                }
            }
        }

        return true;
    }

    getDirectory(localDirectory: string, remoteDirectory: string, options?: SSHGetPutDirectoryOptions): Promise<boolean> {
        return this.putDirectory(remoteDirectory, localDirectory, options);
    }
}

class LocalClient extends Client { }