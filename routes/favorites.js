var express = require('express');
var router = express.Router();
const db = require('../db');

/**
 * Validates if the provided string is a valid Polkadot/Substrate account address.
 * These addresses use Base58 encoding and are typically 47-48 characters long.
 * 
 * @param {string} accountId - The account address to validate
 * @returns {boolean} True if valid, false otherwise
 * 
 * @example
 * // Valid Polkadot address
 * isValidAccountId('5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY') // true
 * 
 * // Invalid formats
 * isValidAccountId('0x1234...') // false (Ethereum format)
 * isValidAccountId('short') // false (too short)
 */
function isValidAccountId(accountId) {
  // Polkadot addresses are typically 47-48 characters long
  if (!accountId || typeof accountId !== 'string') {
    return false;
  }
  
  // Basic length check
  if (accountId.length < 47 || accountId.length > 48) {
    return false;
  }
  
  // Check for valid Base58 characters
  const base58Regex = /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/;
  return base58Regex.test(accountId);
}

/**
 * Checks if a value can be converted to a valid DApp ID.
 * DApp IDs must be positive integers.
 * 
 * @param {*} dappId - The value to validate
 * @returns {boolean} True if it's a valid positive integer
 * 
 * @example
 * isValidDappId(123) // true
 * isValidDappId('456') // true
 * isValidDappId(0) // false
 * isValidDappId(-1) // false
 * isValidDappId('abc') // false
 */
function isValidDappId(dappId) {
  return dappId && Number.isInteger(Number(dappId)) && Number(dappId) > 0;
}

/**
 * POST /api/favorites
 * 
 * Adds a DApp to a user's favorites list. This endpoint handles both new users
 * (creates their first favorite entry) and existing users (appends to their list).
 * The operation is idempotent - adding the same favorite twice won't create duplicates.
 * 
 * @route POST /api/favorites
 * @param {Object} req.body - Request payload
 * @param {string} req.body.accountId - Valid Polkadot/Substrate address (47-48 chars)
 * @param {number} req.body.dappId - Positive integer identifying the DApp
 * 
 * @returns {Object} JSON response with operation result
 * 
 * Success Response Examples:
 * 
 * New User (201):
 * {
 *   "success": true,
 *   "message": "Favorite added successfully",
 *   "data": {
 *     "accountId": "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
 *     "favorites": [123]
 *   }
 * }
 * 
 * Existing User (200):
 * {
 *   "success": true,
 *   "message": "Favorite added successfully",
 *   "data": {
 *     "accountId": "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
 *     "favorites": [123, 456, 789]
 *   }
 * }
 * 
 * Already Favorited (200):
 * {
 *   "success": true,
 *   "message": "DApp already in favorites",
 *   "data": {
 *     "accountId": "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
 *     "favorites": [123, 456]
 *   }
 * }
 * 
 * Error Responses:
 * - 400: Invalid accountId or dappId format
 * - 404: DApp doesn't exist in dapps_main table
 * - 500: Database connection or query error
 * 
 * Database Operations:
 * 1. Validates DApp exists in dapps_main table
 * 2. Checks if user has existing preferences
 * 3. Creates new userPrefs entry OR updates existing using array_append
 * 
 * @middleware None - Public endpoint for authenticated blockchain users
 */
router.post('/api/favorites', async function(req, res, next) {
  try {
    const { accountId, dappId } = req.body;
    
    // Validation
    if (!isValidAccountId(accountId)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid or missing accountId. Must be a valid blockchain address.' 
      });
    }
    
    if (!isValidDappId(dappId)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid or missing dappId. Must be a positive integer.' 
      });
    }
    
    const dappIdNum = Number(dappId);
    
    // First, check if the dapp exists in dapps_main table
    const dappCheckQuery = 'SELECT dapp_id FROM dapps_main WHERE dapp_id = $1';
    const dappCheckResult = await db.query(dappCheckQuery, [dappIdNum]);
    
    if (dappCheckResult.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'DApp not found' 
      });
    }
    
    // Check if account exists in userPrefs table
    const checkAccountQuery = 'SELECT fav_Dapp_id FROM userPrefs WHERE account_id = $1';
    const accountResult = await db.query(checkAccountQuery, [accountId]);
    
    if (accountResult.rows.length === 0) {
      // Create new entry with the dapp_id in array
      const insertQuery = 'INSERT INTO userPrefs (account_id, fav_Dapp_id) VALUES ($1, $2)';
      await db.query(insertQuery, [accountId, [dappIdNum]]);
      
      return res.status(201).json({ 
        success: true, 
        message: 'Favorite added successfully',
        data: {
          accountId,
          favorites: [dappIdNum]
        }
      });
    } else {
      // Account exists, check if dapp is already favorited
      const currentFavorites = accountResult.rows[0].fav_dapp_id || [];
      
      if (currentFavorites.includes(dappIdNum)) {
        return res.status(200).json({ 
          success: true, 
          message: 'DApp already in favorites',
          data: {
            accountId,
            favorites: currentFavorites
          }
        });
      }
      
      // Add dapp to favorites array using PostgreSQL array_append
      const updateQuery = `
        UPDATE userPrefs 
        SET fav_Dapp_id = array_append(fav_Dapp_id, $2) 
        WHERE account_id = $1
        RETURNING fav_Dapp_id
      `;
      const updateResult = await db.query(updateQuery, [accountId, dappIdNum]);
      
      return res.status(200).json({ 
        success: true, 
        message: 'Favorite added successfully',
        data: {
          accountId,
          favorites: updateResult.rows[0].fav_dapp_id
        }
      });
    }
    
  } catch (err) {
    console.error('Error adding favorite:', err);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to add favorite',
      message: err.message 
    });
  }
});

/**
 * GET /api/favorites/:accountId
 * 
 * Retrieves all favorite DApp IDs for a given account. Can optionally include
 * full DApp details to reduce additional API calls from the frontend.
 * Returns empty array for new users rather than 404 for better UX.
 * 
 * @route GET /api/favorites/:accountId
 * @param {string} req.params.accountId - The blockchain address to look up
 * @param {string} [req.query.includeDetails] - Set to 'true' to fetch full DApp info
 * 
 * @returns {Object} JSON response with user's favorites
 * 
 * Success Response (favorites only):
 * {
 *   "success": true,
 *   "data": {
 *     "accountId": "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
 *     "favorites": [123, 456, 789]
 *   }
 * }
 * 
 * Success Response (with details):
 * {
 *   "success": true,
 *   "data": {
 *     "accountId": "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
 *     "favorites": [123, 456],
 *     "dappDetails": [
 *       {
 *         "dapp_id": 123,
 *         "name": "Uniswap",
 *         "description": "Decentralized exchange",
 *         "logo": "https://...",
 *         "website": "https://uniswap.org",
 *         "categories": ["defi", "exchange"],
 *         "chains": ["ethereum"],
 *         "link": "https://app.uniswap.org",
 *         "ratings": 4.5
 *       }
 *     ]
 *   }
 * }
 * 
 * Empty Response (new user):
 * {
 *   "success": true,
 *   "data": {
 *     "accountId": "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
 *     "favorites": []
 *   }
 * }
 * 
 * Error Responses:
 * - 400: Invalid accountId format
 * - 500: Database query error
 * 
 * Query Parameters:
 * - includeDetails: When set to 'true', joins with dapps_main and reviews_make
 *   tables to provide comprehensive DApp information including ratings
 * 
 * Performance Notes:
 * - Without details: Single query, very fast
 * - With details: Uses PostgreSQL ANY() for efficient batch lookup
 * - Results sorted by DApp name when including details
 */
router.get('/api/favorites/:accountId', async function(req, res, next) {
  try {
    const { accountId } = req.params;
    
    // Validation
    if (!isValidAccountId(accountId)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid accountId. Must be a valid blockchain address.' 
      });
    }
    
    const query = 'SELECT fav_Dapp_id FROM userPrefs WHERE account_id = $1';
    const result = await db.query(query, [accountId]);
    
    if (result.rows.length === 0) {
      // No favorites found for this account
      return res.status(200).json({ 
        success: true,
        data: {
          accountId,
          favorites: []
        }
      });
    }
    
    const favorites = result.rows[0].fav_dapp_id || [];
    
    // Optionally, fetch dapp details for all favorites
    if (req.query.includeDetails === 'true' && favorites.length > 0) {
      const dappDetailsQuery = `
        SELECT 
          dm.dapp_id,
          dm.name,
          dm.description,
          dm.logo,
          dm.website,
          dm.categories,
          dm.chains,
          dm.link,
          COALESCE(rm.ratings, 0) as ratings
        FROM dapps_main dm
        LEFT JOIN reviews_make rm ON dm.dapp_id = rm.dapp_id
        WHERE dm.dapp_id = ANY($1)
        ORDER BY dm.name ASC
      `;
      const dappDetails = await db.query(dappDetailsQuery, [favorites]);
      
      return res.status(200).json({ 
        success: true,
        data: {
          accountId,
          favorites: favorites,
          dappDetails: dappDetails.rows
        }
      });
    }
    
    return res.status(200).json({ 
      success: true,
      data: {
        accountId,
        favorites: favorites
      }
    });
    
  } catch (err) {
    console.error('Error fetching favorites:', err);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch favorites',
      message: err.message 
    });
  }
});

/**
 * DELETE /api/favorites
 * 
 * Removes a DApp from user's favorites list. This is an idempotent operation -
 * attempting to remove a DApp that wasn't favorited won't cause an error.
 * Optionally cleans up empty user entries to keep the database tidy.
 * 
 * @route DELETE /api/favorites
 * @param {Object} req.body - Request payload
 * @param {string} req.body.accountId - Valid blockchain address
 * @param {number} req.body.dappId - DApp ID to remove from favorites
 * @param {string} [req.query.removeEmpty] - Set to 'true' to delete user entry if no favorites remain
 * 
 * @returns {Object} JSON response with updated favorites list
 * 
 * Success Response (removed):
 * {
 *   "success": true,
 *   "message": "Favorite removed successfully",
 *   "data": {
 *     "accountId": "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
 *     "favorites": [456, 789]
 *   }
 * }
 * 
 * Success Response (wasn't favorited):
 * {
 *   "success": true,
 *   "message": "DApp not in favorites",
 *   "data": {
 *     "accountId": "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
 *     "favorites": [456, 789]
 *   }
 * }
 * 
 * Error Responses:
 * - 400: Invalid accountId or dappId format
 * - 404: Account not found in userPrefs table
 * - 500: Database operation failed
 * 
 * Database Operations:
 * 1. Validates account exists in userPrefs
 * 2. Uses PostgreSQL array_remove() for efficient deletion
 * 3. Optionally removes empty user entries when removeEmpty=true
 * 
 * Query Parameters:
 * - removeEmpty: Useful for keeping the database clean by removing
 *   users who have no favorites left. Default behavior preserves
 *   the user entry for future favorites.
 */
router.delete('/api/favorites', async function(req, res, next) {
  try {
    const { accountId, dappId } = req.body;
    
    // Validation
    if (!isValidAccountId(accountId)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid or missing accountId. Must be a valid blockchain address.' 
      });
    }
    
    if (!isValidDappId(dappId)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid or missing dappId. Must be a positive integer.' 
      });
    }
    
    const dappIdNum = Number(dappId);
    
    // Check if account exists
    const checkAccountQuery = 'SELECT fav_Dapp_id FROM userPrefs WHERE account_id = $1';
    const accountResult = await db.query(checkAccountQuery, [accountId]);
    
    if (accountResult.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'Account not found in favorites' 
      });
    }
    
    const currentFavorites = accountResult.rows[0].fav_dapp_id || [];
    
    if (!currentFavorites.includes(dappIdNum)) {
      return res.status(200).json({ 
        success: true, 
        message: 'DApp not in favorites',
        data: {
          accountId,
          favorites: currentFavorites
        }
      });
    }
    
    // Remove dapp from favorites array using PostgreSQL array_remove
    const updateQuery = `
      UPDATE userPrefs 
      SET fav_Dapp_id = array_remove(fav_Dapp_id, $2) 
      WHERE account_id = $1
      RETURNING fav_Dapp_id
    `;
    const updateResult = await db.query(updateQuery, [accountId, dappIdNum]);
    
    // Optionally, remove the account entry if no favorites left
    const updatedFavorites = updateResult.rows[0].fav_dapp_id;
    if (updatedFavorites.length === 0 && req.query.removeEmpty === 'true') {
      await db.query('DELETE FROM userPrefs WHERE account_id = $1', [accountId]);
    }
    
    return res.status(200).json({ 
      success: true, 
      message: 'Favorite removed successfully',
      data: {
        accountId,
        favorites: updatedFavorites
      }
    });
    
  } catch (err) {
    console.error('Error removing favorite:', err);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to remove favorite',
      message: err.message 
    });
  }
});

/**
 * GET /api/favorites/:accountId/:dappId
 * 
 * Quick check to determine if a specific DApp is in user's favorites.
 * This lightweight endpoint is perfect for updating UI states (like heart icons)
 * without fetching the entire favorites list. Designed to be frontend-friendly
 * by returning false for non-existent accounts instead of errors.
 * 
 * @route GET /api/favorites/:accountId/:dappId
 * @param {string} req.params.accountId - The blockchain address to check
 * @param {string} req.params.dappId - The DApp ID to look for
 * 
 * @returns {Object} JSON response with favorite status
 * 
 * Success Response (favorited):
 * {
 *   "success": true,
 *   "data": {
 *     "accountId": "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
 *     "dappId": 123,
 *     "isFavorited": true
 *   }
 * }
 * 
 * Success Response (not favorited or new user):
 * {
 *   "success": true,
 *   "data": {
 *     "accountId": "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
 *     "dappId": 123,
 *     "isFavorited": false
 *   }
 * }
 * 
 * Error Responses:
 * - 400: Invalid accountId or dappId format
 * - 500: Database query error
 * 
 * Frontend Usage Examples:
 * - Toggle favorite button states
 * - Show/hide favorite indicators
 * - Conditional rendering of favorite-related UI
 * 
 * Performance Notes:
 * - Single lightweight query
 * - Uses array containment check with PostgreSQL
 * - Returns immediately on account not found (no 404)
 * - Perfect for high-frequency UI state updates
 * 
 * Design Philosophy:
 * This endpoint prioritizes frontend developer experience by:
 * 1. Never returning 404 for missing accounts (new users)
 * 2. Consistent response structure regardless of account existence
 * 3. Minimal payload for fast network responses
 * 4. Clear boolean flag for easy conditional logic
 */
router.get('/api/favorites/:accountId/:dappId', async function(req, res, next) {
  try {
    const { accountId, dappId } = req.params;
    
    // Validation
    if (!isValidAccountId(accountId)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid accountId. Must be a valid blockchain address.' 
      });
    }
    
    if (!isValidDappId(dappId)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid dappId' 
      });
    }
    
    const dappIdNum = Number(dappId);
    
    const query = 'SELECT fav_Dapp_id FROM userPrefs WHERE account_id = $1';
    const result = await db.query(query, [accountId]);
    
    if (result.rows.length === 0) {
      return res.status(200).json({ 
        success: true,
        data: {
          accountId,
          dappId: dappIdNum,
          isFavorited: false
        }
      });
    }
    
    const favorites = result.rows[0].fav_dapp_id || [];
    const isFavorited = favorites.includes(dappIdNum);
    
    return res.status(200).json({ 
      success: true,
      data: {
        accountId,
        dappId: dappIdNum,
        isFavorited: isFavorited
      }
    });
    
  } catch (err) {
    console.error('Error checking favorite status:', err);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to check favorite status',
      message: err.message 
    });
  }
});

module.exports = router;