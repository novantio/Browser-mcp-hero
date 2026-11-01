// Electron + MCP reliability regression suite. Cases live in tests/reliability/*.cjs.
// Filter cases with RELIABILITY_FILTER=<regex>.
const { runReliabilitySuites } = require('./reliability/harness.cjs');

runReliabilitySuites([
  require('./reliability/interaction.cjs'),
  require('./reliability/forms-and-state.cjs'),
]).catch(error => { console.error(error); process.exitCode = 1; });
