// Mock for vscode-rpgle/language/parser
class Parser {
  async getDocs(filePath, content, options) {
    return {
      procedures: []
    };
  }
}

module.exports = Parser;