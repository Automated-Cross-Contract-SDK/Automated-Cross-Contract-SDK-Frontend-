const path = require('path')
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config')

// Workspace packages are symlinked from the repository root.
const root = path.resolve(__dirname, '../..')

module.exports = mergeConfig(getDefaultConfig(__dirname), {
  watchFolders: [root],
  resolver: {
    nodeModulesPaths: [path.join(__dirname, 'node_modules'), path.join(root, 'node_modules')],
    unstable_enablePackageExports: true,
    // The package's Node entry requires built-ins such as `http`; use its
    // self-contained browser bundle instead.
    resolveRequest: (context, moduleName, platform) =>
      moduleName === '@stellar/stellar-sdk'
        ? {
            type: 'sourceFile',
            filePath: path.join(root, 'node_modules/@stellar/stellar-sdk/dist/stellar-sdk.min.js'),
          }
        : context.resolveRequest(context, moduleName, platform),
  },
})
