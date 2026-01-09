import { IBMiTestManager } from "./manager";

export interface IBMiTestingApi {
    getManager: () => IBMiTestManager | undefined;
}