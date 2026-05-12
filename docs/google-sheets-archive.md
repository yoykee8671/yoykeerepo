# Google Sheets 아카이브 연동

이 앱은 `GOOGLE_APPS_SCRIPT_WEBHOOK_URL` 환경변수가 있으면 브랜드별 입금요청 데이터를 Google Apps Script Webhook으로 전송합니다.

## Apps Script 예시

Google Drive에서 새 Apps Script 프로젝트를 만들고 아래 코드를 붙여 넣은 뒤, 웹 앱으로 배포하세요.

```js
function doPost(e) {
  const payload = JSON.parse(e.postData.contents);
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheetName = sanitizeSheetName(payload.brandName || "전체");
  let sheet = spreadsheet.getSheetByName(sheetName);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(sheetName);
  }

  const headers = payload.columns.map(function (column) {
    return column.label;
  });

  const values = payload.rows.map(function (row) {
    return payload.columns.map(function (column) {
      return row[column.key] == null ? "" : row[column.key];
    });
  });

  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (values.length > 0) {
    sheet.getRange(2, 1, values.length, headers.length).setValues(values);
  }
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, headers.length);

  return ContentService
    .createTextOutput(JSON.stringify({
      ok: true,
      sheetName: sheetName,
      rows: values.length,
      updatedAt: new Date().toISOString()
    }))
    .setMimeType(ContentService.MimeType.JSON);
}

function sanitizeSheetName(name) {
  return String(name).replace(/[\\/?*[\]:]/g, " ").slice(0, 90);
}
```

## 실행 방법

```bash
GOOGLE_APPS_SCRIPT_WEBHOOK_URL="https://script.google.com/macros/s/..." npm start
```

앱의 `아카이브` 화면에서 전체 또는 브랜드별 동기화를 누르면 Webhook으로 전송됩니다.

## 업체 공유 방식

- 웹앱 공유 링크: 브랜드 화면의 `공유 보기` 링크를 업체에 전달하면 읽기 전용으로 현재 데이터를 볼 수 있습니다.
- Google Sheets 링크: 브랜드 수정 화면의 `Google Sheets 아카이브 URL`에 업체별 공유 시트 링크를 저장하면, 아카이브 화면에서 바로 열 수 있습니다.
