const { Pool } = require('pg');

const pool = new Pool(pgConfig);

module.exports = {
  /**
   * Execute a database query
   * 
   * @param {string} text - SQL query text (can include parameter placeholders $1, $2, etc.)
   * @param {Array} params - Array of parameter values to substitute in the query
   * @returns {Promise<Object>} - Query result object with rows and rowCount
   * 
   * Example:
   * const result = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
   * const user = result.rows[0];
   */
  query: (text, params) => pool.query(text, params),
  pool,
}; 