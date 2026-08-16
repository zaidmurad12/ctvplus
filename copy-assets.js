import fs from 'fs';
import path from 'path';

const distDir = path.join(process.cwd(), 'dist');
const rootAssetsDir = path.join(process.cwd(), 'assets');
const themeAssetsDir = path.join(process.cwd(), 'wordpress-theme-cinemana', 'assets');
const androidAssetsDir = path.join(process.cwd(), 'android', 'app', 'src', 'main', 'assets');

// Ensure directories exist
[rootAssetsDir, themeAssetsDir, androidAssetsDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

function copyRecursiveSync(src, dest) {
  const exists = fs.existsSync(src);
  const stats = exists && fs.statSync(src);
  const isDirectory = exists && stats.isDirectory();
  if (isDirectory) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    fs.readdirSync(src).forEach(childItemName => {
      copyRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName));
    });
  } else if (exists) {
    fs.copyFileSync(src, dest);
  }
}

function processHtmlFile(htmlPath) {
  if (fs.existsSync(htmlPath)) {
    let htmlContent = fs.readFileSync(htmlPath, 'utf8');
    
    // Remove crossorigin attributes which cause CORS restrictions in WebViews/file protocol
    htmlContent = htmlContent.replace(/\s*crossorigin(=("[^"]*"|'[^']*'|[^\s>]+))?/g, '');
    
    // Normalize asset paths to relative ./assets/
    htmlContent = htmlContent.replace(/src="\/assets\//g, 'src="./assets/');
    htmlContent = htmlContent.replace(/href="\/assets\//g, 'href="./assets/');

    // Remove type="module" and defer tags for synchronous IIFE execution
    htmlContent = htmlContent.replace(/type="module"/g, '');
    htmlContent = htmlContent.replace(/\s+defer/g, '');

    // Ensure standard script tag is placed at end of body for reliable DOM mounting
    htmlContent = htmlContent.replace(/<script\s+[^>]*src=["']\.\/assets\/index\.js["'][^>]*><\/script>/gi, '');
    if (!htmlContent.includes('./assets/index.js')) {
      htmlContent = htmlContent.replace('</body>', '  <script src="./assets/index.js"></script>\n</body>');
    }

    // Inject explicit CSS resets directly into head so screen height never collapses to 0
    const inlineStyle = `<style>html, body { width: 100% !important; height: 100% !important; min-height: 100% !important; margin: 0 !important; padding: 0 !important; background-color: #090b11 !important; color: #f8fafc !important; overflow: hidden !important; } #root { width: 100% !important; height: 100% !important; min-height: 100% !important; background-color: #090b11 !important; overflow: hidden !important; display: flex !important; flex-direction: column !important; }</style>`;
    if (!htmlContent.includes('background-color: #090b11 !important')) {
      htmlContent = htmlContent.replace('</head>', `${inlineStyle}\n</head>`);
    }
    
    // Ensure body tag has explicit dark background style
    if (htmlContent.includes('<body>')) {
      htmlContent = htmlContent.replace('<body>', '<body style="background-color: #090b11; margin: 0; padding: 0; overflow: hidden; width: 100%; height: 100%;">');
    }
    
    fs.writeFileSync(htmlPath, htmlContent, 'utf8');
    console.log(`Processed ${htmlPath} with dark body style and IIFE execution for full Android TV & Emulator compatibility.`);
  }
}

try {
  const distAssetsDir = path.join(distDir, 'assets');
  if (fs.existsSync(distAssetsDir)) {
    const files = fs.readdirSync(distAssetsDir);
    const jsFile = files.find(f => f.endsWith('.js'));
    const cssFile = files.find(f => f.endsWith('.css'));

    if (jsFile) {
      fs.copyFileSync(path.join(distAssetsDir, jsFile), path.join(rootAssetsDir, 'index.js'));
      fs.copyFileSync(path.join(distAssetsDir, jsFile), path.join(themeAssetsDir, 'index.js'));
      fs.copyFileSync(path.join(distAssetsDir, jsFile), path.join(androidAssetsDir, 'index.js'));
      console.log(`Copied JS asset (${jsFile}) to theme, root, and android assets directories as index.js.`);
    }

    if (cssFile) {
      fs.copyFileSync(path.join(distAssetsDir, cssFile), path.join(rootAssetsDir, 'index.css'));
      fs.copyFileSync(path.join(distAssetsDir, cssFile), path.join(themeAssetsDir, 'index.css'));
      fs.copyFileSync(path.join(distAssetsDir, cssFile), path.join(androidAssetsDir, 'index.css'));
      console.log(`Copied CSS asset (${cssFile}) to theme, root, and android assets directories as index.css.`);
    }
  }

  // Process dist/index.html
  processHtmlFile(path.join(distDir, 'index.html'));

  // Copy movies_db.json or public/movies.json to public, dist, and android assets for local offline fallback
  const moviesDbSrc = fs.existsSync(path.join(process.cwd(), 'movies_db.json')) 
    ? path.join(process.cwd(), 'movies_db.json') 
    : (fs.existsSync(path.join(process.cwd(), 'public', 'movies.json')) ? path.join(process.cwd(), 'public', 'movies.json') : null);
  
  if (moviesDbSrc) {
    const publicDir = path.join(process.cwd(), 'public');
    if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });
    if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });
    fs.copyFileSync(moviesDbSrc, path.join(publicDir, 'movies.json'));
    fs.copyFileSync(moviesDbSrc, path.join(distDir, 'movies.json'));
    fs.copyFileSync(moviesDbSrc, path.join(androidAssetsDir, 'movies.json'));
    console.log('Copied movies dataset to public, dist, and android/app/src/main/assets as movies.json.');
  }

  // Copy full dist output to Android assets for standalone Android Studio APK build
  if (fs.existsSync(distDir)) {
    copyRecursiveSync(distDir, androidAssetsDir);
    processHtmlFile(path.join(androidAssetsDir, 'index.html'));
    console.log('Successfully bundled web distribution assets into Android Studio app/src/main/assets directory.');
  }

  console.log('Assets build & export process completed successfully!');
} catch (error) {
  console.error('Error during asset copying:', error);
  process.exit(1);
}
