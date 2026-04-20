# Editorial Calendar Automation

This project automates the management of an editorial calendar using Google Apps Script and a web-based interface.

## 📁 Project Structure

* `MEG_Editorial_Calendar_Generator.html`: The front-end interface used to input or view calendar data.
* `MEG_Calendar_Backend_AppsScript.js`: The backend logic that handles data processing, Google Sheets integration, and calendar events.

## 🚀 Getting Started

### 1. Google Apps Script Setup
1. Open [Google Apps Script](https://script.google.com/).
2. Create a new project.
3. Paste the contents of `MEG_Calendar_Backend_AppsScript.js` into the script editor.
4. (Optional) Deploy as a Web App to connect with the `MEG_Editorial_Calendar_Generator.html` file.

### 2. Local Development
To make changes to the interface:
1. Edit `MEG_Editorial_Calendar_Generator.html`.
2. Open the file in any modern web browser to preview the layout.

## 🛠️ Features
* Automated synchronization between the web form and Google Sheets.
* Custom UI for easier editorial scheduling.
* Backend validation for calendar entries.
