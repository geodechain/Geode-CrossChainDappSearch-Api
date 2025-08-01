const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken } = require('../middleware/auth');

// function to build OR clauses
function buildOrClause(field, values) {
    if (!values || values.length === 0) return '';
    if (!Array.isArray(values)) values = [values];
    return values.map(val => `${field} = '${val}'`).join(' OR ');
}

router.get('/dapp-search', authenticateToken, async function (req, res, next) {
    try {
      let { category, chains, ratings, limit = 20, page = 1 } = req.query; 
        limit = parseInt(limit);
        page = parseInt(page);
        const offset = (page - 1) * limit;

        let whereClauses = [];

        // Handle multiple conditions (OR clause)
        if (category) {
            const categories = Array.isArray(category) ? category : (typeof category === 'string' ? category.split(',') : [category]);
            const clause = buildOrClause('dm.categories', categories);
            if (clause) whereClauses.push(`(${clause})`);
        }
        if (chains) {
            const chains = Array.isArray(chains) ? type : (typeof chains === 'string' ? chains.split(',') : [chains]);
            const clause = buildOrClause('dm.chain', chain);
            if (clause) whereClauses.push(`(${clause})`);
        }
        if (ratings) {
            whereClauses.push(`rm.ratings >= ${parseFloat(ratings)}`);
        }

        let whereSQL = '';
        if (whereClauses.length > 0) {
            whereSQL = 'WHERE ' + whereClauses.join(' AND ');
        }
        // build query
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
                dm.dapp_id ASC
            LIMIT $1 OFFSET $2
        `;

        // get db output from db connection
        const result = await db.query(query, [limit, offset]);
        // return the result
        res.json(result.rows);
    } catch (e) {
        next(e);
    }
});

module.exports = router;