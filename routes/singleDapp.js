var express = require('express');
var router = express.Router();
const db = require('../db');
const { authenticateToken } = require('../middleware/auth');

// Helper function to parse TEXT fields containing JSON from PostgreSQL
function parsePostgresArray(field, fieldName = '') {
  if (!field || field === 'null' || field === '') {
    return null;
  }
  
  try {
    // If it's a string containing JSON objects
    if (typeof field === 'string') {
      // Handle social_links - parse JSON objects from text
      if (fieldName === 'social_links') {
        // Wrap in array brackets and parse
        const jsonString = `[${field}]`;
        try {
          return JSON.parse(jsonString);
        } catch (e) {
          console.error('Error parsing social_links:', e);
          return [];
        }
      }
      
      // Handle tags - extract only names
      if (fieldName === 'tags') {
        // Wrap in array brackets and parse
        const jsonString = `[${field}]`;
        try {
          const parsed = JSON.parse(jsonString);
          // Extract only the name field from each tag
          return parsed.map(tag => tag.name);
        } catch (e) {
          console.error('Error parsing tags:', e);
          return [];
        }
      }
      
      // For other string fields, try to parse as JSON array
      if (field.startsWith('[') && field.endsWith(']')) {
        try {
          return JSON.parse(field);
        } catch (e) {
          // If it fails, return as comma-separated array
          return field.slice(1, -1).split(',').map(item => item.trim());
        }
      }
      
      // If it's comma-separated values without JSON
      if (field.includes(',')) {
        return field.split(',').map(item => item.trim());
      }
      
      // Single value
      return field;
    }
    
    // If it's already an array (PostgreSQL array type)
    if (Array.isArray(field)) {
      // For categories and chains, return as is if they're simple arrays
      if (fieldName === 'categories' || fieldName === 'chains') {
        return field;
      }
      
      // For tags array, extract names
      if (fieldName === 'tags') {
        return field.map(item => {
          if (typeof item === 'string') {
            try {
              const parsed = JSON.parse(item);
              return parsed.name || item;
            } catch (e) {
              return item;
            }
          }
          return item.name || item;
        });
      }
      
      return field;
    }
    
    // Return as is if it's already an object
    return field;
  } catch (e) {
    console.error(`Error parsing ${fieldName}:`, e);
    return field;
  }
}

// GET dapp details by ID
router.get('/api/dapps/:dapp_id', authenticateToken, async function (req, res, next) {
  try {
    const { dapp_id } = req.params;
    
    // Validate dapp_id
    if (!dapp_id || isNaN(dapp_id)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid dapp_id parameter' 
      });
    }

    const query = `
      SELECT 
        dm.name,
        dm.description,
        dm.full_description,
        dm.logo,
        dm.website,
        dm.chains,
        dm.categories,
        dm.social_links,
        dm.tags,
        sc.smartcontract,
        am.balance,
        am.transactions,
        am.uaw,
        am.volume,
        tr.link,
        tr.platform,
        tr.review,
        rm.ratings,
        rm.summarized_review
      FROM dapps_main AS dm
      JOIN top_reviews AS tr ON dm.dapp_id = tr.dapp_id
      JOIN smart_contract_info AS sc ON sc.dapp_id = dm.dapp_id
      JOIN aggregated_metrics AS am ON am.dapp_id = dm.dapp_id
      JOIN reviews_make AS rm ON rm.dapp_id = dm.dapp_id
      WHERE dm.dapp_id = $1
    `;

    const result = await db.query(query, [dapp_id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'Dapp not found' 
      });
    }

    // Process the rows to create a single object
    const firstRow = result.rows[0];
    
    // Create the base object from the first row
    const dappData = {
      name: firstRow.name,
      description: firstRow.description,
      full_description: firstRow.full_description,
      logo: firstRow.logo,
      website: firstRow.website,
      chains: parsePostgresArray(firstRow.chains, 'chains'),
      categories: parsePostgresArray(firstRow.categories, 'categories'),
      social_links: parsePostgresArray(firstRow.social_links, 'social_links'),
      tags: parsePostgresArray(firstRow.tags, 'tags'),
      smartcontract: firstRow.smartcontract,
      metrics: {
        balance: firstRow.balance,
        transactions: firstRow.transactions,
        uaw: firstRow.uaw,
        volume: firstRow.volume
      },
      ratings: firstRow.ratings,
      summarized_review: firstRow.summarized_review,
      reviews: {}
    };

    // Process all rows to collect reviews by platform
    result.rows.forEach(row => {
      if (row.platform && row.review) {
        // Create key-value structure for reviews
        dappData.reviews[row.platform] = {
          review: row.review,
          link: row.link
        };
      }
    });

    res.json({ 
      success: true, 
      data: dappData 
    });

  } catch (err) {
    console.error('Error fetching dapp data:', err);
    res.status(500).json({ 
      success: false, 
      error: 'Database query failed',
      message: err.message 
    });
  }
});

module.exports = router;