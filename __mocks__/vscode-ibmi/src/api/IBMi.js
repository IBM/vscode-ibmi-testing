module.exports = {
    default: jest.fn().mockImplementation(() => ({
        getConnection: jest.fn(),
        getLibraryList: jest.fn().mockResolvedValue({
            currentLibrary: 'QGPL',
            libraryList: ['QSYS', 'QSYS2', 'SYSTOOLS']
        })
    }))
};