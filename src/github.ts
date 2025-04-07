import { Octokit } from "octokit";
import * as fs from "fs";
import { pipeline } from "stream/promises";

export interface Response<T> {
    data: T,
    error?: string
}

export interface Tag {
    name: string;
    commit: {
        sha: string;
        url: string;
    };
    zipball_url: string;
    tarball_url: string;
    node_id: string;
}

export namespace GitHub {
    export const OWNER = 'tools-400';
    export const REPO = 'irpgunit';

    export async function getTags(): Promise<Response<Tag[]>> {
        const tags: Response<Tag[]> = {
            data: []
        };

        try {
            const octokit = new Octokit();
            const response = await octokit.rest.repos.listTags({
                owner: OWNER,
                repo: REPO,
            });

            if (response.status === 200) {
                tags.data = response.data;
            } else {
                tags.error = `Failed to retrieve tags with status code ${response.status}`;
            }
        } catch (error: any) {
            tags.error = error.message ? error.message : error;
        }

        return tags;
    }

    export async function downloadTag(tag: Tag, downloadTo: string): Promise<Response<boolean>> {
        const isDownlodaded: Response<boolean> = {
            data: false
        };

        try {
            const octokit = new Octokit();
            const response = await octokit.rest.repos.downloadZipballArchive({
                owner: OWNER,
                repo: REPO,
                ref: tag.commit.sha,
                request: {
                    parseSuccessResponseBody: false
                }
            });
            await pipeline(
                response.data as any,
                fs.createWriteStream(downloadTo)
            );
            isDownlodaded.data = true;
        } catch (error: any) {
            isDownlodaded.error = error.message ? error.message : error;
        }

        return isDownlodaded;
    }
}