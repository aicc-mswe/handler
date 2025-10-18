# Handler - Recommendations API

A recommendation system API endpoint built with Express.js.

## Features

- POST `/recommendations/generate` - Generate personalized recommendations
- GET `/recommendations/history` - Get recommendation history
- GET `/recommendations/:id` - Get a specific recommendation by ID

## Installation

```bash
npm install
```

## Usage

### Development Mode
```bash
npm run dev
```

### Production Mode
```bash
npm start
```

Server runs on `http://localhost:3000` by default.

## API Endpoints

### POST /recommendations/generate

Generate personalized credit card recommendations based on filters.

**Note:** Currently returns mock data regardless of filter values.

**Content-Type:** `multipart/form-data`

**Form Data:**
- `filters` (JSON string, optional):
```json
{
  "cardTypes": ["Mastercard"],
  "rewardTypes": ["Flights"],
  "annualFeeRange": "0-100",
  "additionalRequirements": ""
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "filters": {
      "cardTypes": ["Mastercard"],
      "rewardTypes": ["Flights"],
      "annualFeeRange": "0-100",
      "additionalRequirements": ""
    },
    "recommendations": [
      {
        "id": 1,
        "name": "Chase Sapphire Preferred",
        "bankName": "Chase",
        "image": "https://www.uscreditcardguide.com/wp-content/uploads/csp-e1629138224670.png",
        "fee": "$95",
        "cardType": "VISA",
        "rewards": "5x travel, 3x dining, 2x other travel",
        "description": "Perfect for travelers who want flexibility...",
        "pros": ["Flexible point redemption", "Strong travel protections", "No foreign transaction fees"],
        "cons": ["Higher annual fee", "Requires good credit score"],
        "applyLink": "https://creditcards.chase.com/rewards-credit-cards/sapphire/preferred"
      }
    ],
    "count": 3,
    "generatedAt": "2025-10-17T00:00:00.000Z"
  }
}
```

### GET /recommendations/history

Get recommendation history.

**Query Parameters:**
- `limit` (optional) - Maximum number of records (default: 50)

**Example:** `GET /recommendations/history?limit=10`

**Response:**
```json
{
  "success": true,
  "data": {
    "history": [
      {
        "id": 1,
        "filters": {
          "cardTypes": ["Mastercard"],
          "rewardTypes": ["Flights"],
          "annualFeeRange": "0-100",
          "additionalRequirements": ""
        },
        "recommendations": [...],
        "count": 2,
        "generatedAt": "2025-10-17T00:00:00.000Z"
      }
    ],
    "count": 1,
    "total": 1
  }
}
```

### GET /recommendations/:id

Get a specific recommendation by ID.

**Example:** `GET /recommendations/1`

**Response:**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "filters": {
      "cardTypes": ["Mastercard"],
      "rewardTypes": ["Flights"],
      "annualFeeRange": "0-100",
      "additionalRequirements": ""
    },
    "recommendations": [...],
    "count": 2,
    "generatedAt": "2025-10-17T00:00:00.000Z"
  }
}
```

### GET /health

Health check endpoint.

**Response:**
```json
{
  "status": "OK",
  "message": "Server is running"
}
```

## Project Structure

```
handler/
├── index.js                    # Main application entry point
├── routes/
│   └── recommendations.js      # Recommendations routes
├── package.json
├── .env                        # Environment variables
└── README.md
```

## Environment Variables

Configure in `.env` file:

- `PORT` - Server port (default: 3000)
- `NODE_ENV` - Environment mode (development/production)
