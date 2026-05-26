// ============================================================
// MARCOM — Universal File Parser (Multi-Format Support)
// ============================================================
// Extracts text/data from any uploaded file format and prepares
// it for AI analysis. Supports:
//   - CSV (structured campaign data)
//   - Excel/XLSX (structured spreadsheets)
//   - PDF (unstructured text extraction)
//   - TXT (plain text)
//
// Returns normalized structure for AI consumption.
// ============================================================
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import XLSX from 'xlsx';
import { parseMetaAdsCsv } from '../services/metaAdsParser.js';

// pdf-parse is CommonJS, need to require it
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

/**
 * Parse uploaded file based on extension/MIME type
 * @param {Object} file - Multer file object
 * @returns {Promise<Object>} { type, data, raw }
 */
export async function parseUploadedFile(file) {
  const ext = path.extname(file.originalname).toLowerCase();
  const buffer = fs.readFileSync(file.path);

  // Route to appropriate parser based on file extension
  switch (ext) {
    case '.csv':
      return await parseCsvFile(file);

    case '.xlsx':
    case '.xls':
      return await parseExcelFile(buffer, file.originalname);

    case '.pdf':
      return await parsePdfFile(buffer, file.originalname);

    case '.txt':
      return parseTextFile(buffer, file.originalname);

    default:
      // Fallback: try to read as text
      try {
        return parseTextFile(buffer, file.originalname);
      } catch (_err) {
        throw new Error(`Unsupported file format: ${ext}`);
      }
  }
}

// ── CSV Parser (existing logic) ──────────────────────────────
async function parseCsvFile(file) {
  const buffer = fs.readFileSync(file.path);
  const { campaigns, errors, stats } = parseMetaAdsCsv(buffer);

  return {
    type: 'csv',
    format: 'structured',
    data: campaigns || [],
    errors: errors || [],
    stats,
    raw: null, // CSV is already structured, no raw text needed
    rowCount: (campaigns || []).length,
  };
}

// ── Excel Parser ─────────────────────────────────────────────
async function parseExcelFile(buffer, _filename) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0]; // Use first sheet
  const sheet = workbook.Sheets[sheetName];

  // Convert to JSON (array of objects, using first row as headers)
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  // Try to detect if this is campaign data by looking for common columns
  const hasCommonColumns = rows.length > 0 && (
    'Campaign name' in rows[0] ||
    'campaign_name' in rows[0] ||
    'Campaign' in rows[0] ||
    'Amount spent' in rows[0] ||
    'spend' in rows[0]
  );

  return {
    type: 'excel',
    format: hasCommonColumns ? 'structured' : 'unstructured',
    data: rows,
    raw: JSON.stringify(rows, null, 2), // Fallback for AI analysis
    rowCount: rows.length,
    sheetName,
  };
}

// ── PDF Parser ───────────────────────────────────────────────
async function parsePdfFile(buffer, _filename) {
  const pdfData = await pdfParse(buffer);

  return {
    type: 'pdf',
    format: 'unstructured',
    data: null, // No structured data, AI must extract from text
    raw: pdfData.text,
    pageCount: pdfData.numpages,
    metadata: pdfData.info,
  };
}

// ── Text Parser ──────────────────────────────────────────────
function parseTextFile(buffer, _filename) {
  const text = buffer.toString('utf-8');

  return {
    type: 'text',
    format: 'unstructured',
    data: null,
    raw: text,
    charCount: text.length,
  };
}

/**
 * Sanitize text to remove encoding corruption and non-printable chars
 * Useful for handling malformed UTF-8 from Excel exports
 */
export function sanitizeText(text) {
  return text
    // Remove non-printable control characters (except newline/tab)
    .replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '')
    // Replace common encoding artifacts
    .replace(/ð/g, '') // Corrupted UTF-8 marker
    // Normalize whitespace
    .replace(/\s+/g, ' ')
    .trim();
}
