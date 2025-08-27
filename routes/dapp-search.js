const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken } = require('../middleware/auth');

/**
 * Build OR clauses for SQL queries
 * 
 * This utility function converts an array of values into a SQL OR clause.
 * It's used to build dynamic WHERE conditions for filtering DApps by
 * categories, chains, or other multi-value fields.
 * 
 * @param {string} field - The database field name to filter on
 * @param {Array|string} values - Array of values or comma-separated string
 * @returns {string} - SQL OR clause string, or empty string if no values
 * 
 * Example:
 * buildOrClause('dm.categories', ['DeFi', 'Gaming']) 
 * Returns: "dm.categories = 'DeFi' OR dm.categories = 'Gaming'"
 */
function buildOrClause(field, values) {
    // Return empty string if no values provided
    if (!values || values.length === 0) return '';

    // Convert to array if it's not already
    if (!Array.isArray(values)) values = [values];

    // Build OR clause by mapping each value to an equality condition
    return values.map(val => `${field} = '${val}'`).join(' OR ');
}

/**
 * GET /dapp-search
 * 
 * Search and filter DApps based on various criteria.
 * This endpoint requires JWT authentication and supports:
 * - Category filtering (multiple categories with OR logic)
 * - Chain filtering (multiple chains with OR logic)
 * - Rating filtering (minimum rating threshold)
 * - Name search (partial match, case-insensitive)
 * - Pagination (limit and offset)
 * 
 * Query Parameters:
 * - category: string|array - DApp categories to filter by
 * - chain: string|array - Blockchain chains to filter by
 * - ratings: number - Minimum rating threshold (default: 1)
 * - name: string - Partial name search
 * - limit: number - Number of results per page (default: 20)
 * - page: number - Page number for pagination (default: 1)
 * 
 * @param {Object} req - Express request object (includes req.user from auth middleware)
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
router.get('/dapp-search', authenticateToken, async function (req, res, next) {
    try {
        // Extract and parse query parameters
        let { category, chain, ratings, name, limit = 20, page = 1 } = req.query; 
        limit = parseInt(limit);
        page = parseInt(page);
        const offset = (page - 1) * limit;

        let whereClauses = [];
        let queryParams = [limit, offset];
        let paramIndex = 3;

        // Handle category filtering
        if (category) {
            const categories = Array.isArray(category) ? category : (typeof category === 'string' ? category.split(',') : [category]);
            const clause = buildOrClause('dm.categories', categories);
            if (clause) whereClauses.push(`(${clause})`);
        }

        // Handle chain filtering
        if (chain) {
            const chainsArr = Array.isArray(chain) ? chain : (typeof chain === 'string' ? chain.split(',') : [chain]);
            const clause = buildOrClause('dm.chains', chainsArr);
            if (clause) whereClauses.push(`(${clause})`);
        }

        // Handle rating filtering
        if (ratings) {
            // Filter DApps with ratings greater than or equal to the specified value
            whereClauses.push(`rm.ratings >= ${parseFloat(ratings)}`);
        } else {
            // Default: only show DApps with ratings >= 1 (exclude unrated)
            whereClauses.push(`rm.ratings >= 1`);
        }
        if (name) {
            whereClauses.push(`dm.name ILIKE $${paramIndex}`);
            queryParams.push(`%${name}%`);
            paramIndex++;
        }

        // Build the complete WHERE clause
        let whereSQL = '';
        console.log(whereClauses, "whereclo")
        if (whereClauses.length > 0) {
            whereSQL = 'WHERE ' + whereClauses.join(' AND ');
        }

        // Build the main SQL query
        // This query joins dapps_main with reviews_make to get rating information
        const query = `
            SELECT 
                dm.dapp_id, 
                dm.name,
                dm.chains, 
                dm.categories,
                dm.logo,
                dm.link,
                rm.ratings
            FROM 
                dapps_main dm
            LEFT JOIN 
                reviews_make rm ON dm.dapp_id = rm.dapp_id
            ${whereSQL}
            ORDER BY 
                rm.ratings DESC
            LIMIT $1 OFFSET $2
        `;

        console.log(query, queryParams, "query")

        // Execute the database query with parameters
        const result = await db.query(query, queryParams);

        // Return the query results as JSON
        res.json(result.rows);

    } catch (e) {
        next(e);
    }
});

module.exports = router;