// setup-cookies.js
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log('🍪 YouTube Cookie Setup');
console.log('='.repeat(50));
console.log('To avoid bot detection, you need to provide cookies.');
console.log('\nOption 1: Export cookies from browser:');
console.log('  1. Install "Get cookies.txt LOCALLY" extension');
console.log('  2. Go to YouTube and log in');
console.log('  3. Export cookies and save as cookies.txt');
console.log('\nOption 2: Use browser cookies directly:');
console.log('  Your code will automatically use Chrome cookies');

rl.question('\nHave you exported cookies.txt to the project folder? (y/n): ', (answer) => {
  if (answer.toLowerCase() === 'y') {
    const cookiePath = path.join(__dirname, 'cookies.txt');
    if (fs.existsSync(cookiePath)) {
      console.log('✅ cookies.txt found!');
    } else {
      console.log('❌ cookies.txt not found in project folder');
    }
  }
  
  console.log('\nTo use Chrome cookies directly, ensure:');
  console.log('1. Chrome is installed');
  console.log('2. You are logged into YouTube in Chrome');
  console.log('3. Chrome is not running while downloading');
  
  rl.close();
});