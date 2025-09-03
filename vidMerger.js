const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

// Configuration
const INPUT_FOLDER = './downloads'; // Change this to your source folder
const OUTPUT_FOLDER = './merged'; // Change this to your output folder
const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v'];
const AUDIO_EXTENSIONS = ['.m4a', '.mp3', '.aac', '.wav', '.webm'];

// Create output directory if it doesn't exist
if (!fs.existsSync(OUTPUT_FOLDER)) {
    fs.mkdirSync(OUTPUT_FOLDER, { recursive: true });
}

// Function to clean and normalize filename for matching
function cleanFilename(filename) {
    // Remove extension
    const nameWithoutExt = path.basename(filename, path.extname(filename));
    
    // Remove common suffixes (case insensitive)
    let cleanName = nameWithoutExt
        .replace(/_video$/i, '')
        .replace(/_audio$/i, '')
        .replace(/video$/i, '')
        .replace(/audio$/i, '')
        .trim();
    
    // Remove trailing underscores and spaces
    cleanName = cleanName.replace(/[_\s]+$/, '');
    
    return cleanName;
}

// Function to generate progressive search terms
function generateSearchTerms(cleanName) {
    const terms = [cleanName]; // Start with full clean name
    
    // Split by common delimiters and create progressively shorter terms
    const delimiters = ['_', '-', ' ', '__', '--'];
    
    for (const delimiter of delimiters) {
        if (cleanName.includes(delimiter)) {
            const parts = cleanName.split(delimiter);
            
            // Create terms by removing parts from the end
            for (let i = parts.length - 1; i >= 1; i--) {
                const term = parts.slice(0, i).join(delimiter).trim();
                if (term.length > 3 && !terms.includes(term)) { // Minimum length check
                    terms.push(term);
                }
            }
            break; // Use the first delimiter that matches
        }
    }
    
    return terms;
}

// Function to check if output file already exists and is valid
function isAlreadyMerged(outputPath) {
    if (!fs.existsSync(outputPath)) {
        return false;
    }
    
    // Check if file size is greater than 0 (basic validation)
    const stats = fs.statSync(outputPath);
    if (stats.size === 0) {
        console.log(`Warning: ${path.basename(outputPath)} exists but is empty. Will re-process.`);
        return false;
    }
    
    return true;
}

// Function to find matching video and audio files using progressive matching
function findMatchingPairs(files) {
    const pairs = [];
    const videoFiles = [];
    const audioFiles = [];
    const usedFiles = new Set();
    
    // Separate video and audio files
    files.forEach(file => {
        const ext = path.extname(file).toLowerCase();
        const fileInfo = {
            filename: file,
            cleanName: cleanFilename(file),
            searchTerms: generateSearchTerms(cleanFilename(file))
        };
        
        if (VIDEO_EXTENSIONS.includes(ext)) {
            videoFiles.push(fileInfo);
        } else if (AUDIO_EXTENSIONS.includes(ext)) {
            audioFiles.push(fileInfo);
        }
    });
    
    console.log(`\nFound ${videoFiles.length} video files and ${audioFiles.length} audio files`);
    
    // Find matches using progressive search
    videoFiles.forEach((videoFile, videoIndex) => {
        if (usedFiles.has(videoFile.filename)) return;
        
        let bestMatch = null;
        let matchLevel = -1;
        
        // Try each search term for this video file
        videoFile.searchTerms.forEach((videoTerm, termIndex) => {
            if (bestMatch) return; // Already found a match
            
            audioFiles.forEach(audioFile => {
                if (usedFiles.has(audioFile.filename)) return;
                
                // Check if any of the audio file's search terms match this video term
                audioFile.searchTerms.forEach((audioTerm, audioTermIndex) => {
                    if (videoTerm === audioTerm) {
                        // Prefer exact matches (earlier in search terms array)
                        const currentMatchLevel = termIndex + audioTermIndex;
                        if (!bestMatch || currentMatchLevel < matchLevel) {
                            bestMatch = audioFile;
                            matchLevel = currentMatchLevel;
                        }
                    }
                });
            });
        });
        
        if (bestMatch) {
            // Create a safe filename for output
            const baseName = videoFile.cleanName
                .replace(/[<>:"/\\|?*]/g, '_') // Replace invalid characters
                .replace(/\s+/g, '_') // Replace spaces with underscores
                .replace(/_+/g, '_') // Remove multiple consecutive underscores
                .replace(/^_|_$/g, ''); // Remove leading/trailing underscores
            
            const outputPath = path.join(OUTPUT_FOLDER, `${baseName}_merged.mp4`);
            
            pairs.push({
                baseName: baseName,
                video: videoFile.filename,
                audio: bestMatch.filename,
                output: `${baseName}_merged.mp4`,
                outputPath: outputPath,
                alreadyExists: isAlreadyMerged(outputPath),
                matchLevel: matchLevel,
                videoCleanName: videoFile.cleanName,
                audioCleanName: bestMatch.cleanName
            });
            
            // Mark files as used
            usedFiles.add(videoFile.filename);
            usedFiles.add(bestMatch.filename);
            
            console.log(`✓ Match found: "${videoFile.cleanName}" <-> "${bestMatch.cleanName}" (level ${matchLevel})`);
        } else {
            console.log(`✗ No match found for video: "${videoFile.filename}"`);
        }
    });
    
    // Report unmatched files
    const unusedVideos = videoFiles.filter(v => !usedFiles.has(v.filename));
    const unusedAudios = audioFiles.filter(a => !usedFiles.has(a.filename));
    
    if (unusedVideos.length > 0) {
        console.log(`\nUnmatched video files (${unusedVideos.length}):`);
        unusedVideos.forEach(v => console.log(`  - ${v.filename}`));
    }
    
    if (unusedAudios.length > 0) {
        console.log(`\nUnmatched audio files (${unusedAudios.length}):`);
        unusedAudios.forEach(a => console.log(`  - ${a.filename}`));
    }
    
    return pairs;
}

// Function to merge video and audio using FFmpeg
function mergeVideoAudio(videoPath, audioPath, outputPath) {
    return new Promise((resolve, reject) => {
        const command = `ffmpeg -i "${videoPath}" -i "${audioPath}" -c:v copy -c:a aac -map 0:v:0 -map 1:a:0 "${outputPath}" -y`;
        
        console.log(`Merging: ${path.basename(videoPath)} + ${path.basename(audioPath)}`);
        
        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error(`Error merging ${path.basename(videoPath)}:`, error);
                reject(error);
            } else {
                console.log(`Successfully merged: ${path.basename(outputPath)}`);
                resolve();
            }
        });
    });
}

// Main function
async function processFolder() {
    try {
        console.log('Scanning folder for video and audio files...');
        
        // Read all files from input directory
        const allFiles = fs.readdirSync(INPUT_FOLDER);
        
        console.log(`Found ${allFiles.length} files total`);
        
        // Find matching pairs using smart matching
        const pairs = findMatchingPairs(allFiles);
        
        console.log(`\n=== MATCHING SUMMARY ===`);
        console.log(`Found ${pairs.length} matching video/audio pairs`);
        
        if (pairs.length === 0) {
            console.log('No matching video/audio pairs found.');
            return;
        }
        
        // Show detailed match information
        console.log('\nDetailed matches:');
        pairs.forEach((pair, index) => {
            console.log(`${index + 1}. "${pair.baseName}"`);
            console.log(`   Video: ${pair.video}`);
            console.log(`   Audio: ${pair.audio}`);
            console.log(`   Output: ${pair.output}`);
            console.log(`   Status: ${pair.alreadyExists ? '✓ Already merged' : '⏳ Pending'}`);
            console.log('');
        });
        
        // Separate already processed and pending pairs
        const alreadyProcessed = pairs.filter(pair => pair.alreadyExists);
        const pendingPairs = pairs.filter(pair => !pair.alreadyExists);
        
        console.log(`\n=== PROCESSING STATUS ===`);
        console.log(`Total matches: ${pairs.length}`);
        console.log(`Already merged: ${alreadyProcessed.length}`);
        console.log(`Pending merge: ${pendingPairs.length}`);
        
        // Process pending pairs only
        if (pendingPairs.length === 0) {
            console.log('\nAll matched files are already merged. Nothing to do!');
            return;
        }
        
        console.log(`\n=== PROCESSING ${pendingPairs.length} PENDING PAIRS ===`);
        
        let processed = 0;
        for (const pair of pendingPairs) {
            const videoPath = path.join(INPUT_FOLDER, pair.video);
            const audioPath = path.join(INPUT_FOLDER, pair.audio);
            const outputPath = pair.outputPath;
            
            console.log(`\n[${processed + 1}/${pendingPairs.length}] Processing: ${pair.baseName}`);
            console.log(`  Video: ${pair.video}`);
            console.log(`  Audio: ${pair.audio}`);
            
            try {
                await mergeVideoAudio(videoPath, audioPath, outputPath);
                processed++;
                console.log(`  ✓ Completed (${processed}/${pendingPairs.length})`);
            } catch (error) {
                console.error(`  ✗ Failed to merge ${pair.baseName}:`, error.message);
                console.log(`  Continuing with remaining files...`);
            }
        }
        
        console.log(`\n=== FINAL SUMMARY ===`);
        console.log(`Total pairs found: ${pairs.length}`);
        console.log(`Already merged: ${alreadyProcessed.length}`);
        console.log(`Newly processed: ${processed}`);
        console.log(`Failed: ${pendingPairs.length - processed}`);
        console.log(`Merged videos are saved in: ${path.resolve(OUTPUT_FOLDER)}`);
        
    } catch (error) {
        console.error('Error processing folder:', error);
    }
}

// Run the script
processFolder();