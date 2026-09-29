/**
 * Test-support entry for the restore flow. Workspace-only (`private: true`),
 * so it never ships in a published tarball.
 */
export { createMockRpcClient, scenarios } from './mockRpcClient.js'
export type { MockRpcClient, MockRpcScript } from './mockRpcClient.js'
export * as fixtures from './fixtures.js'
