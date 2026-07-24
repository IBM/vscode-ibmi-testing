import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { disposeConnection, createConnection } from '../setup/connection';
import IBMi from 'vscode-ibmi/src/api/IBMi';
import { TestEnv } from '../setup/env';
import { XMLParser } from '../../xmlParser';

describe('Sample suite', () => {
  const envVars = TestEnv.getEnvironmentVariables();
  let connection: IBMi

  beforeAll(async () => {
    connection = await createConnection();
  }, envVars.VITE_CONNECTION_TIMEOUT)

  afterAll(async () => {
    await disposeConnection(connection);
  });

  test('Sample test', () => {
    console.log(connection.currentHost);
    expect(2+3).toBe(5)
  })

  test('XMLParser returns empty array for no testcases', () => {
    const xml = { elements: [{ elements: [] }] };
    const results = XMLParser.parseTestResults(xml, false);
    expect(results).toEqual([]);
  });
});