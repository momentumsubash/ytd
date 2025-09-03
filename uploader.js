const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand, HeadBucketCommand } = require('@aws-sdk/client-s3');
const mime = require('mime-types');

class S3MediaUploader {
    constructor(bucketName, sourceFolder, transferredFolder, awsRegion = 'us-east-1') {
        this.bucketName = bucketName;
        this.sourceFolder = path.resolve(sourceFolder);
        this.transferredFolder = path.resolve(transferredFolder);
        this.logFile = path.resolve('upload_log.json');
        
        // Supported media file extensions
        this.supportedExtensions = new Set([
            '.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv', '.webm', // Video
            '.mp3', '.wav', '.aac', '.flac', '.ogg', '.m4a', '.wma'  // Audio
        ]);
        
        // Initialize S3 client
        this.s3Client = new S3Client({
            region: awsRegion,
            credentials: {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
            }
        });
        
        // Load upload log
        this.uploadLog = null;
    }
    
    async init() {
        try {
            // Test S3 connection
            await this.s3Client.send(new HeadBucketCommand({ Bucket: this.bucketName }));
            this.log(`✅ Successfully connected to S3 bucket: ${this.bucketName}`);
            
            // Create directories if they don't exist
            await this.ensureDirectoryExists(this.sourceFolder);
            await this.ensureDirectoryExists(this.transferredFolder);
            
            // Load upload log
            this.uploadLog = await this.loadUploadLog();
            
            return true;
        } catch (error) {
            if (error.name === 'CredentialsProviderError') {
                this.log('❌ AWS credentials not found. Please set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables.', 'error');
            } else if (error.$metadata?.httpStatusCode === 404) {
                this.log(`❌ Bucket '${this.bucketName}' not found.`, 'error');
            } else {
                this.log(`❌ Error connecting to S3: ${error.message}`, 'error');
            }
            throw error;
        }
    }
    
    async ensureDirectoryExists(dirPath) {
        try {
            await fs.access(dirPath);
        } catch (error) {
            if (error.code === 'ENOENT') {
                await fs.mkdir(dirPath, { recursive: true });
                this.log(`📁 Created directory: ${dirPath}`);
            }
        }
    }
    
    async loadUploadLog() {
        try {
            if (fsSync.existsSync(this.logFile)) {
                const data = await fs.readFile(this.logFile, 'utf8');
                return JSON.parse(data);
            } else {
                return { uploadedFiles: {} };
            }
        } catch (error) {
            this.log('⚠️ Upload log file is corrupted. Creating new log.', 'warning');
            return { uploadedFiles: {} };
        }
    }
    
    async saveUploadLog() {
        try {
            await fs.writeFile(this.logFile, JSON.stringify(this.uploadLog, null, 2), 'utf8');
        } catch (error) {
            this.log(`❌ Error saving upload log: ${error.message}`, 'error');
        }
    }
    
    isMediaFile(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        return this.supportedExtensions.has(ext);
    }
    
    isAlreadyUploaded(filename) {
        return filename in this.uploadLog.uploadedFiles;
    }
    
    async getMediaFiles() {
        try {
            const files = await fs.readdir(this.sourceFolder);
            const mediaFiles = [];
            
            for (const file of files) {
                const filePath = path.join(this.sourceFolder, file);
                const stats = await fs.stat(filePath);
                
                if (stats.isFile() && this.isMediaFile(filePath)) {
                    mediaFiles.push({
                        name: file,
                        path: filePath,
                        size: stats.size
                    });
                }
            }
            
            return mediaFiles;
        } catch (error) {
            this.log(`❌ Error reading source folder: ${error.message}`, 'error');
            return [];
        }
    }
    
    async uploadToS3(filePath, s3Key) {
        try {
            const fileBuffer = await fs.readFile(filePath);
            const contentType = mime.lookup(filePath) || 'application/octet-stream';
            
            const command = new PutObjectCommand({
                Bucket: this.bucketName,
                Key: s3Key,
                Body: fileBuffer,
                ContentType: contentType
            });
            
            const fileSize = (fileBuffer.length / (1024 * 1024)).toFixed(2);
            this.log(`📤 Uploading ${path.basename(filePath)} (${fileSize} MB)...`);
            
            await this.s3Client.send(command);
            this.log(`✅ Successfully uploaded ${path.basename(filePath)} to S3`);
            return true;
            
        } catch (error) {
            this.log(`❌ Failed to upload ${path.basename(filePath)}: ${error.message}`, 'error');
            return false;
        }
    }
    
    async moveToTransferred(filePath) {
        try {
            const filename = path.basename(filePath);
            let destination = path.join(this.transferredFolder, filename);
            
            // Handle filename conflicts
            let counter = 1;
            const originalDestination = destination;
            while (fsSync.existsSync(destination)) {
                const ext = path.extname(filename);
                const name = path.basename(filename, ext);
                destination = path.join(this.transferredFolder, `${name}_${counter}${ext}`);
                counter++;
            }
            
            await fs.rename(filePath, destination);
            this.log(`📦 Moved ${filename} to transferred folder`);
            return true;
            
        } catch (error) {
            this.log(`❌ Failed to move ${path.basename(filePath)} to transferred folder: ${error.message}`, 'error');
            return false;
        }
    }
    
    logUpload(filename, s3Key, fileSize) {
        this.uploadLog.uploadedFiles[filename] = {
            s3Key: s3Key,
            uploadDate: new Date().toISOString(),
            fileSizeBytes: fileSize,
            status: 'completed'
        };
    }
    
    async processFiles(alreadyUploaded = []) {
        const mediaFiles = await this.getMediaFiles();
        
        if (mediaFiles.length === 0) {
            this.log('ℹ️ No media files found in source folder');
            return { uploadedFiles: [], skippedFiles: [], failedFiles: [] };
        }
        
        this.log(`📋 Found ${mediaFiles.length} media files to process`);
        
        const results = {
            uploadedFiles: [],
            skippedFiles: [],
            failedFiles: []
        };
        
        for (const file of mediaFiles) {
            // Skip if already uploaded (from our tracking)
            const isAlreadyUploaded = alreadyUploaded.includes(file.name) || this.isAlreadyUploaded(file.name);
            
            if (isAlreadyUploaded) {
                this.log(`⏭️ Skipping ${file.name} - already uploaded`);
                results.skippedFiles.push(file.name);
                continue;
            }
            
            // Upload to S3
            const s3Key = `media/${file.name}`; // Customize S3 key structure as needed
            if (await this.uploadToS3(file.path, s3Key)) {
                // Log the upload
                this.logUpload(file.name, s3Key, file.size);
                
                // Move to transferred folder
                if (await this.moveToTransferred(file.path)) {
                    results.uploadedFiles.push(file.name);
                    this.log(`✅ Successfully processed ${file.name}`);
                } else {
                    results.failedFiles.push(file.name);
                }
                
                // Save log after each successful upload
                await this.saveUploadLog();
            } else {
                results.failedFiles.push(file.name);
            }
        }
        
        // Print summary
        this.log(`
📊 Upload Summary:
✅ Uploaded: ${results.uploadedFiles.length} files
⏭️ Skipped (already uploaded): ${results.skippedFiles.length} files
❌ Failed: ${results.failedFiles.length} files
📁 Total processed: ${mediaFiles.length} files
        `);
        
        return results;
    }
    
    showUploadHistory() {
        const uploadedFiles = this.uploadLog.uploadedFiles || {};
        
        if (Object.keys(uploadedFiles).length === 0) {
            console.log('ℹ️ No files have been uploaded yet.');
            return;
        }
        
        console.log(`\n📋 Upload History (${Object.keys(uploadedFiles).length} files):`);
        console.log('-'.repeat(80));
        
        for (const [filename, details] of Object.entries(uploadedFiles)) {
            const uploadDate = details.uploadDate || 'Unknown';
            const fileSize = details.fileSizeBytes || 0;
            const s3Key = details.s3Key || 'Unknown';
            
            console.log(`📄 File: ${filename}`);
            console.log(`   🔑 S3 Key: ${s3Key}`);
            console.log(`   📅 Upload Date: ${uploadDate}`);
            console.log(`   📦 Size: ${(fileSize / (1024 * 1024)).toFixed(2)} MB`);
            console.log(`   ✅ Status: ${details.status || 'Unknown'}`);
            console.log();
        }
    }
    
    log(message, level = 'info') {
        const timestamp = new Date().toISOString();
        const logEntry = `[${timestamp}] ${level.toUpperCase()}: ${message}\n`;
        
        // Color coding for console
        if (level === 'error') {
            console.error('\x1b[31m%s\x1b[0m', message);
        } else if (level === 'warning') {
            console.warn('\x1b[33m%s\x1b[0m', message);
        } else if (level === 'success') {
            console.log('\x1b[32m%s\x1b[0m', message);
        } else {
            console.log(message);
        }
        
        // Also write to log file
        fsSync.appendFileSync('s3_uploader.log', logEntry);
    }
}

module.exports = { S3MediaUploader };