const { Pool } = require('pg');
const { pg: pgConfig } = require('./config');

const pool = new Pool(pgConfig);

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
}; 