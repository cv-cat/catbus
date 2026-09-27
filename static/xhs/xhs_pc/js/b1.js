'use strict';

// Compatibility entry point for callers that historically invoked the PC
// path directly.  The maintained implementation lives in xhs_core/js/b1.js;
// forwarding argv/stdin keeps the CLI contract identical without duplicating
// the algorithm.
const impl = require('../../xhs_core/js/b1.js');
if (require.main === module) impl.main();
module.exports = impl;
