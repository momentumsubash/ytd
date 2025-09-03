require('dotenv').config();
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand, HeadBucketCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const mime = require('mime-types');
const crypto = require('crypto');

class S3MediaUploader {
    constructor(bucketName, sourceFolder, transferredFolder, awsRegion = 'ap-south-1') {
        this.bucketName = bucketName;
        this.sourceFolder = path.resolve(sourceFolder);
        this.transferredFolder = path.resolve(transferredFolder);
        this.progressFile = path.resolve('s3_upload_progress.json');
        this.logFile = path.resolve('s3_uploader.log');
        
        // Supported media file extensions
        this.supportedExtensions = new Set([
            '.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv', '.webm', '.m4v', // Video
            '.mp3', '.wav', '.aac', '.flac', '.ogg', '.m4a', '.wma', '.opus'  // Audio
        ]);
        
        // Initialize S3 client with better credential handling
        this.s3Client = this.createS3Client(awsRegion);
        
        // Progress tracking
        this.progress = null;
        this.sessionStats = {
            uploaded: 0,
            skipped: 0,
            failed: 0,
            totalSize: 0,
            uploadedSize: 0
        };
    }
    
    createS3Client(region) {
        const config = {
            region: region,
            forcePathStyle: false,
            // Increase timeout for large uploads
            requestHandler: {
                requestTimeout: 300000, // 5 minutes
                httpsAgent: {
                    timeout: 300000
                }
            }
        };

        // Multiple credential strategies
        if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
            config.credentials = {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
            };
            this.log('Using explicit AWS credentials from environment variables', 'info');
        } else {
            // Try to use default credential chain (AWS CLI, EC2 role, etc.)
            this.log('No explicit credentials found. Using default AWS credential chain', 'info');
        }

        return new S3Client(config);
    }
    
    async init() {
        try {
            // Load progress first
            this.progress = await this.loadProgress();
            
            // Test S3 connection
            this.log('Testing S3 connection...', 'info');
            await this.s3Client.send(new HeadBucketCommand({ Bucket: this.bucketName }));
            this.log(`Successfully connected to S3 bucket: ${this.bucketName}`, 'success');
            
            // Create directories if they don't exist
            await this.ensureDirectoryExists(this.sourceFolder);
            await this.ensureDirectoryExists(this.transferredFolder);
            
            return true;
        } catch (error) {
            if (error.name === 'CredentialsProviderError' || error.message.includes('credential')) {
                this.log('AWS credentials error. Please ensure credentials are properly configured:', 'error');
                this.log('1. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables', 'error');
                this.log('2. Or configure AWS CLI: aws configure', 'error');
                this.log('3. Or use IAM roles if running on AWS', 'error');
            } else if (error.$metadata?.httpStatusCode === 404) {
                this.log(`Bucket '${this.bucketName}' not found or access denied.`, 'error');
            } else if (error.name === 'NetworkingError') {
                this.log('Network error. Check your internet connection.', 'error');
            } else {
                this.log(`Error connecting to S3: ${error.message}`, 'error');
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
                this.log(`Created directory: ${dirPath}`, 'info');
            }
        }
    }
    
    async loadProgress() {
        try {
            if (fsSync.existsSync(this.progressFile)) {
                const data = await fs.readFile(this.progressFile, 'utf8');
                const progress = JSON.parse(data);
                this.log(`Loaded progress: ${Object.keys(progress.uploadedFiles || {}).length} files previously uploaded`, 'info');
                return progress;
            } else {
                return {
                    uploadedFiles: {},
                    session: {
                        startTime: new Date().toISOString(),
                        lastUpdated: new Date().toISOString(),
                        totalFiles: 0,
                        completedFiles: 0
                    }
                };
            }
        } catch (error) {
            this.log('Progress file is corrupted. Creating new progress tracking.', 'warning');
            return {
                uploadedFiles: {},
                session: {
                    startTime: new Date().toISOString(),
                    lastUpdated: new Date().toISOString(),
                    totalFiles: 0,
                    completedFiles: 0
                }
            };
        }
    }
    
    async saveProgress() {
        try {
            this.progress.session.lastUpdated = new Date().toISOString();
            await fs.writeFile(this.progressFile, JSON.stringify(this.progress, null, 2), 'utf8');
        } catch (error) {
            this.log(`Error saving progress: ${error.message}`, 'error');
        }
    }
    
    generateFileHash(filePath) {
        try {
            const fileBuffer = fsSync.readFileSync(filePath);
            const hash = crypto.createHash('md5').update(fileBuffer).digest('hex');
            return hash;
        } catch (error) {
            this.log(`Error generating hash for ${filePath}: ${error.message}`, 'warning');
            return null;
        }
    }
    
    isMediaFile(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        return this.supportedExtensions.has(ext);
    }
    
    isAlreadyUploaded(filename, filePath = null) {
        const uploadRecord = this.progress.uploadedFiles[filename];
        if (!uploadRecord) return false;
        
        // Additional verification with file hash if path provided
        if (filePath && uploadRecord.fileHash) {
            const currentHash = this.generateFileHash(filePath);
            if (currentHash && currentHash !== uploadRecord.fileHash) {
                this.log(`File ${filename} has changed (different hash). Will re-upload.`, 'warning');
                return false;
            }
        }
        
        return uploadRecord.status === 'completed';
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
                        size: stats.size,
                        hash: this.generateFileHash(filePath)
                    });
                }
            }
            
            // Sort by name for consistent processing order
            mediaFiles.sort((a, b) => a.name.localeCompare(b.name));
            
            return mediaFiles;
        } catch (error) {
            this.log(`Error reading source folder: ${error.message}`, 'error');
            return [];
        }
    }
    
    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
    
    async uploadToS3(filePath, s3Key, fileSize) {
        const startTime = Date.now();
        let uploadStream = null;
        
        try {
            const fileBuffer = await fs.readFile(filePath);
            const contentType = mime.lookup(filePath) || 'application/octet-stream';
            
            const command = new PutObjectCommand({
                Bucket: this.bucketName,
                Key: s3Key,
                Body: fileBuffer,
                ContentType: contentType,
                Metadata: {
                    'original-filename': path.basename(filePath),
                    'upload-timestamp': new Date().toISOString()
                }
            });
            
            this.log(`Uploading ${path.basename(filePath)} (${this.formatFileSize(fileSize)})...`, 'info');
            
            const response = await this.s3Client.send(command);
            const uploadTime = ((Date.now() - startTime) / 1000).toFixed(2);
            const uploadSpeed = (fileSize / (1024 * 1024) / (uploadTime / 1)).toFixed(2);
            
            this.log(`Successfully uploaded ${path.basename(filePath)} in ${uploadTime}s (${uploadSpeed} MB/s)`, 'success');
            return true;
            
        } catch (error) {
            const uploadTime = ((Date.now() - startTime) / 1000).toFixed(2);
            this.log(`Failed to upload ${path.basename(filePath)} after ${uploadTime}s: ${error.message}`, 'error');
            
            // Log specific error types
            if (error.name === 'NetworkingError') {
                this.log('Network error occurred. Check your internet connection.', 'warning');
            } else if (error.$metadata?.httpStatusCode === 403) {
                this.log('Permission denied. Check your AWS credentials and bucket permissions.', 'warning');
            }
            
            return false;
        }
    }
    
    async moveToTransferred(filePath) {
        try {
            const filename = path.basename(filePath);
            let destination = path.join(this.transferredFolder, filename);
            
            // Handle filename conflicts by adding timestamp
            if (fsSync.existsSync(destination)) {
                const ext = path.extname(filename);
                const name = path.basename(filename, ext);
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
                destination = path.join(this.transferredFolder, `${name}_${timestamp}${ext}`);
            }
            
            await fs.rename(filePath, destination);
            this.log(`Moved ${filename} to transferred folder`, 'info');
            return true;
            
        } catch (error) {
            this.log(`Failed to move ${path.basename(filePath)} to transferred folder: ${error.message}`, 'error');
            return false;
        }
    }
    
    logUpload(filename, s3Key, fileSize, fileHash) {
        this.progress.uploadedFiles[filename] = {
            s3Key: s3Key,
            uploadDate: new Date().toISOString(),
            fileSizeBytes: fileSize,
            fileHash: fileHash,
            status: 'completed',
            bucket: this.bucketName
        };
        
        this.progress.session.completedFiles++;
    }
    
    printProgressSummary() {
        const uploaded = Object.keys(this.progress.uploadedFiles || {}).length;
        const lastUpdate = this.progress.session?.lastUpdated || 'Never';
        
        console.log('\n' + '='.repeat(70));
        console.log('📊 S3 UPLOAD PROGRESS SUMMARY');
        console.log('='.repeat(70));
        console.log(`📅 Last Updated: ${new Date(lastUpdate).toLocaleString()}`);
        console.log(`🎯 Total Files Uploaded: ${uploaded}`);
        console.log(`📦 S3 Bucket: ${this.bucketName}`);
        console.log(`📁 Source Folder: ${this.sourceFolder}`);
        console.log(`📁 Transferred Folder: ${this.transferredFolder}`);
        console.log('='.repeat(70) + '\n');
    }
    
    async processFiles() {
        const mediaFiles = await this.getMediaFiles();
        
        if (mediaFiles.length === 0) {
            this.log('No media files found in source folder', 'info');
            return;
        }
        
        // Update session info
        this.progress.session.totalFiles = mediaFiles.length;
        this.progress.session.startTime = new Date().toISOString();
        
        // Calculate total size and filter unprocessed files
        const unprocessedFiles = mediaFiles.filter(file => !this.isAlreadyUploaded(file.name, file.path));
        const totalSize = mediaFiles.reduce((sum, file) => sum + file.size, 0);
        const remainingSize = unprocessedFiles.reduce((sum, file) => sum + file.size, 0);
        
        this.log(`Found ${mediaFiles.length} media files (${this.formatFileSize(totalSize)} total)`, 'info');
        this.log(`${unprocessedFiles.length} files remaining to upload (${this.formatFileSize(remainingSize)})`, 'info');
        
        if (unprocessedFiles.length === 0) {
            this.log('All files have already been uploaded!', 'success');
            return;
        }
        
        // Process each file
        for (let i = 0; i < unprocessedFiles.length; i++) {
            const file = unprocessedFiles[i];
            
            try {
                this.log(`\n[${i + 1}/${unprocessedFiles.length}] Processing: ${file.name}`, 'info');
                
                // Skip if already uploaded (double-check)
                if (this.isAlreadyUploaded(file.name, file.path)) {
                    this.log(`Skipping ${file.name} - already uploaded`, 'info');
                    this.sessionStats.skipped++;
                    continue;
                }
                
                // Upload to S3
                const s3Key = `media/${file.name}`; // Customize S3 key structure as needed
                
                if (await this.uploadToS3(file.path, s3Key, file.size)) {
                    // Log the upload
                    this.logUpload(file.name, s3Key, file.size, file.hash);
                    
                    // Move to transferred folder
                    if (await this.moveToTransferred(file.path)) {
                        this.sessionStats.uploaded++;
                        this.sessionStats.uploadedSize += file.size;
                        this.log(`✅ Successfully processed ${file.name}`, 'success');
                    } else {
                        this.log(`⚠️ Uploaded but failed to move ${file.name}`, 'warning');
                        this.sessionStats.failed++;
                    }
                    
                    // Save progress after each successful upload
                    await this.saveProgress();
                } else {
                    this.sessionStats.failed++;
                    this.log(`❌ Failed to upload ${file.name}`, 'error');
                }
                
                // Show progress
                const completed = i + 1;
                const progressPercent = ((completed / unprocessedFiles.length) * 100).toFixed(1);
                this.log(`Progress: ${completed}/${unprocessedFiles.length} (${progressPercent}%)`, 'info');
                
            } catch (error) {
                this.log(`Error processing ${file.name}: ${error.message}`, 'error');
                this.sessionStats.failed++;
            }
        }
        
        // Final summary
        await this.saveProgress();
        this.printSessionSummary();
    }
    
    printSessionSummary() {
        const { uploaded, skipped, failed, uploadedSize } = this.sessionStats;
        const total = uploaded + skipped + failed;
        
        console.log('\n' + '='.repeat(70));
        console.log('🎉 SESSION COMPLETE');
        console.log('='.repeat(70));
        console.log(`✅ Uploaded: ${uploaded} files (${this.formatFileSize(uploadedSize)})`);
        console.log(`⏭️ Skipped: ${skipped} files (already uploaded)`);
        console.log(`❌ Failed: ${failed} files`);
        console.log(`📊 Total processed: ${total} files`);
        console.log(`🗃️ Total files in progress: ${Object.keys(this.progress.uploadedFiles).length}`);
        console.log('='.repeat(70));
    }
    
    showUploadHistory() {
        const uploadedFiles = this.progress.uploadedFiles || {};
        
        if (Object.keys(uploadedFiles).length === 0) {
            console.log('\n📝 No upload history found.');
            return;
        }
        
        console.log(`\n📋 Upload History (${Object.keys(uploadedFiles).length} files):`);
        console.log('-'.repeat(80));
        
        // Group by date
        const filesByDate = {};
        for (const [filename, details] of Object.entries(uploadedFiles)) {
            const uploadDate = details.uploadDate ? details.uploadDate.split('T')[0] : 'Unknown';
            if (!filesByDate[uploadDate]) filesByDate[uploadDate] = [];
            filesByDate[uploadDate].push({ filename, ...details });
        }
        
        // Display grouped by date
        for (const [date, files] of Object.entries(filesByDate)) {
            console.log(`\n📅 ${date} (${files.length} files):`);
            files.forEach(file => {
                const size = this.formatFileSize(file.fileSizeBytes || 0);
                const time = file.uploadDate ? new Date(file.uploadDate).toLocaleTimeString() : 'Unknown';
                console.log(`  ✅ ${file.filename} (${size}) - ${time}`);
            });
        }
        console.log('-'.repeat(80));
    }
    
    log(message, level = 'info') {
        const timestamp = new Date().toISOString();
        const colors = {
            info: '\x1b[36m',    // Cyan
            success: '\x1b[32m', // Green
            warning: '\x1b[33m', // Yellow
            error: '\x1b[31m'    // Red
        };
        const reset = '\x1b[0m';
        
        const color = colors[level] || colors.info;
        console.log(`${color}[${timestamp}] ${level.toUpperCase()}: ${message}${reset}`);
        
        // Also write to log file
        const logEntry = `[${timestamp}] ${level.toUpperCase()}: ${message}\n`;
        try {
            fsSync.appendFileSync(this.logFile, logEntry);
        } catch (error) {
            // Ignore log file write errors
        }
    }
}

async function main() {
    // Configuration - Update these values or set as environment variables
    const BUCKET_NAME = process.env.S3_BUCKET_NAME || 'your-s3-bucket-name';
    const SOURCE_FOLDER = process.env.SOURCE_FOLDER || './merged';
    const TRANSFERRED_FOLDER = process.env.TRANSFERRED_FOLDER || './uploaded_to_s3';
    const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
    
    // Validate configuration
    if (BUCKET_NAME === 'your-s3-bucket-name') {
        console.error('❌ Please set S3_BUCKET_NAME environment variable or update the script');
        console.error('Example: export S3_BUCKET_NAME=my-media-bucket');
        process.exit(1);
    }
    
    // Print configuration (without sensitive data)
    console.log('🔧 Configuration:');
    console.log(`  S3 Bucket: ${BUCKET_NAME}`);
    console.log(`  Source Folder: ${SOURCE_FOLDER}`);
    console.log(`  Transferred Folder: ${TRANSFERRED_FOLDER}`);
    console.log(`  AWS Region: ${AWS_REGION}`);
    console.log(`  AWS Access Key ID: ${process.env.AWS_ACCESS_KEY_ID ? '✓ Set' : '✗ Not set'}`);
    console.log(`  AWS Secret Access Key: ${process.env.AWS_SECRET_ACCESS_KEY ? '✓ Set' : '✗ Not set'}`);
    console.log();
    
    try {
        // Create uploader instance
        const uploader = new S3MediaUploader(
            BUCKET_NAME,
            SOURCE_FOLDER,
            TRANSFERRED_FOLDER,
            AWS_REGION
        );
        
        // Initialize the uploader
        await uploader.init();
        
        // Show current progress and history
        uploader.printProgressSummary();
        uploader.showUploadHistory();
        
        // Process files
        await uploader.processFiles();
        
    } catch (error) {
        console.error(`\n❌ Error: ${error.message}`);
        if (error.stack) {
            console.error('Stack trace:', error.stack);
        }
        process.exit(1);
    }
}

// Handle interruption gracefully
process.on('SIGINT', async () => {
    console.log('\n⚡ Upload interrupted by user');
    console.log('💾 Progress has been saved automatically');
    console.log('🔄 You can resume by running the script again');
    process.exit(0);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('\n💥 Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

// Run if this file is executed directly
if (require.main === module) {
    main();
}

module.exports = S3MediaUploader;