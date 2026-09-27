'use strict';

// Legacy PC CLI path; the algorithm is maintained under xhs_core/js.
const impl = require('../../xhs_core/js/sign.js');
if (require.main === module && typeof impl.main === 'function') impl.main();
module.exports = impl;
