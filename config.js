// Load environment variables from .env file
// This must be called before accessing any process.env variables
require('dotenv').config();

/**
 * Application Configuration
 * 
 * This module centralizes all configuration settings for the application.
 * It loads values from environment variables and provides sensible defaults.
 * 
 * Environment Variables Required:
 * - JWT_SECRET: Secret key for signing JWT access tokens
 * - JWT_REFRESH_SECRET: Secret key for signing JWT refresh tokens
 * - PGHOST: PostgreSQL database host
 * - PGPORT: PostgreSQL database port
 * - PGDATABASE: PostgreSQL database name
 * - PGUSER: PostgreSQL database username
 * - PGPASSWORD: PostgreSQL database password
 */
module.exports = {
  /**
   * JWT Configuration
   * 
   * JWT (JSON Web Token) settings for authentication and authorization.
   * These secrets are used by the server to sign and verify tokens.
   * 
   * IMPORTANT: 
   * - These are DIFFERENT from client secrets
   * - JWT secrets sign tokens, client secrets authenticate clients
   * - Keep these secrets secure and rotate them regularly
   */
  jwt: {
    secret: process.env.JWT_SECRET,                    // Secret for signing access tokens
    refreshSecret: process.env.JWT_REFRESH_SECRET,     // Secret for signing refresh tokens
    accessTokenExpiry: '15m',                          // Access token lifetime (15 minutes)
    refreshTokenExpiry: '7d',                          // Refresh token lifetime (7 days)
    issuer: 'geode-api',                               // Token issuer identifier
    audience: 'geode-client'                           // Intended token audience
  },

  /**
   * Database Configuration
   * 
   * PostgreSQL connection settings loaded from environment variables.
   * These credentials are used to connect to the database for:
   * - Client authentication
   * - DApp search functionality
   * - User management
   * - Any other data persistence needs
   */
  database: {
    host: process.env.PGHOST,
    port: process.env.PGPORT,
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD
  }
}; 