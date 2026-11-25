// file storage adapter
// local mode: saves to /uploads on your machine
// aws mode:   saves to a private S3 bucket
// the rest of the app should only call save() and getUrl(), so nothing else changes

const fs = require('fs/promises');
const path = require('path');

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');

const local = {
  async save(key, buffer /*, contentType */) {
    const filePath = path.join(UPLOAD_DIR, key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, buffer);
    return key;
  },
  async getUrl(key) {
    // app.js serves /uploads as static files, so this just works locally
    return `/uploads/${key}`;
  },
};

// the aws sdk only gets loaded when we actually use it
function makeAws() {
  const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
  const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

  // no access keys here: on EC2 the sdk picks up the instance's IAM role by itself
  // (locally it'd use your `aws configure` profile)
  const s3 = new S3Client({ region: process.env.AWS_REGION });
  const Bucket = process.env.S3_BUCKET;

  return {
    async save(key, buffer, contentType) {
      await s3.send(new PutObjectCommand({ Bucket, Key: key, Body: buffer, ContentType: contentType }));
      return key;
    },
    // the bucket is private, so instead of a public link we hand out a temporary one
    // that only works for an hour (a "presigned url")
    async getUrl(key) {
      return getSignedUrl(s3, new GetObjectCommand({ Bucket, Key: key }), { expiresIn: 3600 });
    },
  };
}

module.exports = process.env.STORAGE_DRIVER === 'aws' ? makeAws() : local;
