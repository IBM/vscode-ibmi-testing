import { ISequentialFileReader, Parser } from "./src";
import IBMi from "vscode-ibmi/src/api/IBMi";

class EvfEventFileReader implements ISequentialFileReader {
    lines: string[];
    index = 0;

    constructor(lines: string[]) {
        this.lines = lines;
    }

    readNextLine(): string | undefined {
        const line = this.lines[this.index];
        if (line) {
            this.index++;
        }

        return line;
    }
}

export async function getParser(connection: IBMi, library: string, member: string) {
    const content = connection.getContent();
    const tableData = await content.getTable(`SANJULA`, `EVFEVENT`, `TEMPDET`);
    const lines = tableData.map(row => String(row.EVFEVENT));

    const evfEventFileReader = new EvfEventFileReader(lines);
    const parser = new Parser();
    parser.parse(evfEventFileReader);

    return parser;
}