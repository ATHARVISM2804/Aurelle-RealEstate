// Prints tools/brochure/brochure.html to assets/brochure/Aurelle-Residence-Brochure.pdf
// usage (with tools/serve.py running): node tools/brochure/make-brochure.cjs [path/to/playwright]
const { chromium } = require(process.argv[2] || 'playwright');
const path = require('path');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.goto('http://127.0.0.1:8790/tools/brochure/brochure.html', { waitUntil: 'networkidle' });
  await p.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map((i) => i.decode().catch(() => {}))); });
  const out = path.join(__dirname, '../../assets/brochure/Aurelle-Residence-Brochure.pdf');
  require('fs').mkdirSync(path.dirname(out), { recursive: true });
  const raw = out.replace('.pdf', '.raw.pdf');
  await p.pdf({ path: raw, width: '297mm', height: '210mm', printBackground: true, preferCSSPageSize: true });
  // Chrome stores WebP images losslessly; Ghostscript re-encodes them as print-quality JPEG (~4 MB instead of ~75 MB)
  require('child_process').execFileSync('gs', ['-q', '-dNOPAUSE', '-dBATCH', '-dSAFER', '-sDEVICE=pdfwrite', '-dCompatibilityLevel=1.6',
    '-dDownsampleColorImages=true', '-dColorImageDownsampleType=/Bicubic', '-dColorImageResolution=200', '-dAutoFilterColorImages=false',
    '-dColorImageFilter=/DCTEncode', '-dJPEGQ=86', '-sOutputFile=' + out, raw]);
  require('fs').unlinkSync(raw);
  console.log('wrote', out);
  await b.close();
})();
