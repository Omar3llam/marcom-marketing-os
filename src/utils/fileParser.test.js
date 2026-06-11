import fs from 'fs';
import os from 'os';
import path from 'path';
import ExcelJS from 'exceljs';
import { afterEach, describe, expect, it } from 'vitest';
import { parseUploadedFile } from './fileParser.js';

const tempFiles = [];

function tempPath(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marcom-file-parser-'));
  const filePath = path.join(dir, name);
  tempFiles.push({ dir, filePath });
  return filePath;
}

afterEach(() => {
  while (tempFiles.length) {
    const { dir } = tempFiles.pop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('parseUploadedFile Excel parsing', () => {
  it('parses .xlsx files with the existing response shape', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Campaigns');
    sheet.addRow(['Campaign name', 'Amount spent', 'spend']);
    sheet.addRow(['Prospecting', 120.5, 120.5]);

    const filePath = tempPath('campaigns.xlsx');
    await workbook.xlsx.writeFile(filePath);

    const result = await parseUploadedFile({
      originalname: 'campaigns.xlsx',
      path: filePath,
    });

    expect(result).toMatchObject({
      type: 'excel',
      format: 'structured',
      rowCount: 1,
      sheetName: 'Campaigns',
    });
    expect(result.data).toEqual([
      { 'Campaign name': 'Prospecting', 'Amount spent': 120.5, spend: 120.5 },
    ]);
    expect(JSON.parse(result.raw)).toEqual(result.data);
  });

  it('rejects malformed .xlsx files', async () => {
    const filePath = tempPath('bad.xlsx');
    fs.writeFileSync(filePath, 'not a workbook');

    await expect(parseUploadedFile({
      originalname: 'bad.xlsx',
      path: filePath,
    })).rejects.toThrow();
  });

  it('rejects legacy .xls files without using vulnerable parsing', async () => {
    const filePath = tempPath('legacy.xls');
    fs.writeFileSync(filePath, 'legacy workbook');

    await expect(parseUploadedFile({
      originalname: 'legacy.xls',
      path: filePath,
    })).rejects.toThrow('Legacy .xls files are not supported');
  });
});
