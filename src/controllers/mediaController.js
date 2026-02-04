const cloudinary = require('cloudinary').v2;
const config = require('../config');

// Configure Cloudinary
cloudinary.config({
  cloud_name: config.get('media.cloudinary.cloudName'),
  api_key: config.get('media.cloudinary.apiKey'),
  api_secret: config.get('media.cloudinary.apiSecret')
});

exports.uploadMedia = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: 'pulse/posts',
        resource_type: 'auto',
        transformation: [
          { width: 1080, crop: 'limit' },
          { quality: 'auto:good' }
        ]
      },
      (error, result) => {
        if (error) {
          return res.status(500).json({
            success: false,
            message: 'Upload failed',
            error: error.message
          });
        }

        res.json({
          success: true,
          data: {
            url: result.secure_url,
            publicId: result.public_id,
            width: result.width,
            height: result.height,
            format: result.format,
            type: result.resource_type
          }
        });
      }
    );

    require('stream').Readable.from(req.file.buffer).pipe(uploadStream);

  } catch (error) {
    console.error('Upload media error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

exports.uploadMultipleMedia = async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No files uploaded'
      });
    }

    const uploadPromises = req.files.map(file => {
      return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            folder: 'pulse/posts',
            resource_type: 'auto',
            transformation: [
              { width: 1080, crop: 'limit' },
              { quality: 'auto:good' }
            ]
          },
          (error, result) => {
            if (error) reject(error);
            else resolve({
              url: result.secure_url,
              publicId: result.public_id,
              width: result.width,
              height: result.height,
              format: result.format,
              type: result.resource_type
            });
          }
        );
        require('stream').Readable.from(file.buffer).pipe(uploadStream);
      });
    });

    const results = await Promise.all(uploadPromises);

    res.json({
      success: true,
      data: results
    });

  } catch (error) {
    console.error('Upload multiple media error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Upload failed',
      error: error.message
    });
  }
};
