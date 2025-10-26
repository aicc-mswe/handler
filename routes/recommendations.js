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
  const prompt = `You are a credit card recommendation expert. Based on the user's preferences and financial information, recommend suitable credit cards.

USER PREFERENCES:
${filters.cardTypes && filters.cardTypes.length > 0 ? `- Preferred Card Types: ${filters.cardTypes.join(', ')}` : '- No card type preference'}
${filters.rewardTypes && filters.rewardTypes.length > 0 ? `- Desired Reward Types: ${filters.rewardTypes.join(', ')}` : '- No reward type preference'}
${filters.annualFeeRange ? `- Annual Fee Range: $${filters.annualFeeRange}` : '- No annual fee preference'}
${filters.additionalRequirements ? `- Additional Requirements: ${filters.additionalRequirements}` : ''}

${ocrText ? `USER FINANCIAL INFORMATION (from uploaded document):
${ocrText}

Please analyze the user's financial situation from the document and consider it when making recommendations.
` : 'No financial document provided.'}

INSTRUCTIONS:
1. Analyze the user's preferences and financial situation
2. Recommend exactly 3 credit cards that best match their needs (ranked by match score)
3. For each card, provide detailed information including benefits, pros, and cons
4. Ensure recommendations are realistic and match the user's financial profile
5. Prioritize cards with the highest match to user preferences

OUTPUT FORMAT:
You must respond with a valid JSON array following this exact structure:
[
  {
    "id": 1,
    "name": "Card Name",
    "bankName": "Bank Name",
    "image": "https://example.com/card-image.png",
    "fee": "$XX",
    "cardType": "VISA/Mastercard/American Express/Discover",
    "rewards": "Brief description of rewards",
    "description": "Detailed description explaining why this card suits the user",
    "pros": ["Benefit 1", "Benefit 2", "Benefit 3"],
    "cons": ["Drawback 1", "Drawback 2"],
    "applyLink": "https://example.com/apply"
  }
]

Respond ONLY with the JSON array, no additional text or explanation.`;

  return prompt;
}

/**
 * Call RAG retriever endpoint to get LLM recommendations
 */
async function queryLLM(prompt) {
  try {
    const ragEndpoint = process.env.RAG_RETRIEVER_ENDPOINT || 'http://localhost:5002';
    const url = `${ragEndpoint}/query`;
    
    console.log(`\n=== Calling RAG Retriever ===`);
    console.log(`Endpoint: ${url}`);
    
    const response = await axios.post(url, {
      question: prompt,
      index_name: null,
      enable_reranking: true,
      model_name: "gpt-3.5-turbo",
      rerank_top_k: 10
    }, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 60000 // 60 seconds timeout
    });
    
    console.log('RAG Retriever response received');
    console.log('Response status:', response.status);
    
    return response.data;
    
  } catch (error) {
    console.error('Error calling RAG retriever:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
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
      let llmResponse = null;
      
      try {
        llmResponse = await queryLLM(prompt);
        console.log('\n=== LLM Response ===');
        console.log(JSON.stringify(llmResponse, null, 2));
        console.log('=== End of LLM Response ===\n');
        
        // Parse LLM response to extract recommendations
        if (llmResponse && llmResponse.answer) {
          try {
            // Try to parse JSON from the answer
            const jsonMatch = llmResponse.answer.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
              recommendations = JSON.parse(jsonMatch[0]);
              console.log('Successfully parsed recommendations from LLM');
            } else {
              console.error('No JSON array found in LLM response');
              jobs[jobId] = {
                status: 'failed',
                error: 'LLM response did not contain valid JSON array'
              };
              return;
            }
          } catch (parseError) {
            console.error('Failed to parse LLM response as JSON:', parseError);
            jobs[jobId] = {
              status: 'failed',
              error: 'Failed to parse LLM response'
            };
            return;
          }
        } else {
          console.error('LLM response format unexpected');
          jobs[jobId] = {
            status: 'failed',
            error: 'Unexpected LLM response format'
          };
          return;
        }
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
