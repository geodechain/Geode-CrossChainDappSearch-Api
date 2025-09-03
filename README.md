# Geode Cross-Chain DApp Search API

A comprehensive REST API for searching and managing cross-chain decentralized applications (DApps) with user authentication, favorites management, and detailed DApp information.

## Table of Contents

- [Features](#features)
- [Environment Variables](#environment-variables)
- [Installation](#installation)
- [API Endpoints](#api-endpoints)
- [Authentication](#authentication)
- [Database Schema](#database-schema)
- [CORS Configuration](#cors-configuration)

## Features

- 🔐 **JWT Authentication** - Secure token-based authentication with access and refresh tokens
- 🔍 **DApp Search** - Advanced search with filtering by categories, chains, ratings, and name
- 📱 **DApp Details** - Comprehensive DApp information including metrics, reviews, and social links
- ⭐ **Favorites Management** - User favorites system with blockchain address-based identification
- 🛡️ **CORS Protection** - Configurable cross-origin resource sharing
- 🗄️ **PostgreSQL Database** - Robust data storage with complex queries and relationships

## Environment Variables

Create a `.env` file in the root directory with the following variables:

### JWT Configuration
```env
# JWT Secret for signing access tokens (REQUIRED)
JWT_SECRET=your_jwt_secret_key_here

# JWT Secret for signing refresh tokens (REQUIRED)
JWT_REFRESH_SECRET=your_jwt_refresh_secret_key_here
```

### PostgreSQL Database Configuration
```env
# Database host (REQUIRED)
PGHOST=localhost

# Database port (REQUIRED)
PGPORT=5432

# Database name (REQUIRED)
PGDATABASE=your_database_name

# Database username (REQUIRED)
PGUSER=your_username

# Database password (REQUIRED)
PGPASSWORD=your_password
```

### Environment Variable Details

| Variable | Type | Required | Description |
|----------|------|----------|-------------|
| `JWT_SECRET` | String | Yes | Secret key for signing JWT access tokens (15 min expiry) |
| `JWT_REFRESH_SECRET` | String | Yes | Secret key for signing JWT refresh tokens (7 days expiry) |
| `PGHOST` | String | Yes | PostgreSQL database host address |
| `PGPORT` | Number | Yes | PostgreSQL database port number |
| `PGDATABASE` | String | Yes | PostgreSQL database name |
| `PGUSER` | String | Yes | PostgreSQL database username |
| `PGPASSWORD` | String | Yes | PostgreSQL database password |

## Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd Geode-CrossChainDappSearch-Api
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. **Start the server**
   ```bash
   npm start
   ```

The server will start on `http://localhost:3000` by default.

## API Endpoints

### Authentication Endpoints

#### POST `/auth/generate-token`
Generate JWT access and refresh tokens for client authentication.

**Request Body:**
```json
{
  "clientId": "your_client_id",
  "clientSecret": "your_client_secret"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "accessToken": "jwt_access_token",
    "refreshToken": "jwt_refresh_token",
    "tokenType": "Bearer",
    "expiresIn": 900,
    "refreshTokenExpiresIn": 604800
  },
  "message": "Tokens generated successfully"
}
```

#### POST `/auth/refresh-token`
Generate new access and refresh tokens using a valid refresh token.

**Headers:**
```
Authorization: Bearer <refresh_token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "accessToken": "new_jwt_access_token",
    "refreshToken": "new_jwt_refresh_token",
    "tokenType": "Bearer",
    "expiresIn": 900,
    "refreshTokenExpiresIn": 604800
  },
  "message": "Tokens refreshed successfully"
}
```

#### POST `/auth/validate-token`
Validate a JWT access token and return token information.

**Headers:**
```
Authorization: Bearer <access_token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "valid": true,
    "clientId": "client_id_from_token",
    "type": "access"
  },
  "message": "Token is valid"
}
```

### DApp Search Endpoints

#### GET `/dapp-search`
Search and filter DApps with advanced filtering options.

**Headers:**
```
Authorization: Bearer <access_token>
```

**Query Parameters:**
- `category` (string|array): DApp categories to filter by
- `chain` (string|array): Blockchain chains to filter by
- `ratings` (number): Minimum rating threshold (default: 1)
- `name` (string): Partial name search (case-insensitive)
- `limit` (number): Number of results per page (default: 20)
- `page` (number): Page number for pagination (default: 1)

**Example Request:**
```
GET /dapp-search?category=DeFi&chain=Ethereum&ratings=4&name=uniswap&limit=10&page=1
```

**Response:**
```json
[
  {
    "dapp_id": 1,
    "name": "Uniswap",
    "chains": "Ethereum",
    "categories": "DeFi",
    "logo": "https://example.com/logo.png",
    "link": "https://uniswap.org",
    "ratings": 4.5
  }
]
```

### DApp Details Endpoints

#### GET `/api/dapps/:dapp_id`
Get comprehensive details for a specific DApp.

**Headers:**
```
Authorization: Bearer <access_token>
```

**URL Parameters:**
- `dapp_id` (number): The DApp ID

**Response:**
```json
{
  "success": true,
  "data": {
    "name": "DApp Name",
    "description": "Short description",
    "full_description": "Detailed description",
    "logo": "https://example.com/logo.png",
    "website": "https://dapp.com",
    "chains": ["Ethereum", "Polygon"],
    "categories": ["DeFi", "Gaming"],
    "social_links": [
      {
        "platform": "twitter",
        "url": "https://twitter.com/dapp"
      }
    ],
    "tags": ["defi", "yield-farming"],
    "smartcontract": "0x...",
    "metrics": {
      "balance": 1000000,
      "transactions": 50000,
      "uaw": 10000,
      "volume": 5000000
    },
    "ratings": 4.5,
    "summarized_review": "Overall positive review...",
    "reviews": {
      "platform1": {
        "review": "Review text",
        "link": "https://review-link.com"
      }
    }
  }
}
```

### Favorites Management Endpoints

#### POST `/api/favorites`
Add a DApp to user's favorites.

**Request Body:**
```json
{
  "accountId": "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
  "dappId": 123
}
```

**Response:**
```json
{
  "success": true,
  "message": "Favorite added successfully",
  "data": {
    "accountId": "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
    "favorites": [123]
  }
}
```

#### GET `/api/favorites/:accountId`
Get all favorites for a user account.

**URL Parameters:**
- `accountId` (string): Blockchain address

**Query Parameters:**
- `includeDetails` (string): Set to 'true' to include full DApp details

**Response:**
```json
{
  "success": true,
  "data": {
    "accountId": "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
    "favorites": [123, 456],
    "dappDetails": [
      {
        "dapp_id": 123,
        "name": "DApp Name",
        "description": "Description",
        "logo": "https://example.com/logo.png",
        "website": "https://dapp.com",
        "categories": ["DeFi"],
        "chains": ["Ethereum"],
        "link": "https://dapp.com",
        "ratings": 4.5
      }
    ]
  }
}
```

#### DELETE `/api/favorites`
Remove a DApp from user's favorites.

**Request Body:**
```json
{
  "accountId": "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
  "dappId": 123
}
```

**Query Parameters:**
- `removeEmpty` (string): Set to 'true' to delete user entry if no favorites remain

**Response:**
```json
{
  "success": true,
  "message": "Favorite removed successfully",
  "data": {
    "accountId": "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
    "favorites": [456]
  }
}
```

#### GET `/api/favorites/:accountId/:dappId`
Check if a specific DApp is in user's favorites.

**URL Parameters:**
- `accountId` (string): Blockchain address
- `dappId` (number): DApp ID

**Response:**
```json
{
  "success": true,
  "data": {
    "accountId": "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
    "dappId": 123,
    "isFavorited": true
  }
}
```


## Authentication

The API uses JWT (JSON Web Token) authentication with the following features:

- **Access Tokens**: 15-minute expiry for API requests
- **Refresh Tokens**: 7-day expiry for token renewal
- **Client Authentication**: Validates against `api_clients` table
- **Token Validation**: Middleware checks token validity on protected routes

### Token Usage

Include the access token in the Authorization header for protected endpoints:
```
Authorization: Bearer <your_access_token>
```

### Token Refresh Flow

1. Use access token for API requests
2. When access token expires, use refresh token to get new tokens
3. Continue with new access token

## Database Schema

The API uses PostgreSQL with the following main tables:

- `api_clients`: Client authentication credentials
- `dapps_main`: Main DApp information
- `reviews_make`: DApp ratings and reviews
- `top_reviews`: Platform-specific reviews
- `smart_contract_info`: Smart contract details
- `aggregated_metrics`: DApp performance metrics
- `userPrefs`: User favorites and preferences

## CORS Configuration

The API is configured with CORS protection allowing:

- **Production**: `https://geodeapps.com` and all subpaths
- **Development**: `http://localhost` and `https://localhost` with any port
- **Mobile Apps**: Requests with no origin (Postman, curl, mobile apps)

## Error Handling

All endpoints return consistent error responses:

```json
{
  "success": false,
  "error": "Error type",
  "message": "Human-readable error message"
}
```

Common HTTP status codes:
- `200`: Success
- `201`: Created
- `400`: Bad Request (invalid parameters)
- `401`: Unauthorized (invalid/missing token)
- `404`: Not Found
- `500`: Internal Server Error

## Dependencies

- **express**: Web framework
- **jsonwebtoken**: JWT token handling
- **bcryptjs**: Password hashing
- **pg**: PostgreSQL client
- **cors**: Cross-origin resource sharing
- **dotenv**: Environment variable management
- **morgan**: HTTP request logging
- **cookie-parser**: Cookie parsing
- **jade**: Template engine
- **axios**: HTTP client
- **http-errors**: HTTP error handling
- **debug**: Debug logging

## License

This project is licensed under the terms specified in the LICENSE file.