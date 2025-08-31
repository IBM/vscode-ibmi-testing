# 🙏 Contributing to IBM i Testing

We welcome everyone to contribute to the **IBM i Testing** extension! We appreciate any contribution, whether it be to documentation or code. 

For ideas on where to help out, check out the [open issues](https://github.com/IBM/vscode-ibmi-testing/issues) and espically those labeled as [good first issue](https://github.com/IBM/vscode-ibmi-testing/issues?q=is%3Aissue%20state%3Aopen%20label%3A%22good%20first%20issue%22). Once you are happy to share your changes, please create a pull request and it will be reviewed by the maintainers of this project.

## Getting Started

### Extension

1. Install [VS Code](https://code.visualstudio.com/download) and [Node.js](https://nodejs.org/en/download/package-manager).
2. Create a [fork](https://github.com/IBM/vscode-ibmi-testing/fork) of this repository.
3. Clone your fork.
   ```sh
   git clone https://github.com/your-username/vscode-ibmi-testing.git
   cd vscode-ibmi-testing
   ```
4. Install all extension dependencies.
    ```sh
    npm install
    ```
5. Use `Run Extension` from VS Code's `Run and Debug` view.

### CLI

1. Follow steps 1-3 from above.
2. Install all CLI dependencies.
    ```sh
    cd cli
    npm install:api
    npm install
    ```
3. Build the CLI.
    ```sh
    npm run webpack
    ```
4. Use the `Run CLI` from VS Code's `Run and Debug` view or use the CLI from the terminal as described [here](./cli/README.md).

## Contributors

Thanks so much to everyone [who has contributed](https://github.com/IBM/vscode-ibmi-testing/graphs/contributors).

* [@SanjulaGanepola](https://github.com/SanjulaGanepola)
* [@worksofliam](https://github.com/worksofliam)
* [@edmundreinhardt](https://github.com/edmundreinhardt)
* [@tools400](https://github.com/tools400)
* [@NicolasSchindler](https://github.com/NicolasSchindler)
* [@e1mais](https://github.com/e1mais)