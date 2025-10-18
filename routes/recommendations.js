const express = require('express');
const multer = require('multer');
const router = express.Router();

// Configure multer for handling multipart/form-data
const upload = multer();

// In-memory storage for demonstration (replace with database in production)
const recommendationHistory = [];
let recommendationIdCounter = 1;

// In-memory job store for async recommendation jobs
const jobs = {}; // jobId: { status, data }
const { randomUUID } = require('crypto');

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

    // Create a jobId and store job as processing
    const jobId = randomUUID();
    jobs[jobId] = { status: 'processing', data: null };

    // Simulate async recommendation generation
    setTimeout(() => {
      // Always return mock data
      const recommendations = getMockCards();
      const recommendationRecord = {
        id: recommendationIdCounter++,
        filters: filters,
        recommendations,
        count: recommendations.length,
        generatedAt: new Date().toISOString()
      };
      recommendationHistory.push(recommendationRecord);
      jobs[jobId] = {
        status: 'completed',
        data: recommendationRecord
      };
    }, 10000); // 10 seconds

    // Respond immediately with jobId and status
    res.status(202).json({
      jobId,
      status: 'processing'
    });
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
 * Helper function to return mock credit card data
 */
function getMockCards() {
  const mockCards = [
    {
      id: 1,
      name: 'Chase Sapphire Preferred',
      bankName: 'Chase',
      image: 'https://www.uscreditcardguide.com/wp-content/uploads/csp-e1629138224670.png',
      fee: '$95',
      cardType: 'VISA',
      rewards: '5x travel, 3x dining, 2x other travel',
      description: 'Perfect for travelers who want flexibility with points redemption and excellent travel protections. Great for those who spend heavily on dining and travel.',
      pros: ['Flexible point redemption', 'Strong travel protections', 'No foreign transaction fees'],
      cons: ['Higher annual fee', 'Requires good credit score'],
      applyLink: 'https://creditcards.chase.com/rewards-credit-cards/sapphire/preferred'
    },
    {
      id: 2,
      name: 'American Express Gold Card',
      bankName: 'American Express',
      image: 'https://icm.aexp-static.com/Internet/Acquisition/US_en/AppContent/OneSite/category/cardarts/gold-card.png',
      fee: '$250',
      cardType: 'American Express',
      rewards: '4x restaurants, 4x groceries, 3x flights',
      description: 'Ideal for food enthusiasts and frequent grocery shoppers. Offers excellent dining rewards and valuable annual credits.',
      pros: ['High dining rewards', 'Valuable annual credits', 'Premium benefits'],
      cons: ['Higher annual fee', 'Limited acceptance internationally'],
      applyLink: 'https://www.americanexpress.com/us/credit-cards/card/gold-card/'
    },
    {
      id: 3,
      name: 'Capital One Venture Rewards',
      bankName: 'Capital One',
      image: 'https://ecm.capitalone.com/WCM/card/products/venture-card-art.png',
      fee: '$95',
      cardType: 'VISA',
      rewards: '2x miles on all purchases',
      description: 'Simple and straightforward travel rewards card with consistent earning on all purchases. Great for those who want simplicity.',
      pros: ['Simple earning structure', 'No foreign transaction fees', 'Travel credits'],
      cons: ['Lower earning rate', 'Limited transfer partners'],
      applyLink: 'https://www.capitalone.com/credit-cards/venture/'
    }
  ];

  return mockCards;
}

module.exports = router;
