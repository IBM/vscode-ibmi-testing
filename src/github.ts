import { Octokit } from "octokit";
import * as fs from 'fs';
import { components } from "@octokit/openapi-types";
import fetch from "node-fetch";
import * as path from "path";

export interface Response<T> {
    data: T,
    error?: string
}
export type Release = components["schemas"]["release"];
export type ReleaseAsset = components["schemas"]["release-asset"];

export namespace GitHub {
    export const OWNER = 'tools-400';
    export const REPO = 'irpgunit';
    export const ASSET_NAME = 'RPGUNIT.SAVF';

    export async function getReleases(): Promise<Response<Release[]>> {
        const releases: Response<Release[]> = {
            data: []
        };

        try {
            const octokit = new Octokit();
            const response = await octokit.rest.repos.listReleases({
                owner: OWNER,
                repo: REPO
            });

            if (response.status === 200) {
                releases.data = response.data;
            } else {
                releases.error = response.status;
            }
        } catch (error: any) {
            releases.error = error.message ? error.message : error;
        }

        return releases;
    }

    export async function downloadReleaseAsset(asset: ReleaseAsset, downloadDirectory: string): Promise<Response<boolean>> {
        const isDownloaded: Response<boolean> = {
            data: false
        };

        try {
            // Fetch asset
            const response = await fetch(asset.browser_download_url);
            const buffer = await response.arrayBuffer();

            // Download asset to specified path
            if (response.status === 200) {
                const filePath = path.join(downloadDirectory, asset.name);
                await fs.promises.writeFile(filePath, Buffer.from(buffer));
                isDownloaded.data = true;
            } else {
                isDownloaded.error = response.statusText;
            }
        } catch (error: any) {
            isDownloaded.error = error.message ? error.message : error;
        }

        return isDownloaded;
    }
}