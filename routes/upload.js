const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');
const router = express.Router();

// Create temp directory for uploaded files
const tempDir = path.join(__dirname, '../temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// Configure multer for file upload to temp directory
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, tempDir);
  },
  filename: (req, file, cb) => {
    // Generate unique filename with original extension
    const uniqueName = `${randomUUID()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

// File filter to only accept PDF files
const fileFilter = (req, file, cb) => {
  if (file.mimetype === 'application/pdf') {
    cb(null, true);
  } else {
    cb(new Error('Only PDF files are allowed'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// In-memory storage for uploaded files metadata
const uploadedFiles = [];

/**
 * POST /upload/pdf
 * Upload a PDF file
 * 
 * Request: multipart/form-data with 'pdf' field
 */
router.post('/pdf', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded'
      });
    }

    // Generate file ID
    const fileId = randomUUID();
    
    // Store file metadata
    const fileMetadata = {
      id: fileId,
      originalName: req.file.originalname,
      filename: req.file.filename,
      path: req.file.path,
      size: req.file.size,
      mimetype: req.file.mimetype,
      uploadedAt: new Date().toISOString(),
      used: false // Track if file has been used in recommendation generation
    };

    uploadedFiles.push(fileMetadata);

    res.status(200).json({
      success: true,
      message: 'PDF uploaded successfully to temp directory',
      data: {
        fileId: fileMetadata.id,
        originalName: fileMetadata.originalName,
        size: fileMetadata.size,
        uploadedAt: fileMetadata.uploadedAt
      }
    });

  } catch (error) {
    console.error('Error uploading PDF:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to upload PDF',
      message: error.message
    });
  }
});

/**
 * GET /upload/files
 * Get list of uploaded files
 */
router.get('/files', async (req, res) => {
  try {
    const files = uploadedFiles.map(file => ({
      id: file.id,
      originalName: file.originalName,
      size: file.size,
      uploadedAt: file.uploadedAt
    }));

    res.status(200).json({
      success: true,
      data: {
        files: files,
        count: files.length
      }
    });

  } catch (error) {
    console.error('Error fetching files:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch files',
      message: error.message
    });
  }
});

/**
 * GET /upload/files/:id
 * Get specific file metadata by ID
 */
router.get('/files/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const file = uploadedFiles.find(f => f.id === id);

    if (!file) {
      return res.status(404).json({
        success: false,
        error: 'File not found'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        id: file.id,
        originalName: file.originalName,
        size: file.size,
        uploadedAt: file.uploadedAt
      }
    });

  } catch (error) {
    console.error('Error fetching file:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch file',
      message: error.message
    });
  }
});

/**
 * DELETE /upload/files/:id
 * Delete uploaded file by ID
 */
router.delete('/files/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const fileIndex = uploadedFiles.findIndex(f => f.id === id);

    if (fileIndex === -1) {
      return res.status(404).json({
        success: false,
        error: 'File not found'
      });
    }

    const file = uploadedFiles[fileIndex];

    // Delete physical file
    if (fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }

    // Remove from metadata array
    uploadedFiles.splice(fileIndex, 1);

    res.status(200).json({
      success: true,
      message: 'File deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting file:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete file',
      message: error.message
    });
  }
});

// Export uploaded files array so it can be accessed by other routes
module.exports = router;
module.exports.uploadedFiles = uploadedFiles;
