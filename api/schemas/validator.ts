import { Validator, ValidatorResult } from "jsonschema";
import testingSchema from "./testing.json";

export enum SchemaId {
    testing = '/testing'
}

export class SchemaValidator {
    private static validator: Validator;

    public static initialize() {
        this.validator = new Validator();
        const testing = { ...testingSchema, id: SchemaId.testing };
        this.validator.addSchema(testing);
    }

    public static getValidator(): Validator {
        if (!this.validator) {
            this.initialize();
        }
        return this.validator;
    }

    public static validateSchema(id: SchemaId, instance: any): ValidatorResult {
        const validator = this.getValidator();
        const schema = validator.schemas[id];
        return validator.validate(instance, schema);
    }
}
