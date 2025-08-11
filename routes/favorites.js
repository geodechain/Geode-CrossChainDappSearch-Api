var express = require('express');
var router = express.Router();
const db = require('../db');

/**
 * Validates if the provided string is a valid Polkadot/Substrate account address.
 * These addresses use Base58 encoding and are typically 47-48 characters long.
 * 
 * @param {string} accountId - The account address to validate
 * @returns {boolean} True if valid, false otherwise
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
 */
function isValidDappId(dappId) {
  return dappId && Number.isInteger(Number(dappId)) && Number(dappId) > 0;
}

/**
 * POST /api/favorites
 * 
 * Adds a DApp to a user's favorites list. Creates a new user entry
 * if this is their first favorite, otherwise appends to existing list.
 * 
 * Request body:
 * - accountId: string (blockchain address)
 * - dappId: number (positive integer)
 * 
 * Returns:
 * - 201: Created new user entry with favorite
 * - 200: Added to existing favorites or already favorited
 * - 400: Invalid input parameters
 * - 404: DApp doesn't exist
 * - 500: Server error
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
 * Retrieves all favorite DApp IDs for a given account.
 * Can optionally include full DApp details.
 * 
 * URL Parameters:
 * - accountId: The blockchain address
 * 
 * Query Parameters:
 * - includeDetails: 'true' to fetch full DApp information
 * 
 * Returns:
 * - 200: Success (empty array if no favorites)
 * - 400: Invalid account ID format
 * - 500: Database error
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
 * Removes a DApp from user's favorites. Won't fail if the DApp
 * wasn't favorited in the first place (idempotent operation).
 * 
 * Request body:
 * - accountId: string (blockchain address)
 * - dappId: number (positive integer)
 * 
 * Query Parameters:
 * - removeEmpty: 'true' to delete user entry if no favorites remain
 * 
 * Returns:
 * - 200: Successfully removed or wasn't favorited
 * - 400: Invalid parameters
 * - 404: Account not found
 * - 500: Database error
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
 * Quick check to see if a specific DApp is in user's favorites.
 * Useful for updating UI state without fetching entire list.
 * 
 * URL Parameters:
 * - accountId: The blockchain address to check
 * - dappId: The DApp ID to look for
 * 
 * Returns:
 * - 200: Success with isFavorited boolean
 * - 400: Invalid parameters
 * - 500: Database error
 * 
 * Note: Returns false if account doesn't exist rather than 404,
 * making it easier for frontend to handle new users.
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