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

// Function to extract base name by removing the _video or _audio suffix
function getBaseName(filename) {
    // Remove extension first
    const nameWithoutExt = path.basename(filename, path.extname(filename));
    
    // Remove _video or _audio suffix if present
    if (nameWithoutExt.endsWith('_video')) {
        return nameWithoutExt.slice(0, -6); // Remove "_video"
    } else if (nameWithoutExt.endsWith('_audio')) {
        return nameWithoutExt.slice(0, -6); // Remove "_audio"
    }
    
    // If no suffix, return the name as is
    return nameWithoutExt;
}

// Function to find matching video and audio files
function findMatchingPairs(files) {
    const pairs = [];
    const fileMap = {};
    
    // Group files by their base name
    files.forEach(file => {
        const baseName = getBaseName(file);
        const ext = path.extname(file).toLowerCase();
        
        if (!fileMap[baseName]) {
            fileMap[baseName] = { video: null, audio: null };
        }
        
        if (VIDEO_EXTENSIONS.includes(ext)) {
            fileMap[baseName].video = file;
        } else if (AUDIO_EXTENSIONS.includes(ext)) {
            fileMap[baseName].audio = file;
        }
    });
    
    // Create pairs for entries that have both video and audio
    for (const baseName in fileMap) {
        if (fileMap[baseName].video && fileMap[baseName].audio) {
            pairs.push({
                baseName,
                video: fileMap[baseName].video,
                audio: fileMap[baseName].audio,
                output: `${baseName}_merged.mp4`
            });
        }
    }
    
    return pairs;
}

// Function to merge video and audio using FFmpeg
function mergeVideoAudio(videoPath, audioPath, outputPath) {
    return new Promise((resolve, reject) => {
        const command = `ffmpeg -i "${videoPath}" -i "${audioPath}" -c:v copy -c:a aac -map 0:v:0 -map 1:a:0 "${outputPath}" -y`;
        
        console.log(`Merging: ${path.basename(videoPath)} + ${path.basename(audioPath)}`);
        console.log(`Command: ${command}`);
        
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
        
        // Find matching pairs
        const pairs = findMatchingPairs(allFiles);
        
        console.log(`Found ${pairs.length} matching video/audio pairs to merge`);
        
        if (pairs.length === 0) {
            console.log('No matching video/audio pairs found.');
            console.log('Files in directory:');
            allFiles.forEach(file => console.log(`  - ${file} (base: ${getBaseName(file)})`));
            return;
        }
        
        // Process each pair
        for (const pair of pairs) {
            const videoPath = path.join(INPUT_FOLDER, pair.video);
            const audioPath = path.join(INPUT_FOLDER, pair.audio);
            const outputPath = path.join(OUTPUT_FOLDER, pair.output);
            
            console.log(`Processing: ${pair.baseName}`);
            console.log(`  Video: ${pair.video}`);
            console.log(`  Audio: ${pair.audio}`);
            
            await mergeVideoAudio(videoPath, audioPath, outputPath);
        }
        
        console.log('\nAll files processed successfully!');
        console.log(`Merged videos are saved in: ${path.resolve(OUTPUT_FOLDER)}`);
        
    } catch (error) {
        console.error('Error processing folder:', error);
    }
}

// Run the script
processFolder();