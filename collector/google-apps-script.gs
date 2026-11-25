// Receives volunteers' results and appends them to the spreadsheet this script is attached to. Stores only a timestamp and the numbers sent. See docs/CONTRIBUTE_COMPUTE.md.
function doPost(e) {
  var body = e && e.postData && e.postData.contents;
  if (!body || body.length > 200000) return ContentService.createTextOutput('rejected');
  var data; try { data = JSON.parse(body); } catch (err) { return ContentService.createTextOutput('rejected'); }
  if (!data || data.v !== 3 || !Array.isArray(data.results) || data.results.length > 50) return ContentService.createTextOutput('rejected');
  var rows = [];
  data.results.forEach(function (r) {
    if (r && Number.isInteger(r.u) && r.u >= 0 && Array.isArray(r.d) && Array.isArray(r.m) && r.d.length === r.m.length && r.d.length <= 40 && r.d.every(Number.isInteger))
      rows.push([new Date(), JSON.stringify({ u: r.u, d: r.d, m: r.m })]);
  });
  if (rows.length) { var lock = LockService.getScriptLock(); lock.waitLock(20000); try { var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0]; sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 2).setValues(rows); } finally { lock.releaseLock(); } }
  return ContentService.createTextOutput('ok');
}
