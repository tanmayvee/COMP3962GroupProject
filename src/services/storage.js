// file storage adapter
// local mode: saves to /uploads on your machine
// aws mode:   saves to S3
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

const aws = {
  //  still need to implement aws.save() and aws.getUrl() for S3 storage, but for now throw an error if you try to use it
  async save() { throw new Error('S3 storage not wired up yet'); },
  async getUrl() { throw new Error('S3 storage not wired up yet'); },
};

module.exports = process.env.STORAGE_DRIVER === 'aws' ? aws : local;
