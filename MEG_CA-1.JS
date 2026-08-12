/**
 * MEG Editorial Calendar Generator — Google Apps Script Backend
 * ─────────────────────────────────────────────────────────────
 * SETUP INSTRUCTIONS (do this once, then never touch it again):
 *
 * STEP 1 — Add your Claude API key:
 *   In this editor, click Extensions → Apps Script (if not already here)
 *   Click the gear icon ⚙ (Project Settings) in the left sidebar
 *   Scroll to "Script Properties" → click "Add script property"
 *   Property name:  CLAUDE_API_KEY
 *   Value:          your API key (starts with sk-ant-)
 *   Click Save
 *
 * STEP 1.5 — Enable the Drive API advanced service (required for .docx/.xlsx support):
 *   In the Apps Script editor, click "Services" (+) in the left sidebar
 *   Find "Drive API" in the list and select it
 *   IMPORTANT: in the version dropdown, choose "v2" (not v3) — this script
 *   uses the v2 Files.insert(..., {convert:true}) pattern
 *   Click "Add"
 *   Without this step, any file that isn't already a native Google Doc or
 *   Sheet (e.g. a .docx or .xlsx sitting in Drive) will fail to fetch with a
 *   clear "Drive API is not enabled" error telling you to come back here.
 *
 * STEP 2 — Deploy as a Web App:
 *   Click Deploy → New deployment
 *   Type: Web app
 *   Description: MEG Calendar Generator v3
 *   Execute as: Me
 *   Who has access: Anyone within [your MEG Google Workspace domain]
 *   Click Deploy → copy the Web App URL
 *
 * STEP 3 — Paste the URL into the tool:
 *   Open index.html
 *   Find the line:  const BACKEND_URL = '...';
 *   Replace with your deployed URL if it changed
 *   Save the file
 *
 * STEP 4 — Host the HTML file:
 *   Upload index.html to a Google Site, Vercel, or share it from Google Drive
 *   Your team bookmarks the link — done.
 *
 * That's it. The API key never leaves Google's servers.
 * ─────────────────────────────────────────────────────────────
 *
 * CHANGELOG (this version):
 * - model bumped from claude-sonnet-4-20250514 (deprecated) to claude-sonnet-5.
 * - max_tokens raised from 8000 to 16000. The old 8000 cap was the main cause
 *   of calendars silently cutting off mid-month: a full month of posts with
 *   descriptions, hooks, and CTAs routinely runs past 8000 output tokens, and
 *   the frontend's JSON repair step would then quietly truncate the array
 *   instead of erroring, which is what made August "disappear."
 * - callClaude() now checks response.stop_reason and throws a clear error if
 *   the model was cut off by the token limit, instead of returning a
 *   truncated JSON string as if it were a complete, valid response.
 * - fetchDoc now auto-converts Word (.docx) and Excel (.xlsx) files sitting in
 *   Drive into native Google Docs/Sheets format on the fly before reading
 *   them. Previously, a strategy doc that was a real Word file (not a native
 *   Google Doc) would fail with a confusing "document is inaccessible" error
 *   even when sharing was set correctly — DocumentApp/SpreadsheetApp can only
 *   open native Google Workspace files, not Office files, regardless of
 *   sharing settings. This requires the Drive API advanced service (Step 1.5
 *   above) — without it, the tool now fails with an explicit setup message
 *   instead of the confusing "inaccessible" one.
 * ─────────────────────────────────────────────────────────────
 */


// ── CORS HANDLER (required for browser fetch calls) ──────────────────────────

function doOptions(e) {
  return ContentService.createTextOutput('')
    .setMimeType(ContentService.MimeType.TEXT);
}

// ── MAIN HANDLER ─────────────────────────────────────────────────────────────

function doPost(e) {
  const output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);

  try {
    const raw = e.postData ? e.postData.contents : '{}';
    const payload = JSON.parse(raw);
    const action  = payload.action || 'generate';

    // ── ACTION: Fetch a Google Doc as plain text ──────────────────────────────
    if (action === 'fetchDoc') {
      const docId   = payload.docId;
      const docType = payload.docType || 'doc';
      if (!docId) {
        output.setContent(JSON.stringify({ error: 'No document ID provided.' }));
        return output;
      }
      try {
        let text = '';
        if (docType === 'sheet') {
          text = readAsSheetText(docId);
        } else {
          text = readAsDocText(docId);
        }
        if (!text || text.trim().length < 10) {
          output.setContent(JSON.stringify({ error: 'Document appears empty or could not be read.' }));
        } else {
          output.setContent(JSON.stringify({ content: text.trim() }));
        }
      } catch(docErr) {
        output.setContent(JSON.stringify({ error: docErr.message }));
      }
      return output;
    }

    // ── ACTION: Generate calendar via Claude ──────────────────────────────────
    const systemPrompt = payload.system;
    const userMessage  = payload.user;

    if (!systemPrompt || !userMessage) {
      output.setContent(JSON.stringify({ error: 'Missing system or user prompt in request.' }));
      return output;
    }

    const apiKey = PropertiesService.getScriptProperties().getProperty('CLAUDE_API_KEY');

    if (!apiKey) {
      output.setContent(JSON.stringify({
        error: 'Claude API key not found. Admin: add CLAUDE_API_KEY to Script Properties.'
      }));
      return output;
    }

    const claudeResponse = callClaude(apiKey, systemPrompt, userMessage);
    output.setContent(JSON.stringify({ content: claudeResponse }));
    return output;

  } catch (err) {
    output.setContent(JSON.stringify({ error: 'Server error: ' + err.message }));
    return output;
  }
}


// ── GET HANDLER (health check) ────────────────────────────────────────────────

function doGet(e) {
  const output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);
  output.setContent(JSON.stringify({
    status: 'MEG Editorial Calendar Generator backend is running.',
    timestamp: new Date().toISOString()
  }));
  return output;
}


// ── FILE READING (with auto-convert for Word/Excel files in Drive) ───────────
// DocumentApp and SpreadsheetApp can only open native Google Workspace files.
// A .docx or .xlsx file sitting in Drive uses the exact same URL shape
// (docs.google.com/document/d/... or /spreadsheets/d/...) and opens fine for
// a human in the browser, but DocumentApp.openById()/SpreadsheetApp.openById()
// will throw on it regardless of sharing settings, because it isn't actually
// a Google Doc/Sheet under the hood. When that happens, we make one converted
// copy of the file in native format, read that instead, then delete the copy.

function readAsDocText(fileId) {
  try {
    const doc = DocumentApp.openById(fileId);
    return doc.getBody().getText();
  } catch (nativeErr) {
    const convertedId = convertToGoogleFormat(fileId, MimeType.GOOGLE_DOCS, nativeErr);
    try {
      const doc = DocumentApp.openById(convertedId);
      return doc.getBody().getText();
    } finally {
      cleanupTempFile(convertedId);
    }
  }
}

function readAsSheetText(fileId) {
  let ss;
  try {
    ss = SpreadsheetApp.openById(fileId);
    return extractSheetText(ss);
  } catch (nativeErr) {
    const convertedId = convertToGoogleFormat(fileId, MimeType.GOOGLE_SHEETS, nativeErr);
    try {
      ss = SpreadsheetApp.openById(convertedId);
      return extractSheetText(ss);
    } finally {
      cleanupTempFile(convertedId);
    }
  }
}

function extractSheetText(ss) {
  const sheets = ss.getSheets();
  const lines  = [];
  sheets.forEach(function(sheet) {
    const data = sheet.getDataRange().getValues();
    data.forEach(function(row) {
      const clean = row.filter(function(c){ return c !== null && c !== ''; });
      if (clean.length > 0) lines.push(clean.join(' | '));
    });
  });
  return lines.join('\n');
}

// Makes a converted copy of fileId in the target native Google format
// (Docs or Sheets) using the Drive API v2 advanced service, and returns the
// new file's ID. Throws a clear, specific error if the Drive API service
// hasn't been enabled yet, or if the source file truly isn't accessible.
function convertToGoogleFormat(fileId, targetMimeType, originalErr) {
  if (typeof Drive === 'undefined') {
    throw new Error('This file could not be opened as a native Google Doc/Sheet (it may be a Word or Excel file), and the Drive API advanced service isn\'t enabled yet, so it can\'t be auto-converted. In the Apps Script editor: Services (+) → Drive API → choose version "v2" → Add. Then try again. Original error: ' + originalErr.message);
  }
  let sourceBlob;
  try {
    sourceBlob = DriveApp.getFileById(fileId).getBlob();
  } catch (accessErr) {
    throw new Error('Could not open this file at all. Make sure sharing is set to "Anyone with the link can view". Error: ' + accessErr.message);
  }
  try {
    const resource = {
      title: 'MEG_TEMP_CONVERSION_' + fileId,
      mimeType: targetMimeType
    };
    const converted = Drive.Files.insert(resource, sourceBlob, { convert: true });
    return converted.id;
  } catch (convertErr) {
    throw new Error('Found the file but could not convert it to a native Google format. It may not be a supported Word/Excel file. Error: ' + convertErr.message);
  }
}

function cleanupTempFile(fileId) {
  try {
    DriveApp.getFileById(fileId).setTrashed(true);
  } catch (cleanupErr) {
    // Non-fatal — a stray temp file in Drive trash isn't worth failing the request over.
    Logger.log('Could not clean up temp conversion file ' + fileId + ': ' + cleanupErr.message);
  }
}


// ── CLAUDE API CALL ───────────────────────────────────────────────────────────

function callClaude(apiKey, systemPrompt, userMessage) {
  const url = 'https://api.anthropic.com/v1/messages';

  const requestBody = {
    model: 'claude-sonnet-5',
    // FIX: was 8000. A full month of posts (descriptions + hooks + CTAs for
    // ~15-20 items) can exceed that, and the old fallback JSON repair on the
    // frontend would silently drop everything after the cutoff. Sonnet 5
    // supports up to 128k output tokens on the standard Messages API, so
    // 16000 leaves a wide safety margin without meaningfully slowing down a
    // single month's generation.
    max_tokens: 16000,
    system: systemPrompt,
    messages: [
      { role: 'user', content: userMessage }
    ]
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    payload: JSON.stringify(requestBody),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  const responseCode = response.getResponseCode();
  const responseText = response.getContentText();

  if (responseCode !== 200) {
    let errorMsg = 'Claude API error ' + responseCode;
    try {
      const errorData = JSON.parse(responseText);
      errorMsg = errorData.error?.message || errorMsg;
    } catch(e) {}
    throw new Error(errorMsg);
  }

  const data = JSON.parse(responseText);

  // FIX: previously this only checked whether content existed, so a response
  // that got cut off mid-item (stop_reason "max_tokens") was returned to the
  // frontend as if it were complete. The frontend's JSON repair step would
  // then quietly truncate to the last whole item with no explanation — this
  // is the main reason a whole month used to look "incomplete" with no error
  // anywhere. Now a truncated response throws a clear, specific error instead.
  if (data.stop_reason === 'max_tokens') {
    throw new Error('Claude response was cut off at the max_tokens limit before finishing this month. Try again, or reduce the deliverables per month (fewer videos/graphics/emails/blogs) and regenerate.');
  }

  // Extract the text content from Claude's response
  if (data.content && data.content[0] && data.content[0].text) {
    return data.content[0].text;
  }

  throw new Error('Unexpected response format from Claude API.');
}


// ── TEST FUNCTION (run manually to verify setup) ──────────────────────────────
// Tests both Claude API connection AND Google Doc access
// In the Apps Script editor, select this function from the dropdown and click Run
// Check the Execution log to confirm your API key is working

function testClaudeConnection() {
  const apiKey = PropertiesService.getScriptProperties().getProperty('CLAUDE_API_KEY');

  if (!apiKey) {
    Logger.log('❌ CLAUDE_API_KEY not found in Script Properties. See setup instructions.');
    return;
  }

  Logger.log('✓ API key found. Testing connection to Claude...');

  try {
    const result = callClaude(
      apiKey,
      'You are a helpful assistant. Return only valid JSON.',
      'Return this exact JSON: {"status": "connected", "model": "claude-sonnet-5"}'
    );
    Logger.log('✓ Claude API connected successfully.');
    Logger.log('Response: ' + result);
  } catch(err) {
    Logger.log('❌ Claude API error: ' + err.message);
    Logger.log('Check: is your API key correct? Is billing active at console.anthropic.com?');
  }
}

// ── TEST FUNCTION: Drive API / .docx conversion setup ─────────────────────────
// Run this after enabling the Drive API advanced service (Step 1.5) to confirm
// it's wired up correctly, before relying on it for a real client strategy doc.

function testDriveConversionSetup() {
  if (typeof Drive === 'undefined') {
    Logger.log('❌ Drive API advanced service is not enabled. In this editor: Services (+) → Drive API → version "v2" → Add.');
    return;
  }
  Logger.log('✓ Drive API advanced service is enabled (Drive object is available).');
  Logger.log('To fully test conversion, share a real .docx file\'s ID here and call convertToGoogleFormat(fileId, MimeType.GOOGLE_DOCS, new Error("manual test")) — if it returns a file ID with no error, conversion works end to end.');
}
