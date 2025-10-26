# Handler - Recommendations API

A recommendation system API endpoint built with Express.js.

## Features

- POST `/recommendations/generate` - Generate personalized recommendations
- GET `/recommendations/history` - Get recommendation history
- GET `/recommendations/:id` - Get a specific recommendation by ID
- POST `/upload/pdf` - Upload a PDF file
- GET `/upload/files` - Get list of uploaded files
- GET `/upload/files/:id` - Get specific file metadata
- DELETE `/upload/files/:id` - Delete an uploaded file

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

Generate personalized credit card recommendations based on filters and optional PDF file.

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
- `fileId` (string, optional): ID of previously uploaded PDF file for OCR processing

**Response:**
```json
{
  "jobId": "uuid-here",
  "status": "processing"
}
```

Then poll `/recommendations/status/:jobId` for results:
```json
{
  "status": "completed",
  "data": {
    "id": 1,
    "filters": {
      "cardTypes": ["Mastercard"],
      "rewardTypes": ["Flights"],
      "annualFeeRange": "0-100",
      "additionalRequirements": ""
    },
    "pdfFile": {
      "fileId": "uuid-here",
      "originalName": "document.pdf",
      "size": 123456,
      "path": "/path/to/temp/file.pdf"
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

---

## Upload Endpoints

### POST /upload/pdf

Upload a PDF file to temp directory. The file will be available for use in `/recommendations/generate`.

**Content-Type:** `multipart/form-data`

**Form Data:**
- `pdf` (file) - PDF file to upload (max 10MB)

**Response:**
```json
{
  "success": true,
  "message": "PDF uploaded successfully to temp directory",
  "data": {
    "fileId": "uuid-here",
    "originalName": "document.pdf",
    "size": 123456,
    "uploadedAt": "2025-10-25T00:00:00.000Z"
  }
}
```

**Note:** Save the `fileId` to use it later in `/recommendations/generate`.

### GET /upload/files

Get list of all uploaded files.

**Response:**
```json
{
  "success": true,
  "data": {
    "files": [
      {
        "id": "uuid-here",
        "originalName": "document.pdf",
        "size": 123456,
        "uploadedAt": "2025-10-25T00:00:00.000Z"
      }
    ],
    "count": 1
  }
}
```

### GET /upload/files/:id

Get metadata for a specific uploaded file.

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid-here",
    "originalName": "document.pdf",
    "size": 123456,
    "uploadedAt": "2025-10-25T00:00:00.000Z"
  }
}
```

### DELETE /upload/files/:id

Delete an uploaded file.

**Response:**
```json
{
  "success": true,
  "message": "File deleted successfully"
}
```

## Testing the API

### Upload PDF First (Optional)
```bash
curl -X POST http://localhost:3000/upload/pdf \
  -F "pdf=@/path/to/your/document.pdf"
# Save the returned fileId
```

### Generate Recommendations
```bash
# Without PDF
curl -X POST http://localhost:3000/recommendations/generate \
  -F 'filters={"cardTypes":["Mastercard"],"rewardTypes":["Flights"],"annualFeeRange":"0-100","additionalRequirements":""}'

# With uploaded PDF (use fileId from upload response)
curl -X POST http://localhost:3000/recommendations/generate \
  -F 'filters={"cardTypes":["Mastercard"],"rewardTypes":["Flights"],"annualFeeRange":"0-100","additionalRequirements":""}' \
  -F 'fileId=<your-file-id-here>'
```

### Check Job Status
```bash
curl http://localhost:3000/recommendations/status/<jobId>
```

Or using JavaScript fetch (as from frontend):
```javascript
// Step 1: Upload PDF (optional)
const fileInput = document.querySelector('input[type="file"]');
const pdfFormData = new FormData();
pdfFormData.append('pdf', fileInput.files[0]);

const uploadResponse = await fetch("http://localhost:3000/upload/pdf", {
  method: "POST",
  body: pdfFormData
});
const uploadData = await uploadResponse.json();
const fileId = uploadData.data.fileId; // Save this fileId

// Step 2: Generate recommendations with optional PDF
const formData = new FormData();
formData.append('filters', JSON.stringify({
  cardTypes: ["Mastercard"],
  rewardTypes: ["Flights"],
  annualFeeRange: "0-100",
  additionalRequirements: ""
}));
if (fileId) {
  formData.append('fileId', fileId); // Include fileId if PDF was uploaded
}

const response = await fetch("http://localhost:3000/recommendations/generate", {
  method: "POST",
  body: formData
});
const data = await response.json();
console.log(data); // { jobId: "...", status: "processing" }

// Step 3: Poll for results
const jobId = data.jobId;
const pollStatus = async () => {
  const statusResponse = await fetch(`http://localhost:3000/recommendations/status/${jobId}`);
  const statusData = await statusResponse.json();
  if (statusData.status === 'completed') {
    console.log('Recommendations ready:', statusData.data);
  } else if (statusData.status === 'processing') {
    setTimeout(pollStatus, 2000); // Poll every 2 seconds
  }
};
pollStatus();
```

### Get Recommendation History
```bash
# Get all history
curl http://localhost:3000/recommendations/history

# Get limited history
curl "http://localhost:3000/recommendations/history?limit=10"
```

### Get Specific Recommendation
```bash
curl http://localhost:3000/recommendations/1
```

### Get Uploaded Files
```bash
curl http://localhost:3000/upload/files
```

### Get Specific File
```bash
curl http://localhost:3000/upload/files/{fileId}
```

### Delete File
```bash
curl -X DELETE http://localhost:3000/upload/files/{fileId}
```

## Project Structure

```
handler/
├── index.js                    # Main application entry point
├── routes/
│   ├── recommendations.js      # Recommendations routes
│   └── upload.js               # File upload routes
├── temp/                       # Temporary PDF files directory (gitignored)
├── package.json
├── .env                        # Environment variables
└── README.md
```

## Environment Variables

Configure in `.env` file:

- `PORT` - Server port (default: 3000)
- `NODE_ENV` - Environment mode (development/production)
- `RAG_RETRIEVER_ENDPOINT` - RAG retriever service endpoint for LLM integration (default: http://localhost:5000)

### Example `.env` file:
```
PORT=3000
NODE_ENV=development
RAG_RETRIEVER_ENDPOINT=http://localhost:5000
```
