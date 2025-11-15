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
  // Determine summary instruction based on whether OCR text is available
  const summaryInstruction = ocrText 
    ? 'Based on your uploaded statement, analyze the spending patterns and provide a consumer spending analysis (e.g., "Your spending is primarily in dining (40%), travel (30%), and groceries (20%). Based on these patterns..."). Then explain WHY you are recommending these specific 3 cards and how they match your spending habits and filter requirements (card network, annual fee, reward types).'
    : 'Since no statement was uploaded, explain WHY you are recommending these specific 3 cards based on the user\'s filter preferences (card network, annual fee, reward types). Describe what type of consumer would benefit most from these cards.';

  const prompt = `You are a credit card recommendation expert. Based on the user's preferences and spending patterns, recommend suitable credit cards.

USER PREFERENCES AND FILTERS (ALL FILTERS MUST BE RESPECTED):
${filters.cardTypes && filters.cardTypes.length > 0 ? `- Required Card Network: ${filters.cardTypes.join(', ')} *** MANDATORY - ONLY recommend cards from this network ***` : '- No card network restriction'}
${filters.rewardTypes && filters.rewardTypes.length > 0 ? `- Desired Reward Types: ${filters.rewardTypes.join(', ')} *** IMPORTANT - Prioritize cards with these reward types ***` : '- No reward type preference'}
${filters.annualFeeRange ? `- Annual Fee Range: $${filters.annualFeeRange} *** MANDATORY - All recommended cards MUST fall within this fee range ***` : '- No annual fee preference'}
${filters.additionalRequirements ? `- Additional Requirements: ${filters.additionalRequirements} *** MUST be considered ***` : ''}

FILTER COMPLIANCE RULES:
1. Card Network filter is ABSOLUTE - no exceptions allowed
2. Annual Fee filter is MANDATORY - exclude any cards outside this range
3. Reward Types filter is HIGH PRIORITY - strongly prefer cards matching these types
4. Additional Requirements must be incorporated into recommendations

${ocrText ? `USER SPENDING PATTERNS (from uploaded statement):
${ocrText}

IMPORTANT: The uploaded document shows the user's SPENDING HABITS and transaction history. Analyze ONLY the spending categories, amounts, and patterns. DO NOT consider which bank issued this statement. You can recommend cards from ANY bank/issuer as long as they match the user's spending patterns and filters.
` : 'No spending data provided.'}

CRITICAL INSTRUCTIONS:
1. **MANDATORY CARD NETWORK FILTER**: If "Required Card Network" is specified (e.g., VISA, Mastercard, American Express, Discover), you MUST ONLY recommend cards from that exact network. This is NON-NEGOTIABLE. Recommending cards from other networks is STRICTLY FORBIDDEN.
   - Example: If filter = "VISA", recommend ONLY VISA cards (from any bank: Chase, Bank of America, Citi, etc.)
   - Example: If filter = "Mastercard", recommend ONLY Mastercard cards (from any bank)
   - Example: If filter = "American Express", recommend ONLY American Express cards
2. **MANDATORY ANNUAL FEE COMPLIANCE**: All recommended cards MUST have annual fees within the specified range. If range is "$0-100", do NOT recommend cards with $150+ annual fees.
3. **REWARD TYPES PRIORITY**: When "Desired Reward Types" are specified (e.g., Flights, Cashback), strongly prioritize cards that offer these reward types. This is a key user preference.
4. Focus on the user's SPENDING PATTERNS from the uploaded statement, NOT the issuing bank
5. You can recommend cards from ANY bank/issuer, as long as they match ALL the filters
6. Analyze spending categories (dining, travel, groceries, gas, etc.) to match with appropriate reward structures
7. Recommend exactly 3 credit cards that best match the spending patterns and filters (ranked by match score)
8. Provide detailed information including benefits, pros, and sign-up bonus for each card
9. Ensure recommendations align with the user's spending habits, financial profile, AND all specified filters
10. **REWARDS CLARITY**: The rewards field MUST clearly specify exact cashback percentages (e.g., "2% cash back") or points earning rates (e.g., "3x points on dining"). Always include the earning rate per dollar spent for different categories.
11. **CRITICAL**: For sign-up bonus information, you MUST ONLY use data from the retrieved context/knowledge base. DO NOT make up or guess sign-up bonus offers. If no sign-up bonus information is available in the retrieved documents, use "Information not available" or "N/A". When reading bonus amounts, ignore any crossed-out or old offers - always use the current/highest bonus amount mentioned.

IMPORTANT REQUIREMENTS:
- **STRICT FILTER COMPLIANCE**: Every recommended card MUST satisfy ALL user-specified filters (card network, annual fee range, reward types). Non-compliance is unacceptable.
- **ANNUAL FEE VERIFICATION**: Double-check that each card's annual fee falls within the specified range before including it in recommendations.
- **REWARD TYPE MATCHING**: When reward types are specified, ensure recommended cards offer strong rewards in those categories.
- **REWARDS SPECIFICITY**: Rewards must include specific earning rates. Use formats like "X% cash back" or "Xx points per dollar". Break down by category when applicable (e.g., "3x points on dining and travel, 1x on everything else").
- **SIGN-UP BONUS ACCURACY**: ONLY use sign-up bonus information that appears in the retrieved context/documents. Never fabricate or guess bonus amounts. If the information is not in the retrieved context, set signUpBonus to "Information not available". If you see multiple bonus amounts in the context (e.g., old crossed-out offer and new offer), ALWAYS use the HIGHER/CURRENT bonus amount.
- **CARD NETWORK COMPLIANCE**: Strictly follow the "Required Card Network" filter. All recommended cards must be from the specified network (VISA/Mastercard/American Express/Discover)
- **IGNORE STATEMENT ISSUER**: Do not let the bank that issued the uploaded statement influence your recommendations. Focus only on spending patterns.
- **CROSS-BANK RECOMMENDATIONS**: Feel free to recommend cards from different banks (Chase, Citi, Bank of America, Capital One, etc.) as long as they match the card network filter
- **CRITICAL - IMAGE URL ACCURACY**: You MUST use the EXACT "Official Image URL" provided in the retrieved context for each card. The context will explicitly provide "Official Image URL: https://..." for each credit card. DO NOT modify, change, or make up image URLs. Copy the exact URL from the context.
- **CRITICAL - APPLICATION LINK**: If an application URL or source URL is provided in the context, use it. Otherwise, construct it based on the card name and issuer.
- DO NOT use placeholder URLs like "https://example.com"
- Each card should have its own unique image URL from the retrieved context
- Each card should have its own unique application URL
- Different banks will have DIFFERENT domain names (e.g., Chase cards use chase.com, Amex cards use americanexpress.com, Citi cards use citi.com, Capital One cards use capitalone.com, etc.)

OUTPUT FORMAT:
You must respond with a valid JSON object with the following structure:
{
  "summary": "${summaryInstruction}",
  "cards": [
    {
      "id": 1,
      "name": "Card Name (MUST match the card name from retrieved context)",
      "bankName": "Bank Name (MUST match the issuer from retrieved context)",
      "image": "EXACT_IMAGE_URL_FROM_CONTEXT (Copy the 'Official Image URL' from the retrieved context exactly as provided)",
      "fee": "$XX (MUST be within specified annual fee range AND match the fee mentioned in retrieved context)",
      "cardType": "VISA/Mastercard/American Express/Discover (MUST EXACTLY match the Required Card Network filter)",
      "signUpBonus": "ONLY use sign-up bonus from retrieved context. If not found in context, use 'Information not available'. Example: 'Earn 60,000 bonus points after spending $4,000 in first 3 months' or 'Information not available'",
      "rewards": "MUST clearly specify the exact cashback percentage or points earned per dollar spent. Include category-specific rates. Should align with user's desired reward types if specified. Example: '2% cash back on all purchases' or '3x points on dining, 2x on travel, 1x on everything else' or '5% cash back on rotating categories'",
      "description": "Detailed description explaining why this card suits the user's SPENDING HABITS and how it meets their filter criteria",
      "pros": ["Benefit 1 related to spending", "Benefit 2", "Benefit 3"],
      "applyLink": "REAL_APPLICATION_URL (Use Source URL from context if available, or construct based on card name and issuer)"
    }
  ]
}

Example summary:
"Based on your high spending on dining and travel, these three VISA cards offer the best rewards in those categories. The Chase Sapphire Preferred leads with 2x points on travel and dining, while the Bank of America Travel Rewards provides no annual fee access to travel perks. The Citi Premier rounds out with bonus points on restaurants and gas stations."

REWARDS FIELD EXAMPLES (follow these formats):
- Cash back cards: "2% cash back on all purchases" or "3% cash back on dining, 2% on gas, 1% on everything else"
- Points cards: "3x points on dining and travel, 1x on all other purchases" or "5x points on flights booked through airline portals, 2x on restaurants"
- Category bonus: "5% cash back on rotating quarterly categories (up to $1,500 per quarter), 1% on everything else"
- Tiered rewards: "3% cash back at U.S. supermarkets (up to $6,000/year), 2% at U.S. gas stations, 1% on other purchases"

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
      timeout: 120000 // 120 seconds timeout (increased for LLM processing)
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
 * Extract text from PDF using pdf-parse
 * This function extracts text from text-based PDFs
 * Note: For scanned/image PDFs, you would need to convert PDF to images first,
 * then use OCR on those images (requires additional libraries like pdf2pic)
 */
async function extractTextFromPDF(pdfPath) {
  try {
    const dataBuffer = fs.readFileSync(pdfPath);
    
    console.log('--- Extracting text from PDF ---');
    console.log(`File size: ${dataBuffer.length} bytes`);
    
    // Try to parse with pdf-parse
    const pdfData = await pdf(dataBuffer, {
      // Increase max pages to prevent timeout
      max: 50,
      // Normalize whitespace
      normalizeWhitespace: true
    });
    
    const extractedText = pdfData.text;
    
    if (!extractedText || extractedText.trim().length === 0) {
      console.warn('Warning: PDF appears to be empty or contains only images');
      console.warn('For scanned PDFs, you need to convert to images first, then use OCR');
      return null; // Return null instead of error message
    }
    
    console.log('--- Extracted Text ---');
    console.log(extractedText.substring(0, 500) + '...');
    console.log(`Total characters extracted: ${extractedText.length}`);
    console.log('--- End of Extracted Text ---');
    
    return extractedText;
    
  } catch (error) {
    console.error('Error during PDF text extraction:', error.message);
    console.error('PDF file may be corrupted, password-protected, or in an unsupported format');
    
    // Return null to indicate extraction failed
    // This will trigger the "no statement uploaded" flow
    return null;
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
      let pdfExtractionError = null;
      
      // If PDF file is provided, perform text extraction
      if (pdfFile) {
        console.log(`\n=== Processing PDF File ===`);
        console.log(`File ID: ${pdfFile.id}`);
        console.log(`File Path: ${pdfFile.path}`);
        console.log(`File exists: ${fs.existsSync(pdfFile.path)}`);
        
        try {
          pdfText = await extractTextFromPDF(pdfFile.path);
          console.log(`\n=== PDF Text Extraction Result ===`);
          console.log(`Text extracted: ${pdfText ? 'YES' : 'NO'}`);
          console.log(`Text length: ${pdfText ? pdfText.length : 0}`);
          console.log(`Text is empty string: ${pdfText === ''}`);
          console.log(`Text is null: ${pdfText === null}`);
          console.log(`=== End of PDF Text Extraction Result ===\n`);
          
          if (!pdfText) {
            pdfExtractionError = 'PDF file could not be processed. The file may be corrupted, password-protected, or in an unsupported format. Recommendations will be based only on your filter preferences.';
          }
        } catch (ocrError) {
          console.error(`PDF text extraction failed:`, ocrError);
          pdfExtractionError = 'PDF text extraction encountered an error. Recommendations will be based only on your filter preferences.';
          // Continue even if extraction fails
        }
      } else {
        console.log('\n=== No PDF File Provided ===\n');
      }
      
      // Build prompt for LLM
      console.log(`\n=== Building Prompt ===`);
      console.log(`pdfText value: ${pdfText === null ? 'null' : pdfText === '' ? 'empty string' : 'has content (' + pdfText.length + ' chars)'}`);
      const prompt = buildRecommendationPrompt(filters, pdfText);
      console.log('=== Generated Prompt for LLM ===');
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
          extractedText: pdfText ? pdfText.substring(0, 500) + '...' : null,
          extractionSuccess: !!pdfText,
          extractionError: pdfExtractionError
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

/**
 * POST /recommendations/chat
 * Chat about a specific recommendation
 * 
 * Request body:
 * {
 *   "recommendationId": "string",
 *   "message": "user's question",
 *   "chatHistory": [...previous messages],
 *   "recommendationData": {
 *     "summary": "...",
 *     "recommendations": [...cards],
 *     "filters": {...}
 *   }
 * }
 */
router.post('/chat', async (req, res) => {
  try {
    const { recommendationId, message, chatHistory, recommendationData } = req.body;

    // Validate inputs
    if (!message || !message.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Message is required'
      });
    }

    if (!recommendationData) {
      return res.status(400).json({
        success: false,
        error: 'Recommendation data is required'
      });
    }

    // Build context from recommendation data
    const cardsContext = recommendationData.recommendations?.map(card => 
      `Card: ${card.name} by ${card.bankName}
      - Card Type: ${card.cardType}
      - Annual Fee: ${card.fee}
      - Sign-up Bonus: ${card.signUpBonus || 'N/A'}
      - Rewards: ${card.rewards}
      - Description: ${card.description}
      - Pros: ${card.pros?.join(', ') || 'N/A'}`
    ).join('\n\n') || 'No cards available';

    // Build chat history context
    const chatContext = chatHistory?.map(msg => 
      `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`
    ).join('\n') || 'No previous conversation';

    // Build prompt for chat
    const chatPrompt = `You are a helpful credit card advisor assistant. You are having a conversation with a user about their credit card recommendations.

RECOMMENDED CARDS CONTEXT:
Summary: ${recommendationData.summary || 'N/A'}
User's Filter Preferences: ${JSON.stringify(recommendationData.filters || {}, null, 2)}

${cardsContext}

PREVIOUS CONVERSATION:
${chatContext}

USER'S CURRENT QUESTION:
${message}

INSTRUCTIONS:
1. Answer the user's question based on the recommended cards and conversation context
2. Be helpful, friendly, and concise
3. If asked about specific cards, refer to the card details provided above
4. If asked about benefits not mentioned, you can provide general knowledge about credit cards but prioritize information from the context
5. If you don't know something specific about a card, be honest and suggest checking the issuer's website
6. Keep responses clear and well-organized
7. Use bullet points or numbered lists when appropriate
8. DO NOT include generic closing statements like "If you have any questions" or "Feel free to ask" - this is an ongoing conversation
9. End your response naturally after answering the question

Provide a direct, helpful response to the user's question without unnecessary closing remarks:`;

    console.log('\n=== Chat Request ===');
    console.log('Recommendation ID:', recommendationId);
    console.log('User Message:', message);
    console.log('Chat History Length:', chatHistory?.length || 0);
    console.log('Building chat prompt...');

    // Call LLM
    const llmResponse = await queryLLM(chatPrompt);

    console.log('\n=== LLM Chat Response ===');
    console.log('Response received');

    // Extract answer from LLM response
    const answer = llmResponse.response || llmResponse.answer || 'I apologize, but I could not generate a response. Please try again.';

    res.status(200).json({
      success: true,
      data: {
        reply: answer,
        messageId: `msg-${Date.now()}`
      }
    });

  } catch (error) {
    console.error('Error processing chat request:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process chat request',
      message: error.message
    });
  }
});

module.exports = router;
