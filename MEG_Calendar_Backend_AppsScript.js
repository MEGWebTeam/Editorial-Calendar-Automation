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
 * STEP 2 — Deploy as a Web App:
 *   Click Deploy → New deployment
 *   Type: Web app
 *   Description: MEG Calendar Generator v1
 *   Execute as: Me
 *   Who has access: Anyone within [your MEG Google Workspace domain]
 *   Click Deploy → copy the Web App URL
 *
 * STEP 3 — Paste the URL into the tool:
 *   Open MEG_Editorial_Calendar_Generator.html
 *   Find the line:  const SCRIPT_URL = 'YOUR_APPS_SCRIPT_URL_HERE';
 *   Replace the placeholder with your deployed URL
 *   Save the file
 *
 * STEP 4 — Host the HTML file:
 *   Upload MEG_Editorial_Calendar_Generator.html to a Google Site
 *   OR share it from Google Drive (anyone with MEG work account can open it)
 *   Your team bookmarks the link — done.
 *
 * That's it. The API key never leaves Google's servers.
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
          // Handle Google Sheets — read all cell values as text
          const ss     = SpreadsheetApp.openById(docId);
          const sheets = ss.getSheets();
          const lines  = [];
          sheets.forEach(function(sheet) {
            const data = sheet.getDataRange().getValues();
            data.forEach(function(row) {
              const clean = row.filter(function(c){ return c !== null && c !== ''; });
              if (clean.length > 0) lines.push(clean.join(' | '));
            });
          });
          text = lines.join('\n');
        } else {
          // Handle Google Docs
          const doc = DocumentApp.openById(docId);
          text = doc.getBody().getText();
        }
        if (!text || text.trim().length < 10) {
          output.setContent(JSON.stringify({ error: 'Document appears empty or could not be read.' }));
        } else {
          output.setContent(JSON.stringify({ content: text.trim() }));
        }
      } catch(docErr) {
        output.setContent(JSON.stringify({ 
          error: 'Could not open file. Make sure sharing is set to "Anyone with the link can view". Error: ' + docErr.message
        }));
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


// ── CLAUDE API CALL ───────────────────────────────────────────────────────────

function callClaude(apiKey, systemPrompt, userMessage) {
  const url = 'https://api.anthropic.com/v1/messages';

  const requestBody = {
    model: 'claude-sonnet-4-20250514',
    max_tokens: 8000,
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
      'Return this exact JSON: {"status": "connected", "model": "claude-sonnet"}'
    );
    Logger.log('✓ Claude API connected successfully.');
    Logger.log('Response: ' + result);
  } catch(err) {
    Logger.log('❌ Claude API error: ' + err.message);
    Logger.log('Check: is your API key correct? Is billing active at console.anthropic.com?');
  }
}
