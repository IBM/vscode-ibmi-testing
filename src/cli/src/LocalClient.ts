import { SSHExecCommandOptions, SSHExecCommandResponse, SSHPutFilesOptions, SSHGetPutDirectoryOptions, Config } from 'node-ssh';
import { Client, SFTPWrapper, TransferOptions } from 'ssh2';
import { exec as cpExec } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import util from 'util';

const exec = util.promisify(cpExec);

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
        try {
            const { stdout, stderr } = await exec(givenCommand, { cwd });
            return { stdout, stderr, code: 0, signal: null };
        } catch (err: any) {
            return {
                stdout: err.stdout ?? '',
                stderr: err.stderr ?? err.message,
                code: err.code ?? 1,
                signal: err.signal ?? null,
            };
        }
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