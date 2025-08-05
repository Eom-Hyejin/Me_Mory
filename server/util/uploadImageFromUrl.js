const axios = require('axios');
const { s3 } = require('./s3');
const { v4: uuidv4 } = require('uuid');

const uploadImageFromUrl = async (imageUrl) => {
  const res = await axios.get(imageUrl, { responseType: 'arraybuffer' });
  const buffer = Buffer.from(res.data, 'binary');
  const key = `profile/${uuidv4()}.jpg`;

  const upload = await s3.upload({
    Bucket: process.env.AWS_S3_BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: res.headers['content-type'],
  }).promise();

  return upload.Location;
};

module.exports = { uploadImageFromUrl };