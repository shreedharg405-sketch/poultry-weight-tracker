const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const distDir = path.resolve(__dirname, '..', 'frontend', 'dist');
if (!fs.existsSync(distDir)) {
  console.error('Dist directory does not exist. Run npm run build in frontend first.');
  process.exit(1);
}

const tempDir = path.join(os.tmpdir(), 'poultry-gh-pages-' + Date.now());
fs.mkdirSync(tempDir, { recursive: true });

function copyRecursive(src, dest) {
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

console.log('Copying frontend/dist to temp directory...');
copyRecursive(distDir, tempDir);

// Add a 404.html clone of index.html for SPA routing on GitHub Pages
fs.copyFileSync(path.join(tempDir, 'index.html'), path.join(tempDir, '404.html'));

console.log('Initializing git in temp directory...');
const run = (cmd) => execSync(cmd, { cwd: tempDir, stdio: 'inherit' });

run('git config user.name "Avisync CI"');
run('git config user.email "bot@avisync.local"');
run('git add .');
run('git commit -m "deploy: live production deployment to GitHub Pages"');
run('git remote add origin https://github.com/shreedharg405-sketch/poultry-weight-tracker.git');

console.log('Pushing to gh-pages branch...');
run('git push -f origin gh-pages');

console.log('Cleaning up temp directory...');
fs.rmSync(tempDir, { recursive: true, force: true });
console.log('🎉 GitHub Pages deployment complete!');
