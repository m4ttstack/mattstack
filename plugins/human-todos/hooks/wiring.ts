// The host follows `$` only into functions of the module's own files, never through an object
// passed in, so the pane and the contract reach the actions through these re-exports.
export { openPane } from './pane'
export { cleanup, press, release } from './actions'
export { syncSpinner } from './spinner'
