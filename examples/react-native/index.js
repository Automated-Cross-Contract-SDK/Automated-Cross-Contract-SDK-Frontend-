// @stellar/stellar-sdk relies on Node globals (Buffer, crypto.getRandomValues)
// that don't exist in the React Native JS runtime — these polyfills must be
// the very first thing that runs, before any SDK code is imported.
import 'react-native-get-random-values'
import { Buffer } from 'buffer'
global.Buffer = global.Buffer || Buffer

import { AppRegistry } from 'react-native'
import App from './App'
import { name as appName } from './app.json'

AppRegistry.registerComponent(appName, () => App)
