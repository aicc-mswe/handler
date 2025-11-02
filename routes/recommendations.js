const express = require('express');
const multer = require('multer');
const router = express.Router();
const fs = require('fs');
const { createWorker } = require('tesseract.js');
const pdf = require('pdf-parse');
const axios = require('axios');

// Configure multer for handling multipart/form-data
const upload = multer();

// In-memory storage for demonstration (replace with database in production)
const recommendationHistory = [];
let recommendationIdCounter = 1;

// In-memory job store for async recommendation jobs
const jobs = {}; // jobId: { status, data }
const { randomUUID } = require('crypto');

/**
 * Build prompt for LLM to generate credit card recommendations
 */
function buildRecommendationPrompt(filters, ocrText) {
  const prompt = `You are a credit card recommendation expert. Based on the user's preferences and spending patterns, recommend suitable credit cards.

USER PREFERENCES AND FILTERS:
${filters.cardTypes && filters.cardTypes.length > 0 ? `- Required Card Network: ${filters.cardTypes.join(', ')} *** MANDATORY - ONLY recommend cards from this network ***` : '- No card network restriction'}
${filters.rewardTypes && filters.rewardTypes.length > 0 ? `- Desired Reward Types: ${filters.rewardTypes.join(', ')}` : '- No reward type preference'}
${filters.annualFeeRange ? `- Annual Fee Range: $${filters.annualFeeRange}` : '- No annual fee preference'}
${filters.additionalRequirements ? `- Additional Requirements: ${filters.additionalRequirements}` : ''}

${ocrText ? `USER SPENDING PATTERNS (from uploaded statement):
${ocrText}

IMPORTANT: The uploaded document shows the user's SPENDING HABITS and transaction history. Analyze ONLY the spending categories, amounts, and patterns. DO NOT consider which bank issued this statement. You can recommend cards from ANY bank/issuer as long as they match the user's spending patterns and filters.
` : 'No spending data provided.'}

CRITICAL INSTRUCTIONS:
1. **MANDATORY CARD NETWORK FILTER**: If "Required Card Network" is specified (e.g., VISA, Mastercard, American Express, Discover), you MUST ONLY recommend cards from that exact network. This is NON-NEGOTIABLE.
   - Example: If filter = "VISA", recommend ONLY VISA cards (from any bank: Chase, Bank of America, Citi, etc.)
   - Example: If filter = "Mastercard", recommend ONLY Mastercard cards (from any bank)
   - Example: If filter = "American Express", recommend ONLY American Express cards
2. Focus on the user's SPENDING PATTERNS from the uploaded statement, NOT the issuing bank
3. You can recommend cards from ANY bank/issuer, as long as the card network matches the filter
4. Analyze spending categories (dining, travel, groceries, gas, etc.) to match with appropriate reward structures
5. Recommend exactly 3 credit cards that best match the spending patterns and filters (ranked by match score)
6. Provide detailed information including benefits and pros for each card
7. Ensure recommendations align with the user's spending habits and financial profile

IMPORTANT REQUIREMENTS:
- **CARD NETWORK COMPLIANCE**: Strictly follow the "Required Card Network" filter. All recommended cards must be from the specified network (VISA/Mastercard/American Express/Discover)
- **IGNORE STATEMENT ISSUER**: Do not let the bank that issued the uploaded statement influence your recommendations. Focus only on spending patterns.
- **CROSS-BANK RECOMMENDATIONS**: Feel free to recommend cards from different banks (Chase, Citi, Bank of America, Capital One, etc.) as long as they match the card network filter
- Use REAL credit card image URLs from the OFFICIAL BANK WEBSITE for each specific card
- Use REAL credit card application URLs from the OFFICIAL BANK WEBSITE for each specific card
- DO NOT use placeholder URLs like "https://example.com"
- Each card should have its own unique image URL from its issuing bank's website
- Each card should have its own unique application URL from its issuing bank's website
- Different banks will have DIFFERENT domain names (e.g., Chase cards use chase.com, Amex cards use americanexpress.com, Citi cards use citi.com, Capital One cards use capitalone.com, etc.)

OUTPUT FORMAT:
You must respond with a valid JSON object with the following structure:
{
  "summary": "A 2-3 sentence explanation of WHY you are recommending these specific 3 cards based on the user's spending patterns and filters. Explain how they align with the user's needs.",
  "cards": [
    {
      "id": 1,
      "name": "Card Name",
      "bankName": "Bank Name",
      "image": "REAL_IMAGE_URL_FROM_OFFICIAL_BANK_WEBSITE",
      "fee": "$XX",
      "cardType": "VISA/Mastercard/American Express/Discover (MUST match the Required Card Network filter)",
      "rewards": "Brief description of rewards that align with user's spending patterns",
      "description": "Detailed description explaining why this card suits the user's SPENDING HABITS",
      "pros": ["Benefit 1 related to spending", "Benefit 2", "Benefit 3"],
      "applyLink": "REAL_APPLICATION_URL_FROM_OFFICIAL_BANK_WEBSITE"
    }
  ]
}

Example summary:
"Based on your high spending on dining and travel, these three VISA cards offer the best rewards in those categories. The Chase Sapphire Preferred leads with 2x points on travel and dining, while the Bank of America Travel Rewards provides no annual fee access to travel perks. The Citi Premier rounds out with bonus points on restaurants and gas stations."

Examples showing cross-bank recommendations within the same network:
- If filter = "VISA", you can recommend:
  * Chase Sapphire Preferred (VISA)
  * Bank of America Travel Rewards (VISA)
  * Citi Premier Card (VISA)
- If filter = "Mastercard", you can recommend:
  * Citi Double Cash (Mastercard)
  * Capital One Venture (Mastercard)
  * US Bank Altitude Reserve (Mastercard)
- If filter = "American Express", you can recommend:
  * American Express Gold Card
  * American Express Platinum Card
  * American Express Blue Cash Preferred

Example URLs from different banks:
- Chase Sapphire Preferred:
  * image: "https://creditcards.chase.com/K-Marketplace/images/cardart/sapphire_preferred_card.png"
  * applyLink: "https://creditcards.chase.com/rewards-credit-cards/sapphire/preferred"
- American Express Gold Card:
  * image: "https://icm.aexp-static.com/content/dam/amex/us/credit-cards/features-benefits/policies/Gold-Card.png"
  * applyLink: "https://www.americanexpress.com/us/credit-cards/card/gold-card/"
- Citi Double Cash:
  * image: "https://www.citi.com/CRD/images/citi-double-cash-card/card.png"
  * applyLink: "https://www.citi.com/credit-cards/citi-double-cash-credit-card"
- Capital One Venture:
  * image: "https://ecm.capitalone.com/WCM/card/products/venture-card-art.png"
  * applyLink: "https://www.capitalone.com/credit-cards/venture/"

CRITICAL: Each recommended card MUST use URLs from its OWN issuing bank's official website. Do not use the same domain for different banks.

Respond ONLY with the JSON object containing both "summary" and "cards" array, no additional text or explanation.`;

  return prompt;
}

/**
 * Call RAG retriever endpoint to get LLM recommendations
 */
async function queryLLM(prompt) {
  try {
    const ragEndpoint = process.env.RAG_RETRIEVER_ENDPOINT || 'http://localhost:5002';
    const url = `${ragEndpoint}/query`;
    
    const requestPayload = {
      question: prompt,
      index_name: null,
      enable_reranking: true,
      model_name: "gpt-3.5-turbo",
      rerank_top_k: 10
    };
    
    console.log(`\n=== Calling RAG Retriever ===`);
    console.log(`Endpoint: ${url}`);
    console.log('Request payload:');
    console.log(JSON.stringify(requestPayload, null, 2));
    
    const response = await axios.post(url, requestPayload, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 60000 // 60 seconds timeout
    });
    
    console.log('\n=== RAG Retriever Response ===');
    console.log('Response status:', response.status);
    console.log('Response headers:', response.headers);
    console.log('Response data:');
    console.log(JSON.stringify(response.data, null, 2));
    console.log('=== End of RAG Retriever Response ===\n');
    
    return response.data;
    
  } catch (error) {
    console.error('\n=== RAG Retriever Error ===');
    console.error('Error message:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response headers:', error.response.headers);
      console.error('Response data:', JSON.stringify(error.response.data, null, 2));
    }
    if (error.request) {
      console.error('Request was made but no response received');
      console.error('Request details:', error.request);
    }
    console.error('=== End of RAG Retriever Error ===\n');
    throw error;
  }
}

/**
 * Extract text from PDF using OCR (Tesseract.js)
 * This function attempts to extract text from PDF
 */
async function extractTextFromPDF(pdfPath) {
  try {
    // First, try to extract text directly from PDF (if it contains text)
    const dataBuffer = fs.readFileSync(pdfPath);
    let extractedText = '';
    
    try {
      const pdfData = await pdf(dataBuffer);
      extractedText = pdfData.text;
      
      // If we got meaningful text, return it
      if (extractedText.trim().length > 0) {
        console.log('--- Extracted Text (Direct) ---');
        console.log(extractedText);
        console.log('--- End of Extracted Text ---');
        return extractedText;
      }
    } catch (pdfError) {
      // Fall back to OCR if direct extraction fails
    }
    
    // If direct extraction failed or returned empty, use OCR
    const worker = await createWorker('eng');
    
    // For now, we'll OCR the first page
    // Note: Full PDF to image conversion would require additional libraries
    const { data: { text } } = await worker.recognize(pdfPath);
    
    await worker.terminate();
    
    console.log('--- Extracted Text (OCR) ---');
    console.log(text);
    console.log('--- End of Extracted Text ---');
    
    return text;
    
  } catch (error) {
    console.error('Error during PDF text extraction:', error);
    throw error;
  }
}

/**
 * POST /recommendations/generate
 * Generate personalized recommendations
 * 
 * Request body example (multipart/form-data):
 * filters: {
 *   "cardTypes": ["Mastercard"],
 *   "rewardTypes": ["Flights"],
 *   "annualFeeRange": "0-100",
 *   "additionalRequirements": ""
 * }
 */
router.post('/generate', upload.none(), async (req, res) => {
  try {
    // Parse filters from form-data (optional)
    let filters = {};
    if (req.body.filters) {
      try {
        filters = JSON.parse(req.body.filters);
      } catch (parseError) {
        filters = {};
      }
    }

    // Get fileId if provided (optional PDF file for OCR)
    const fileId = req.body.fileId || null;
    let pdfFile = null;

    // Validate fileId if provided
    if (fileId) {
      const uploadRouter = require('./upload');
      const uploadedFiles = uploadRouter.uploadedFiles;
      
      pdfFile = uploadedFiles.find(f => f.id === fileId);
      
      if (!pdfFile) {
        return res.status(404).json({
          status: 'failed',
          error: 'Uploaded PDF file not found. Please upload a PDF first.'
        });
      }

      // Check if file still exists in temp directory
      if (!fs.existsSync(pdfFile.path)) {
        return res.status(404).json({
          status: 'failed',
          error: 'PDF file no longer exists in temp directory.'
        });
      }
    }

    // Create a jobId and store job as processing
    const jobId = randomUUID();
    jobs[jobId] = { status: 'processing', data: null, pdfFile: pdfFile };

    // Respond immediately with jobId and status
    res.status(202).json({
      jobId,
      status: 'processing'
    });

    // Process recommendation generation asynchronously
    (async () => {
      let pdfText = null;
      
      // If PDF file is provided, perform OCR
      if (pdfFile) {
        try {
          pdfText = await extractTextFromPDF(pdfFile.path);
        } catch (ocrError) {
          console.error(`OCR failed:`, ocrError);
          // Continue even if OCR fails
        }
      }
      
      // Build prompt for LLM
      const prompt = buildRecommendationPrompt(filters, pdfText);
      console.log('\n=== Generated Prompt for LLM ===');
      console.log(prompt);
      console.log('=== End of Prompt ===\n');
      
      // Call RAG retriever to get LLM recommendations
      let recommendations = [];
      let summary = null;
      let llmResponse = null;
      
      try {
        llmResponse = await queryLLM(prompt);
        
        console.log('\n=== Parsing LLM Response ===');
        // Parse LLM response to extract recommendations
        // The response is in llmResponse.response field
        const answerField = llmResponse.response || llmResponse.answer;
        
        if (llmResponse && answerField) {
          console.log('LLM answer field found');
          console.log('Answer length:', answerField.length);
          console.log('First 500 chars of answer:', answerField.substring(0, 500));
          
          try {
            // Try to parse JSON object from the answer (new format with summary)
            const jsonObjectMatch = answerField.match(/\{[\s\S]*\}/);
            if (jsonObjectMatch) {
              console.log('JSON object found in answer');
              const parsedResponse = JSON.parse(jsonObjectMatch[0]);
              
              // Check if it has the new format with summary and cards
              if (parsedResponse.summary && parsedResponse.cards) {
                summary = parsedResponse.summary;
                recommendations = parsedResponse.cards;
                console.log('Successfully parsed new format with summary');
                console.log('Summary:', summary);
                console.log('Number of recommendations:', recommendations.length);
              } 
              // Fallback: check if it's the old array format
              else if (Array.isArray(parsedResponse)) {
                recommendations = parsedResponse;
                console.log('Successfully parsed old array format');
                console.log('Number of recommendations:', recommendations.length);
              } else {
                console.error('Unexpected JSON structure');
                console.error('Parsed response keys:', Object.keys(parsedResponse));
                jobs[jobId] = {
                  status: 'failed',
                  error: 'LLM response structure is unexpected'
                };
                return;
              }
            } 
            // Fallback: try to match array format (old format)
            else {
              const jsonArrayMatch = answerField.match(/\[[\s\S]*\]/);
              if (jsonArrayMatch) {
                console.log('JSON array found in answer (old format)');
                recommendations = JSON.parse(jsonArrayMatch[0]);
                console.log('Successfully parsed recommendations from LLM (old format)');
                console.log('Number of recommendations:', recommendations.length);
              } else {
                console.error('No JSON object or array found in LLM response');
                console.error('Full answer:', answerField);
                jobs[jobId] = {
                  status: 'failed',
                  error: 'LLM response did not contain valid JSON'
                };
                return;
              }
            }
          } catch (parseError) {
            console.error('Failed to parse LLM response as JSON:', parseError);
            console.error('Parse error details:', parseError.message);
            jobs[jobId] = {
              status: 'failed',
              error: 'Failed to parse LLM response'
            };
            return;
          }
        } else {
          console.error('LLM response format unexpected');
          console.error('Response structure:', Object.keys(llmResponse || {}));
          jobs[jobId] = {
            status: 'failed',
            error: 'Unexpected LLM response format'
          };
          return;
        }
        console.log('=== End of Parsing ===\n');
      } catch (llmError) {
        console.error('LLM query failed:', llmError.message);
        jobs[jobId] = {
          status: 'failed',
          error: 'Failed to query LLM service'
        };
        return;
      }
      
      // Create recommendation record
      const recommendationRecord = {
        id: recommendationIdCounter++,
        filters: filters,
        pdfFile: pdfFile ? {
          fileId: pdfFile.id,
          originalName: pdfFile.originalName,
          size: pdfFile.size,
          path: pdfFile.path,
          extractedText: pdfText ? pdfText.substring(0, 500) + '...' : null
        } : null,
        summary: summary,
        recommendations,
        count: recommendations.length,
        generatedAt: new Date().toISOString()
      };
      recommendationHistory.push(recommendationRecord);
      
      // Mark PDF file as used if provided
      if (pdfFile) {
        pdfFile.used = true;
      }
      
      jobs[jobId] = {
        status: 'completed',
        data: recommendationRecord
      };
    })();

  } catch (error) {
    console.error('Error starting recommendation job:', error);
    res.status(500).json({
      status: 'failed',
      error: 'Failed to start recommendation job',
      message: error.message
    });
  }
});
/**
 * GET /recommendations/status/:jobId
 * Poll recommendation job status and result
 */
router.get('/status/:jobId', async (req, res) => {
  const { jobId } = req.params;
  const job = jobs[jobId];
  if (!job) {
    return res.status(404).json({
      status: 'failed',
      error: 'Job not found'
    });
  }
  if (job.status === 'completed') {
    return res.status(200).json({
      status: 'completed',
      data: job.data
    });
  } else if (job.status === 'processing') {
    return res.status(200).json({
      status: 'processing'
    });
  } else {
    return res.status(500).json({
      status: 'failed',
      error: 'Job failed'
    });
  }
});

/**
 * GET /recommendations/history
 * Get recommendation history
 * 
 * Query parameters:
 * - limit: Maximum number of records to return (optional, default: 50)
 */
router.get('/history', async (req, res) => {
  try {
    const { limit = 50 } = req.query;

    let history = recommendationHistory;

    // Sort by most recent first and limit results
    const results = history
      .sort((a, b) => new Date(b.generatedAt) - new Date(a.generatedAt))
      .slice(0, parseInt(limit));

    res.status(200).json({
      success: true,
      data: {
        history: results,
        count: results.length,
        total: history.length
      }
    });

  } catch (error) {
    console.error('Error fetching recommendation history:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch recommendation history',
      message: error.message
    });
  }
});

/**
 * GET /recommendations/:id
 * Get a specific recommendation by ID
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Find recommendation by ID
    const recommendation = recommendationHistory.find(
      record => record.id === parseInt(id)
    );

    if (!recommendation) {
      return res.status(404).json({
        success: false,
        error: 'Recommendation not found'
      });
    }

    res.status(200).json({
      success: true,
      data: recommendation
    });

  } catch (error) {
    console.error('Error fetching recommendation:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch recommendation',
      message: error.message
    });
  }
});

module.exports = router;
