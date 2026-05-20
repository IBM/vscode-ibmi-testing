import * as vscode from 'vscode';
import { LspUtils, Keywords, RpgleTypeDetail } from './lspUtils';
import Declaration from "vscode-rpgle/language/models/declaration";
import Cache from "vscode-rpgle/language/models/cache";

// Mock the vscode module
jest.mock('vscode', () => ({
    Uri: {
        parse: jest.fn(),
    },
    commands: {
        executeCommand: jest.fn(),
    },
}));

// Mock the vscode-rpgle modules
jest.mock('vscode-rpgle/language/models/declaration');
jest.mock('vscode-rpgle/language/models/cache');

describe('LspUtils', () => {
    let mockUri: vscode.Uri;

    beforeEach(() => {
        mockUri = {
            toString: () => 'file:///path/to/test.rpgle',
        } as vscode.Uri;

        (vscode.commands.executeCommand as jest.MockedFunction<any>).mockClear();
    });

    describe('getDocs', () => {
        it('should execute the getCache command with the provided URI', async () => {
            const mockCache = {
                variables: [],
                structs: [],
                procedures: [],
                keyword: [],
                parameters: [],
                subroutines: [],
                files: [],
                include: [],
                copy: [],
                constants: [],
                functions: [],
                types: [],
                classes: [],
                interfaces: [],
                methods: [],
                properties: [],
                events: [],
                exceptions: [],
                namespaces: [],
                enums: [],
                enumMembers: [],
                aliases: [],
                libraries: [],
                objects: [],
                services: [],
                programs: [],
                modules: [],
                proceduresPrototype: [],
                subroutinesPrototype: [],
                functionsPrototype: [],
            } as unknown as Cache;

            (vscode.commands.executeCommand as jest.MockedFunction<any>)
                .mockResolvedValue(mockCache);

            const result = await LspUtils.getDocs(mockUri);

            expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
                'vscode-rpgle.server.getCache',
                mockUri
            );
            expect(result).toBe(mockCache);
        });

        it('should propagate errors when command fails', async () => {
            (vscode.commands.executeCommand as jest.MockedFunction<any>)
                .mockRejectedValue(new Error('Command failed'));

            await expect(LspUtils.getDocs(mockUri)).rejects.toThrow('Command failed');
        });
    });

    describe('prettyKeywords', () => {
        it('should format boolean keywords correctly', () => {
            const keywords: Keywords = {
                QUALIFIED: true,
                EXPORT: true,
                CONST: true,
            };

            const result = LspUtils.prettyKeywords(keywords);

            expect(result).toBe('qualified export const');
        });

        it('should format string-valued keywords correctly', () => {
            const keywords: Keywords = {
                VARYING: true,
                DIM: '10',
                LEN: '20',
            };

            const result = LspUtils.prettyKeywords(keywords);

            expect(result).toBe('varying dim(10) len(20)');
        });

        it('should filter out QUALIFIED and EXPORT when filter is true', () => {
            const keywords: Keywords = {
                QUALIFIED: true,
                EXPORT: true,
                CONST: true,
                DIM: '10',
            };

            const result = LspUtils.prettyKeywords(keywords, true);

            expect(result).toBe('const dim(10)');
        });

        it('should handle empty keywords object', () => {
            const keywords: Keywords = {};

            const result = LspUtils.prettyKeywords(keywords);

            expect(result).toBe('');
        });

        it('should handle keywords with false values', () => {
            const keywords: Keywords = {
                QUALIFIED: false,
                EXPORT: true,
                CONST: true,
            };

            const result = LspUtils.prettyKeywords(keywords);

            expect(result).toBe('export const');
        });

        it('should join multiple keywords with spaces', () => {
            const keywords: Keywords = {
                DIM: '10',
                USAGE: 'OUTPUT',
                EXPORT: true,
            };

            const result = LspUtils.prettyKeywords(keywords);

            expect(result).toBe('dim(10) usage(OUTPUT) export');
        });
    });

    describe('resolveType', () => {
        let mockCache: Cache;
        let mockDeclaration: Declaration;

        beforeEach(() => {
            mockCache = {
                variables: [],
                structs: [],
                procedures: [],
                keyword: [],
                parameters: [],
                subroutines: [],
                files: [],
                include: [],
                copy: [],
                constants: [],
                functions: [],
                types: [],
                classes: [],
                interfaces: [],
                methods: [],
                properties: [],
                events: [],
                exceptions: [],
                namespaces: [],
                enums: [],
                enumMembers: [],
                aliases: [],
                libraries: [],
                objects: [],
                services: [],
                programs: [],
                modules: [],
                proceduresPrototype: [],
                subroutinesPrototype: [],
                functionsPrototype: [],
            } as unknown as Cache;

            mockDeclaration = {
                name: '',
                prototype: null,
                tags: [],
                position: { path: '', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } },
                references: [],
                definition: null,
                keyword: {},
            } as unknown as Declaration;
        });

        it('should resolve type with LIKEDS keyword', () => {
            mockDeclaration.keyword = { LIKEDS: 'MYSTRUCT' };

            const structDecl = {
                name: 'MYSTRUCT',
                prototype: null,
                tags: [],
                position: { path: '', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } },
                references: [],
                definition: null,
                keyword: {},
            } as unknown as Declaration;

            mockCache.structs = [structDecl];

            const result = LspUtils.resolveType(mockCache, mockDeclaration);

            expect(result).toEqual({ reference: structDecl });
        });

        it('should resolve type with LIKE keyword referencing variable', () => {
            mockDeclaration.keyword = { LIKE: 'MYVAR' };

            const varDecl = {
                name: 'MYVAR',
                prototype: null,
                tags: [],
                position: { path: '', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } },
                references: [],
                definition: null,
                keyword: {},
            } as unknown as Declaration;

            mockCache.variables = [varDecl];

            const result = LspUtils.resolveType(mockCache, mockDeclaration);

            expect(result).toEqual({ reference: varDecl });
        });

        it('should resolve type with LIKE keyword referencing struct when variable not found', () => {
            mockDeclaration.keyword = { LIKE: 'MYSTRUCT' };

            const structDecl = {
                name: 'MYSTRUCT',
                prototype: null,
                tags: [],
                position: { path: '', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } },
                references: [],
                definition: null,
                keyword: {},
            } as unknown as Declaration;

            mockCache.variables = [];
            mockCache.structs = [structDecl];

            const result = LspUtils.resolveType(mockCache, mockDeclaration);

            expect(result).toEqual({ reference: structDecl });
        });

        it('should resolve type with LIKE keyword referencing procedure and recursively resolve its type', () => {
            mockDeclaration.keyword = { LIKE: 'MYPRECEDURE' };

            const procDecl = {
                name: 'MYPRECEDURE',
                prototype: null,
                tags: [],
                position: { path: '', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } },
                references: [],
                definition: null,
                keyword: { VARCHAR: '50' },
            } as unknown as Declaration;

            mockCache.variables = [];
            mockCache.structs = [];
            mockCache.procedures = [procDecl];

            const result = LspUtils.resolveType(mockCache, mockDeclaration);

            // For procedure with LIKE, it should recursively call resolveType for the procedure
            // The procedure has VARCHAR type, so the result should reflect this
            expect(result.type?.name).toBe('varchar');
            expect(result.type?.value).toBe('50');
        });

        it('should resolve type with explicit type keyword', () => {
            mockDeclaration.keyword = { CHAR: '10' };

            const result = LspUtils.resolveType(mockCache, mockDeclaration);

            expect(result).toEqual({
                type: { name: 'char', value: '10' }
            });
        });

        it('should resolve type with int keyword', () => {
            mockDeclaration.keyword = { INT: '10' };

            const result = LspUtils.resolveType(mockCache, mockDeclaration);

            expect(result).toEqual({
                type: { name: 'int', value: '10' }
            });
        });

        it('should resolve type with packed keyword', () => {
            mockDeclaration.keyword = { PACKED: '9:2' };

            const result = LspUtils.resolveType(mockCache, mockDeclaration);

            expect(result).toEqual({
                type: { name: 'packed', value: '9:2' }
            });
        });

        it('should return empty object when no recognizable type keywords found', () => {
            mockDeclaration.keyword = { CUSTOM: 'value' };

            const result = LspUtils.resolveType(mockCache, mockDeclaration);

            expect(result).toEqual({});
        });

        it('should handle LIKE keyword referencing procedure with no explicit type', () => {
            mockDeclaration.keyword = { LIKE: 'NOPROCTYPE' };

            const procDecl = {
                name: 'NOPROCTYPE',
                prototype: null,
                tags: [],
                position: { path: '', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } },
                references: [],
                definition: null,
                keyword: {}, // No type keywords
            } as unknown as Declaration;

            mockCache.variables = [];
            mockCache.structs = [];
            mockCache.procedures = [procDecl];

            const result = LspUtils.resolveType(mockCache, mockDeclaration);

            // Even though the procedure has no type, the result should still be processed recursively
            // and return an empty object since no type is defined
            expect(result).toEqual({});
        });

        it('should handle case-insensitive type keywords', () => {
            mockDeclaration.keyword = { char: '5' };  // lowercase

            const result = LspUtils.resolveType(mockCache, mockDeclaration);

            expect(result).toEqual({
                type: { name: 'char', value: '5' }
            });
        });
    });
});