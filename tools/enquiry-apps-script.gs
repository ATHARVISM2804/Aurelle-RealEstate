/* Google Sheet as the lead inbox.
   1. Create a Google Sheet, then Extensions → Apps Script, paste this file, save.
   2. Deploy → New deployment → Web app: execute as "Me", access "Anyone". Copy the web-app URL.
   3. In Vercel → Project → Settings → Environment Variables, set SHEET_WEBHOOK_URL to that URL. */
const FIELDS = ['at', 'type', 'name', 'phone', 'email', 'unit', 'budget', 'contact', 'message', 'page', 'utm_source', 'utm_medium', 'utm_campaign'];
function doPost(e) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  if (sheet.getLastRow() === 0) sheet.appendRow(FIELDS);
  const d = JSON.parse(e.postData.contents);
  sheet.appendRow(FIELDS.map((k) => d[k] || ''));
  return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
}
