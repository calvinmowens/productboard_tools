import { useState, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useAction } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { useInactivityTimeout } from '../../hooks/useInactivityTimeout';
import { TimeoutWarningModal } from '../../components/TimeoutWarningModal';
import { SecurityNotice } from '../../components/SecurityNotice';
import ApiTokenHelpTooltip from '../../components/ApiTokenHelpTooltip';

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
type ImportStep = 'upload' | 'mapping' | 'preview' | 'importing' | 'results';

interface CSVRow {
  [key: string]: string;
}

interface ImportResult {
  rowIndex: number;
  success: boolean;
  error?: string;
  createdWithoutOwner?: boolean;
}

interface FailedRow {
  rowIndex: number;
  rowData: CSVRow;
  error: string;
}

interface PreviewItem {
  rowIndex: number;
  title: string;
  noteText: string;
  userEmail: string;
  owner: string;
  tags: string[];
  isValid: boolean;
  error?: string;
}

// Parse CSV string into rows
function parseCSV(csvText: string): { columns: string[]; rows: CSVRow[] } {
  const lines = csvText.split('\n').filter(line => line.trim());
  if (lines.length === 0) return { columns: [], rows: [] };

  const columns = parseCSVLine(lines[0]);

  const rows: CSVRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const row: CSVRow = {};
    columns.forEach((col, idx) => {
      row[col] = values[idx] || '';
    });
    rows.push(row);
  }

  return { columns, rows };
}

// Parse a single CSV line handling quoted values
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
  }
  result.push(current.trim());

  return result;
}

// Escape value for CSV
function escapeCSV(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// Truncate string for display
function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength) + '...';
}

// Strip HTML tags for preview display
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

export default function CSVNoteImport() {
  // Authentication state
  const [apiToken, setApiToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [connectionError, setConnectionError] = useState<string | null>(null);

  // Step state
  const [currentStep, setCurrentStep] = useState<ImportStep>('upload');

  // CSV state
  const [csvData, setCsvData] = useState<{ columns: string[]; rows: CSVRow[] } | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Column mappings (checkbox-based)
  const [titleColumns, setTitleColumns] = useState<string[]>([]);
  const [noteTextColumns, setNoteTextColumns] = useState<string[]>([]);
  const [userEmailColumn, setUserEmailColumn] = useState<string | null>(null);
  const [ownerColumn, setOwnerColumn] = useState<string | null>(null);
  const [tagColumns, setTagColumns] = useState<string[]>([]);

  // Column ordering (for drag-drop when multiple selected)
  const [titleColumnOrder, setTitleColumnOrder] = useState<string[]>([]);
  const [noteTextColumnOrder, setNoteTextColumnOrder] = useState<string[]>([]);
  const [tagColumnOrder, setTagColumnOrder] = useState<string[]>([]);

  // Drag state
  const [draggedItem, setDraggedItem] = useState<string | null>(null);
  const [dragOverItem, setDragOverItem] = useState<string | null>(null);

  // Preview state
  const [previewItems, setPreviewItems] = useState<PreviewItem[]>([]);

  // Import state
  const [, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0 });
  const [importResults, setImportResults] = useState<ImportResult[]>([]);
  const [failedRows, setFailedRows] = useState<FailedRow[]>([]);

  // Convex actions
  const validateApiKey = useAction(api.productboard.validateApiKey);
  const createNote = useAction(api.productboard.createNote);

  const handleConnect = useCallback(async () => {
    if (!apiToken.trim()) return;

    setConnectionStatus('connecting');
    setConnectionError(null);

    try {
      const result = await validateApiKey({ apiToken });

      if (!result.valid) {
        setConnectionStatus('error');
        setConnectionError(result.error || 'Invalid API key');
        return;
      }

      setConnectionStatus('connected');
    } catch (error) {
      setConnectionStatus('error');
      setConnectionError(String(error));
    }
  }, [apiToken, validateApiKey]);

  const resetMappings = useCallback(() => {
    setTitleColumns([]);
    setNoteTextColumns([]);
    setUserEmailColumn(null);
    setOwnerColumn(null);
    setTagColumns([]);
    setTitleColumnOrder([]);
    setNoteTextColumnOrder([]);
    setTagColumnOrder([]);
  }, []);

  const handleDisconnect = useCallback(() => {
    setApiToken('');
    setConnectionStatus('disconnected');
    setCsvData(null);
    setFileName('');
    resetMappings();
    setPreviewItems([]);
    setImportResults([]);
    setFailedRows([]);
    setCurrentStep('upload');
  }, [resetMappings]);

  // Inactivity timeout - clears token after 30 minutes of inactivity
  const { showWarning, timeRemaining, dismissWarning } = useInactivityTimeout(
    handleDisconnect,
    { enabled: connectionStatus === 'connected' }
  );

  const handleFileUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const parsed = parseCSV(text);
      setCsvData(parsed);
      resetMappings();
    };
    reader.readAsText(file);
  }, [resetMappings]);

  // Toggle checkbox for multi-select fields
  const toggleTitleColumn = useCallback((column: string) => {
    setTitleColumns(prev => {
      if (prev.includes(column)) {
        setTitleColumnOrder(order => order.filter(c => c !== column));
        return prev.filter(c => c !== column);
      } else {
        setTitleColumnOrder(order => order.includes(column) ? order : [...order, column]);
        return prev.includes(column) ? prev : [...prev, column];
      }
    });
  }, []);

  const toggleNoteTextColumn = useCallback((column: string) => {
    setNoteTextColumns(prev => {
      if (prev.includes(column)) {
        setNoteTextColumnOrder(order => order.filter(c => c !== column));
        return prev.filter(c => c !== column);
      } else {
        setNoteTextColumnOrder(order => order.includes(column) ? order : [...order, column]);
        return prev.includes(column) ? prev : [...prev, column];
      }
    });
  }, []);

  const toggleTagColumn = useCallback((column: string) => {
    setTagColumns(prev => {
      if (prev.includes(column)) {
        setTagColumnOrder(order => order.filter(c => c !== column));
        return prev.filter(c => c !== column);
      } else {
        setTagColumnOrder(order => order.includes(column) ? order : [...order, column]);
        return prev.includes(column) ? prev : [...prev, column];
      }
    });
  }, []);

  // Single-select fields (toggle behavior)
  const toggleUserEmailColumn = useCallback((column: string) => {
    setUserEmailColumn(prev => prev === column ? null : column);
  }, []);

  const toggleOwnerColumn = useCallback((column: string) => {
    setOwnerColumn(prev => prev === column ? null : column);
  }, []);

  // Drag and drop handlers
  const handleDragStart = useCallback((column: string) => {
    setDraggedItem(column);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, column: string) => {
    e.preventDefault();
    setDragOverItem(column);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggedItem(null);
    setDragOverItem(null);
  }, []);

  const handleDrop = useCallback((
    e: React.DragEvent,
    targetColumn: string,
    orderState: string[],
    setOrderState: React.Dispatch<React.SetStateAction<string[]>>
  ) => {
    e.preventDefault();
    if (!draggedItem || draggedItem === targetColumn) {
      setDraggedItem(null);
      setDragOverItem(null);
      return;
    }

    const newOrder = [...orderState];
    const draggedIndex = newOrder.indexOf(draggedItem);
    const targetIndex = newOrder.indexOf(targetColumn);

    newOrder.splice(draggedIndex, 1);
    newOrder.splice(targetIndex, 0, draggedItem);

    setOrderState(newOrder);
    setDraggedItem(null);
    setDragOverItem(null);
  }, [draggedItem]);

  // Build note title from row
  const buildTitle = useCallback((row: CSVRow): string => {
    return titleColumnOrder
      .map(col => row[col]?.trim() || '')
      .filter(v => v)
      .join(', ');
  }, [titleColumnOrder]);

  // Build note text (HTML) from row
  const buildNoteText = useCallback((row: CSVRow): string => {
    return noteTextColumnOrder
      .map(col => `<b>${col}</b><br>${row[col] || ''}`)
      .join('<br><br>');
  }, [noteTextColumnOrder]);

  // Build tags array from row
  const buildTags = useCallback((row: CSVRow): string[] => {
    return tagColumnOrder
      .map(col => row[col]?.trim())
      .filter((v): v is string => !!v);
  }, [tagColumnOrder]);

  // Check if we can proceed to preview
  const canProceedToPreview = useCallback(() => {
    // Must have at least one column for BOTH title AND note text
    return titleColumns.length > 0 && noteTextColumns.length > 0;
  }, [titleColumns, noteTextColumns]);

  // Generate preview
  const handleLoadPreview = useCallback(() => {
    if (!csvData) return;

    const items: PreviewItem[] = [];
    const rowsToPreview = csvData.rows.slice(0, 20);

    for (let i = 0; i < rowsToPreview.length; i++) {
      const row = rowsToPreview[i];
      const title = buildTitle(row);
      const noteText = buildNoteText(row);
      const userEmail = userEmailColumn ? row[userEmailColumn]?.trim() || '' : '';
      const owner = ownerColumn ? row[ownerColumn]?.trim() || '' : '';
      const tags = buildTags(row);

      // Validate: need both title AND note text
      const isValid = title.length > 0 && noteText.length > 0;

      items.push({
        rowIndex: i,
        title,
        noteText,
        userEmail,
        owner,
        tags,
        isValid,
        error: isValid ? undefined : title.length === 0 && noteText.length === 0 ? 'Missing title and note text' : title.length === 0 ? 'Missing title' : 'Missing note text',
      });
    }

    setPreviewItems(items);
    setCurrentStep('preview');
  }, [csvData, buildTitle, buildNoteText, buildTags, userEmailColumn, ownerColumn]);

  // Execute import
  const handleStartImport = useCallback(async () => {
    if (!csvData) return;

    setCurrentStep('importing');
    setIsImporting(true);
    setImportResults([]);
    setFailedRows([]);

    const results: ImportResult[] = [];
    const failed: FailedRow[] = [];

    // Filter rows that have valid content (need both title AND note text)
    const rowsToProcess: { rowIndex: number; row: CSVRow }[] = [];
    for (let i = 0; i < csvData.rows.length; i++) {
      const row = csvData.rows[i];
      const title = buildTitle(row);
      const noteText = buildNoteText(row);

      if (title.length > 0 && noteText.length > 0) {
        rowsToProcess.push({ rowIndex: i, row });
      }
    }

    setImportProgress({ current: 0, total: rowsToProcess.length });

    for (let i = 0; i < rowsToProcess.length; i++) {
      const { rowIndex, row } = rowsToProcess[i];
      const title = buildTitle(row);
      const noteText = buildNoteText(row);
      const userEmail = userEmailColumn ? row[userEmailColumn]?.trim() || undefined : undefined;
      const ownerEmail = ownerColumn ? row[ownerColumn]?.trim() || undefined : undefined;
      const tags = buildTags(row);

      try {
        const result = await createNote({
          apiToken,
          title: title || 'Untitled Note',
          content: noteText || '',
          userEmail: userEmail || undefined,
          ownerEmail: ownerEmail || undefined,
          tags: tags.length > 0 ? tags : undefined,
        });

        if (result.success) {
          results.push({ rowIndex, success: true, createdWithoutOwner: result.createdWithoutOwner || false });
        } else {
          results.push({ rowIndex, success: false, error: result.error || 'Unknown error' });
          failed.push({ rowIndex, rowData: row, error: result.error || 'Unknown error' });
        }
      } catch (error) {
        const errorMsg = String(error);
        results.push({ rowIndex, success: false, error: errorMsg });
        failed.push({ rowIndex, rowData: row, error: errorMsg });
      }

      setImportProgress({ current: i + 1, total: rowsToProcess.length });

      // Rate limiting delay every 10 rows
      if ((i + 1) % 10 === 0 && i + 1 < rowsToProcess.length) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    setImportResults(results);
    setFailedRows(failed);
    setIsImporting(false);
    setCurrentStep('results');
  }, [csvData, buildTitle, buildNoteText, buildTags, userEmailColumn, ownerColumn, apiToken, createNote]);

  // Download failure report CSV
  const downloadFailureReport = useCallback(() => {
    if (!csvData || failedRows.length === 0) return;

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `failure_report_${timestamp}.csv`;

    const headers = [...csvData.columns, 'Error'];
    const headerRow = headers.map(h => escapeCSV(h)).join(',');

    const dataRows = failedRows.map(f => {
      const values = csvData.columns.map(col => escapeCSV(f.rowData[col] || ''));
      values.push(escapeCSV(f.error));
      return values.join(',');
    });

    const csvContent = [headerRow, ...dataRows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [csvData, failedRows]);

  // Download import log CSV
  const downloadImportLog = useCallback(() => {
    if (!csvData || importResults.length === 0) return;

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `note-import-log-${timestamp}.csv`;

    const successResults = importResults.filter(r => r.success && !r.createdWithoutOwner);
    const withoutOwnerResults = importResults.filter(r => r.success && r.createdWithoutOwner);
    const failedResults = importResults.filter(r => !r.success);

    const summary = [
      ['CSV Note Import Log'],
      [`Date: ${new Date().toLocaleString()}`],
      [''],
      ['Column Mappings:'],
      [`  Title: ${titleColumnOrder.length > 0 ? titleColumnOrder.join(' + ') : '(none)'}`],
      [`  Note Text: ${noteTextColumnOrder.length > 0 ? noteTextColumnOrder.join(' + ') : '(none)'}`],
      [`  User Email: ${userEmailColumn || '(none)'}`],
      [`  Owner: ${ownerColumn || '(none)'}`],
      [`  Tags: ${tagColumnOrder.length > 0 ? tagColumnOrder.join(' + ') : '(none)'}`],
      [''],
      [`Total Rows in CSV: ${csvData.rows.length}`],
      [`Successfully Imported: ${successResults.length}`],
      [`Imported without Owner: ${withoutOwnerResults.length}`],
      [`Failed: ${failedResults.length}`],
      [''],
      ['Row,Title,Note Text (preview),User Email,Owner,Tags,Status,Error'],
    ];

    const dataRows = importResults.map(r => {
      const row = csvData.rows[r.rowIndex];
      const title = buildTitle(row);
      const noteText = stripHtml(buildNoteText(row)).substring(0, 100);
      const userEmail = userEmailColumn ? row[userEmailColumn]?.trim() || '' : '';
      const owner = ownerColumn ? row[ownerColumn]?.trim() || '' : '';
      const tags = buildTags(row).join('; ');

      let status = 'Failed';
      if (r.success && r.createdWithoutOwner) {
        status = 'Imported without Owner';
      } else if (r.success) {
        status = 'Success';
      }

      return [
        String(r.rowIndex + 1),
        escapeCSV(title),
        escapeCSV(noteText),
        escapeCSV(userEmail),
        escapeCSV(owner),
        escapeCSV(tags),
        status,
        escapeCSV(r.error || ''),
      ].join(',');
    });

    const csvContent = [...summary.map(row => row.join('')), ...dataRows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [csvData, importResults, titleColumnOrder, noteTextColumnOrder, userEmailColumn, ownerColumn, tagColumnOrder, buildTitle, buildNoteText, buildTags]);

  const successCount = importResults.filter(r => r.success && !r.createdWithoutOwner).length;
  const importedWithoutOwnerCount = importResults.filter(r => r.success && r.createdWithoutOwner).length;
  const failedCount = importResults.filter(r => !r.success).length;

  // Calculate total valid rows for import (need both title AND note text)
  const totalValidRows = csvData?.rows.filter(row => {
    const title = buildTitle(row);
    const noteText = buildNoteText(row);
    return title.length > 0 && noteText.length > 0;
  }).length || 0;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto py-8 px-4">
        {/* Header */}
        <div className="mb-8">
          <Link to="/" className="text-blue-600 hover:text-blue-800 text-sm mb-2 inline-block">
            ← Back to Scripts
          </Link>
          <h1 className="text-3xl font-bold text-gray-900">CSV Note Import</h1>
          <p className="mt-2 text-gray-600">
            Import notes from a CSV file into Productboard.
          </p>

          {/* API Endpoints Used */}
          <div className="mt-4 p-3 bg-gray-100 rounded-lg">
            <p className="text-xs font-medium text-gray-700 mb-2">API Endpoints Used (V1):</p>
            <ul className="text-xs text-gray-600 space-y-1">
              <li>
                <code className="bg-gray-200 px-1 rounded">POST /notes</code>
                {' '}-{' '}
                <a href="https://developer.productboard.com/reference/create_note" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Docs</a>
              </li>
            </ul>
          </div>
        </div>

        {/* API Key Section */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <div className="flex items-center mb-4">
          <h2 className="text-lg font-semibold text-gray-900">API Authentication</h2>
          <ApiTokenHelpTooltip />
        </div>

          <div className="flex gap-4 items-end">
            <div className="flex-1">
              <label htmlFor="apiToken" className="block text-sm font-medium text-gray-700 mb-1">
                Productboard API Token
              </label>
              <div className="relative">
                <input
                  id="apiToken"
                  type={showToken ? 'text' : 'password'}
                  value={apiToken}
                  onChange={(e) => setApiToken(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && apiToken.trim() && connectionStatus !== 'connected' && connectionStatus !== 'connecting') {
                      handleConnect();
                    }
                  }}
                  disabled={connectionStatus === 'connected'}
                  placeholder="Enter your API token..."
                  autoComplete="off"
                  data-1p-ignore="true"
                  data-lpignore="true"
                  data-form-type="other"
                  className="w-full px-4 py-2 pr-16 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                />
                <button
                  type="button"
                  onClick={() => setShowToken(!showToken)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                >
                  {showToken ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            {connectionStatus === 'connected' ? (
              <button
                onClick={handleDisconnect}
                className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
              >
                Disconnect
              </button>
            ) : (
              <button
                onClick={handleConnect}
                disabled={!apiToken.trim() || connectionStatus === 'connecting'}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed transition-colors"
              >
                {connectionStatus === 'connecting' ? 'Connecting...' : 'Connect'}
              </button>
            )}
          </div>

          {/* Connection Status */}
          <div className="mt-4 flex items-center gap-2">
            <div
              className={`w-3 h-3 rounded-full ${
                connectionStatus === 'connected'
                  ? 'bg-green-500'
                  : connectionStatus === 'connecting'
                  ? 'bg-yellow-500 animate-pulse'
                  : connectionStatus === 'error'
                  ? 'bg-red-500'
                  : 'bg-gray-300'
              }`}
            />
            <span className="text-sm text-gray-600">
              {connectionStatus === 'connected'
                ? 'Connected'
                : connectionStatus === 'connecting'
                ? 'Connecting...'
                : connectionStatus === 'error'
                ? 'Connection failed'
                : 'Not connected'}
            </span>
          </div>

          {connectionError && (
            <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {connectionError}
            </div>
          )}

          {connectionStatus !== 'connected' && (
            <SecurityNotice className="mt-4" />
          )}
        </div>

        {/* Step 1: Upload CSV */}
        {connectionStatus === 'connected' && (
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                {currentStep !== 'upload' && csvData ? (
                  <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center">
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                ) : (
                  <div className="w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center">
                    <span className="text-white text-sm font-medium">1</span>
                  </div>
                )}
                <h2 className="text-lg font-semibold text-gray-900">Upload CSV</h2>
              </div>
              {currentStep !== 'upload' && csvData && (
                <button
                  onClick={() => setCurrentStep('upload')}
                  className="text-sm text-blue-600 hover:text-blue-800"
                >
                  Edit
                </button>
              )}
            </div>

            {currentStep === 'upload' ? (
              !csvData ? (
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-400 transition-colors">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="text-blue-600 hover:text-blue-800"
                  >
                    Click to upload
                  </button>
                  <span className="text-gray-500"> or drag and drop a CSV file</span>
                  <p className="text-sm text-gray-400 mt-2">
                    CSV columns will be mapped to note fields
                  </p>
                </div>
              ) : (
                <div>
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-green-800 font-medium">{fileName}</p>
                        <p className="text-green-600 text-sm">
                          {csvData.columns.length} columns, {csvData.rows.length} rows
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          setCsvData(null);
                          setFileName('');
                          resetMappings();
                          if (fileInputRef.current) fileInputRef.current.value = '';
                        }}
                        className="text-sm text-gray-500 hover:text-gray-700"
                      >
                        Change file
                      </button>
                    </div>
                  </div>

                  <div className="mt-4">
                    <p className="text-sm font-medium text-gray-700 mb-2">Detected Columns:</p>
                    <div className="flex flex-wrap gap-2">
                      {csvData.columns.map(col => (
                        <span key={col} className="px-2 py-1 bg-gray-100 rounded text-sm text-gray-700">
                          {col}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="mt-6 flex justify-end">
                    <button
                      onClick={() => setCurrentStep('mapping')}
                      className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    >
                      Continue to Mapping
                    </button>
                  </div>
                </div>
              )
            ) : csvData ? (
              <div className="flex items-center gap-4 text-sm text-gray-600">
                <span className="font-medium text-gray-900">{fileName}</span>
                <span>-</span>
                <span>{csvData.columns.length} columns</span>
                <span>-</span>
                <span>{csvData.rows.length} rows</span>
              </div>
            ) : null}
          </div>
        )}

        {/* Step 2: Map Columns */}
        {connectionStatus === 'connected' && csvData && currentStep !== 'upload' && (
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                {currentStep !== 'mapping' && canProceedToPreview() ? (
                  <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center">
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                ) : (
                  <div className="w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center">
                    <span className="text-white text-sm font-medium">2</span>
                  </div>
                )}
                <h2 className="text-lg font-semibold text-gray-900">Map Columns to Note Fields</h2>
              </div>
              {currentStep !== 'mapping' && canProceedToPreview() && (
                <button
                  onClick={() => setCurrentStep('mapping')}
                  className="text-sm text-blue-600 hover:text-blue-800"
                >
                  Edit
                </button>
              )}
            </div>

            {currentStep === 'mapping' ? (
              <>
                <p className="text-sm text-gray-600 mb-4">
                  Select which columns map to each note field. Multiple columns can be selected for Title, Note Text, and Tags.
                </p>

                {/* Mapping Grid */}
                <div className="overflow-x-auto">
                  <table className="min-w-full border-collapse">
                    <thead>
                      <tr className="bg-gray-100">
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide border-b">
                          CSV Column
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide border-b">
                          Sample
                        </th>
                        <th className="px-3 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wide border-b">
                          Title
                        </th>
                        <th className="px-3 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wide border-b">
                          Note Text
                        </th>
                        <th className="px-3 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wide border-b">
                          User Email
                        </th>
                        <th className="px-3 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wide border-b">
                          Owner
                        </th>
                        <th className="px-3 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wide border-b">
                          Tags
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {csvData.columns.map((col, idx) => (
                        <tr key={col} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                          <td className="px-4 py-3 font-medium text-gray-900 border-b">
                            {col}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-500 border-b max-w-[200px] truncate">
                            {csvData.rows[0]?.[col]?.substring(0, 40) || '(empty)'}
                          </td>
                          <td className="px-3 py-3 text-center border-b">
                            <input
                              type="checkbox"
                              checked={titleColumns.includes(col)}
                              onChange={() => toggleTitleColumn(col)}
                              className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                            />
                          </td>
                          <td className="px-3 py-3 text-center border-b">
                            <input
                              type="checkbox"
                              checked={noteTextColumns.includes(col)}
                              onChange={() => toggleNoteTextColumn(col)}
                              className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                            />
                          </td>
                          <td className="px-3 py-3 text-center border-b">
                            <input
                              type="checkbox"
                              checked={userEmailColumn === col}
                              onChange={() => toggleUserEmailColumn(col)}
                              className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                            />
                          </td>
                          <td className="px-3 py-3 text-center border-b">
                            <input
                              type="checkbox"
                              checked={ownerColumn === col}
                              onChange={() => toggleOwnerColumn(col)}
                              className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                            />
                          </td>
                          <td className="px-3 py-3 text-center border-b">
                            <input
                              type="checkbox"
                              checked={tagColumns.includes(col)}
                              onChange={() => toggleTagColumn(col)}
                              className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Drag and Drop Reordering Sections */}
                {(titleColumnOrder.length > 1 || noteTextColumnOrder.length > 1 || tagColumnOrder.length > 1) && (
                  <div className="mt-6 space-y-4">
                    <p className="text-sm font-medium text-gray-700">
                      Drag to reorder columns (order affects output):
                    </p>

                    {/* Title Column Order */}
                    {titleColumnOrder.length > 1 && (
                      <div className="bg-blue-50 p-4 rounded-lg">
                        <p className="text-sm font-medium text-blue-800 mb-2">Title Column Order:</p>
                        <div className="flex flex-wrap gap-2">
                          {titleColumnOrder.map(col => (
                            <div
                              key={col}
                              draggable
                              onDragStart={() => handleDragStart(col)}
                              onDragOver={(e) => handleDragOver(e, col)}
                              onDrop={(e) => handleDrop(e, col, titleColumnOrder, setTitleColumnOrder)}
                              onDragEnd={handleDragEnd}
                              className={`px-3 py-2 bg-white border rounded-lg cursor-move flex items-center gap-2 ${
                                draggedItem === col ? 'opacity-50' : ''
                              } ${dragOverItem === col ? 'border-blue-500 border-2' : 'border-gray-300'}`}
                            >
                              <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
                              </svg>
                              {col}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Note Text Column Order */}
                    {noteTextColumnOrder.length > 1 && (
                      <div className="bg-green-50 p-4 rounded-lg">
                        <p className="text-sm font-medium text-green-800 mb-2">Note Text Column Order:</p>
                        <div className="flex flex-wrap gap-2">
                          {noteTextColumnOrder.map(col => (
                            <div
                              key={col}
                              draggable
                              onDragStart={() => handleDragStart(col)}
                              onDragOver={(e) => handleDragOver(e, col)}
                              onDrop={(e) => handleDrop(e, col, noteTextColumnOrder, setNoteTextColumnOrder)}
                              onDragEnd={handleDragEnd}
                              className={`px-3 py-2 bg-white border rounded-lg cursor-move flex items-center gap-2 ${
                                draggedItem === col ? 'opacity-50' : ''
                              } ${dragOverItem === col ? 'border-green-500 border-2' : 'border-gray-300'}`}
                            >
                              <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
                              </svg>
                              {col}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Tag Column Order */}
                    {tagColumnOrder.length > 1 && (
                      <div className="bg-purple-50 p-4 rounded-lg">
                        <p className="text-sm font-medium text-purple-800 mb-2">Tags Column Order:</p>
                        <div className="flex flex-wrap gap-2">
                          {tagColumnOrder.map(col => (
                            <div
                              key={col}
                              draggable
                              onDragStart={() => handleDragStart(col)}
                              onDragOver={(e) => handleDragOver(e, col)}
                              onDrop={(e) => handleDrop(e, col, tagColumnOrder, setTagColumnOrder)}
                              onDragEnd={handleDragEnd}
                              className={`px-3 py-2 bg-white border rounded-lg cursor-move flex items-center gap-2 ${
                                draggedItem === col ? 'opacity-50' : ''
                              } ${dragOverItem === col ? 'border-purple-500 border-2' : 'border-gray-300'}`}
                            >
                              <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
                              </svg>
                              {col}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Mapping Summary */}
                <div className="mt-6 bg-gray-50 rounded-lg p-4">
                  <h3 className="text-sm font-medium text-gray-700 mb-2">Mapping Summary:</h3>
                  <ul className="text-sm text-gray-600 space-y-1">
                    <li>Title: {titleColumnOrder.length > 0 ? titleColumnOrder.join(' + ') : '(none)'}</li>
                    <li>Note Text: {noteTextColumnOrder.length > 0 ? noteTextColumnOrder.join(' + ') : '(none)'}</li>
                    <li>User Email: {userEmailColumn || '(none)'}</li>
                    <li>Owner: {ownerColumn || '(none)'}</li>
                    <li>Tags: {tagColumnOrder.length > 0 ? tagColumnOrder.join(' + ') : '(none)'}</li>
                  </ul>
                </div>

                {/* Validation */}
                {!canProceedToPreview() && (
                  <div className="mt-4 text-sm text-red-600">
                    You must select at least one column for both Title and Note Text (both are required by the API)
                  </div>
                )}

                <div className="mt-6 flex justify-between items-center">
                  <button
                    onClick={() => setCurrentStep('upload')}
                    className="px-6 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
                  >
                    Back
                  </button>
                  <div className="flex gap-3">
                    <button
                      onClick={() => {
                        setCsvData(null);
                        setFileName('');
                        resetMappings();
                        setCurrentStep('upload');
                      }}
                      className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleLoadPreview}
                      disabled={!canProceedToPreview()}
                      className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed transition-colors"
                    >
                      Preview Import
                    </button>
                  </div>
                </div>
              </>
            ) : canProceedToPreview() ? (
              <div className="text-sm text-gray-600">
                <span className="font-medium text-gray-900">Mapped:</span>{' '}
                Title ({titleColumnOrder.length}), Note Text ({noteTextColumnOrder.length}),
                User Email ({userEmailColumn ? 1 : 0}), Owner ({ownerColumn ? 1 : 0}),
                Tags ({tagColumnOrder.length})
              </div>
            ) : null}
          </div>
        )}

        {/* Step 3: Preview */}
        {connectionStatus === 'connected' && currentStep === 'preview' && csvData && (
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center">
                <span className="text-white text-sm font-medium">3</span>
              </div>
              <h2 className="text-lg font-semibold text-gray-900">Preview Import</h2>
            </div>

            {/* Summary */}
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="bg-blue-50 p-4 rounded-lg">
                <div className="text-2xl font-bold text-blue-700">{csvData.rows.length}</div>
                <div className="text-sm text-blue-600">Total Rows</div>
              </div>
              <div className="bg-green-50 p-4 rounded-lg">
                <div className="text-2xl font-bold text-green-700">{totalValidRows}</div>
                <div className="text-sm text-green-600">Will Import</div>
              </div>
              <div className="bg-gray-100 p-4 rounded-lg">
                <div className="text-2xl font-bold text-gray-700">{csvData.rows.length - totalValidRows}</div>
                <div className="text-sm text-gray-600">Skipped (No Content)</div>
              </div>
            </div>

            {/* Note Text Format Preview */}
            {previewItems.length > 0 && previewItems.find(item => item.noteText) && (
              <div className="mb-6">
                <h3 className="font-medium text-gray-900 mb-2">Note Text Format Preview</h3>
                <p className="text-sm text-gray-600 mb-3">This is how the note text will appear in Productboard:</p>
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <div className="bg-gray-50 px-4 py-2 border-b border-gray-200">
                    <span className="text-xs font-medium text-gray-500">Rendered HTML</span>
                  </div>
                  <div
                    className="p-4 bg-white prose prose-sm max-w-none"
                    dangerouslySetInnerHTML={{ __html: previewItems.find(item => item.noteText)?.noteText || '' }}
                  />
                  <div className="bg-gray-50 px-4 py-2 border-t border-gray-200">
                    <span className="text-xs font-medium text-gray-500">Raw HTML</span>
                  </div>
                  <div className="p-4 bg-gray-100">
                    <code className="text-xs text-gray-700 whitespace-pre-wrap break-all">
                      {previewItems.find(item => item.noteText)?.noteText || ''}
                    </code>
                  </div>
                </div>
              </div>
            )}

            {/* Preview Table */}
            <div className="mb-6">
              <h3 className="font-medium text-gray-900 mb-2">
                Preview (First {previewItems.length} rows)
              </h3>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-100">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium text-gray-700">#</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-700">Title</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-700">Note Text</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-700">User Email</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-700">Owner</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-700">Tags</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-700">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {previewItems.map((item) => (
                      <tr key={item.rowIndex} className={!item.isValid ? 'bg-gray-50 text-gray-400' : ''}>
                        <td className="px-4 py-2 text-gray-500">{item.rowIndex + 1}</td>
                        <td className="px-4 py-2 max-w-[150px]">
                          <span className="block truncate" title={item.title}>
                            {item.title || '(empty)'}
                          </span>
                        </td>
                        <td className="px-4 py-2 max-w-[200px]">
                          <span className="block truncate" title={stripHtml(item.noteText)}>
                            {truncate(stripHtml(item.noteText), 50) || '(empty)'}
                          </span>
                        </td>
                        <td className="px-4 py-2">{item.userEmail || '-'}</td>
                        <td className="px-4 py-2">{item.owner || '-'}</td>
                        <td className="px-4 py-2">
                          {item.tags.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {item.tags.slice(0, 3).map((tag, i) => (
                                <span key={i} className="px-1.5 py-0.5 bg-purple-100 text-purple-700 text-xs rounded">
                                  {tag}
                                </span>
                              ))}
                              {item.tags.length > 3 && (
                                <span className="text-xs text-gray-500">+{item.tags.length - 3}</span>
                              )}
                            </div>
                          ) : '-'}
                        </td>
                        <td className="px-4 py-2">
                          <span className={`px-2 py-1 text-xs font-medium rounded ${
                            item.isValid
                              ? 'bg-green-100 text-green-700'
                              : 'bg-gray-200 text-gray-600'
                          }`}>
                            {item.isValid ? 'Ready' : 'Skipped'}
                          </span>
                          {item.error && (
                            <div className="text-xs text-red-600 mt-1">{item.error}</div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {csvData.rows.length > 20 && (
                <p className="text-sm text-gray-500 mt-2">
                  Showing first 20 rows. All {totalValidRows} valid rows will be imported.
                </p>
              )}
            </div>

            <div className="flex justify-between items-center">
              <button
                onClick={() => setCurrentStep('mapping')}
                className="px-6 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
              >
                Back
              </button>
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setCsvData(null);
                    setFileName('');
                    resetMappings();
                    setPreviewItems([]);
                    setCurrentStep('upload');
                  }}
                  className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleStartImport}
                  disabled={totalValidRows === 0}
                  className="px-8 py-3 bg-green-600 text-white text-lg font-medium rounded-lg hover:bg-green-700 disabled:bg-green-300 disabled:cursor-not-allowed transition-colors"
                >
                  Import {totalValidRows} Notes
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Step 4: Importing */}
        {connectionStatus === 'connected' && currentStep === 'importing' && (
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center animate-pulse">
                <span className="text-white text-sm font-medium">4</span>
              </div>
              <h2 className="text-lg font-semibold text-gray-900">Importing Notes...</h2>
            </div>

            <div className="mb-4">
              <div className="flex justify-between text-sm text-gray-600 mb-2">
                <span>Creating notes...</span>
                <span>{importProgress.current} / {importProgress.total}</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-3">
                <div
                  className="bg-blue-600 h-3 rounded-full transition-all duration-300"
                  style={{ width: `${(importProgress.current / importProgress.total) * 100}%` }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Step 5: Results */}
        {connectionStatus === 'connected' && currentStep === 'results' && (
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center">
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-gray-900">Import Complete</h2>
            </div>

            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="bg-green-50 p-4 rounded-lg">
                <div className="text-2xl font-bold text-green-700">{successCount}</div>
                <div className="text-sm text-green-600">Successfully Imported</div>
              </div>
              <div className="bg-orange-50 p-4 rounded-lg">
                <div className="text-2xl font-bold text-orange-700">{importedWithoutOwnerCount}</div>
                <div className="text-sm text-orange-600">Imported without Owner</div>
              </div>
              <div className="bg-red-50 p-4 rounded-lg">
                <div className="text-2xl font-bold text-red-700">{failedCount}</div>
                <div className="text-sm text-red-600">Failed</div>
              </div>
            </div>

            {importedWithoutOwnerCount > 0 && (
              <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 mb-6">
                <h3 className="text-sm font-medium text-orange-800 mb-2">Imported without Owner (owner not found in workspace):</h3>
                <ul className="text-sm text-orange-700 space-y-1 max-h-40 overflow-y-auto">
                  {importResults
                    .filter(r => r.success && r.createdWithoutOwner)
                    .slice(0, 10)
                    .map((r) => (
                      <li key={r.rowIndex}>
                        Row {r.rowIndex + 1}
                      </li>
                    ))}
                  {importedWithoutOwnerCount > 10 && (
                    <li>...and {importedWithoutOwnerCount - 10} more</li>
                  )}
                </ul>
              </div>
            )}

            {failedCount > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
                <h3 className="text-sm font-medium text-red-800 mb-2">Failed Imports:</h3>
                <ul className="text-sm text-red-700 space-y-1 max-h-40 overflow-y-auto">
                  {importResults
                    .filter(r => !r.success)
                    .slice(0, 10)
                    .map((r) => (
                      <li key={r.rowIndex}>
                        Row {r.rowIndex + 1}: {r.error}
                      </li>
                    ))}
                  {failedCount > 10 && (
                    <li>...and {failedCount - 10} more errors</li>
                  )}
                </ul>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={downloadImportLog}
                className="px-6 py-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition-colors"
              >
                Download Log
              </button>
              {failedCount > 0 && (
                <button
                  onClick={downloadFailureReport}
                  className="px-6 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors"
                >
                  Download Failure Report
                </button>
              )}
              <button
                onClick={() => {
                  setCsvData(null);
                  setFileName('');
                  resetMappings();
                  setPreviewItems([]);
                  setImportResults([]);
                  setFailedRows([]);
                  setCurrentStep('upload');
                }}
                className="px-6 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
              >
                Start New Import
              </button>
            </div>
          </div>
        )}

        {/* Timeout Warning Modal */}
        <TimeoutWarningModal
          isOpen={showWarning}
          timeRemaining={timeRemaining}
          onContinue={dismissWarning}
        />
      </div>
    </div>
  );
}
