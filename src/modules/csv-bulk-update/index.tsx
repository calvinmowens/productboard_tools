import { useState, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useAction } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { useInactivityTimeout } from '../../hooks/useInactivityTimeout';
import { TimeoutWarningModal } from '../../components/TimeoutWarningModal';
import { SecurityNotice } from '../../components/SecurityNotice';

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
type UpdateStep = 'upload' | 'configure' | 'mapping' | 'preview' | 'updating' | 'results';

interface CSVRow {
  [key: string]: string;
}

interface CustomField {
  id: string;
  name: string;
  type: string;
}

interface ColumnMapping {
  csvColumn: string;
  mappedTo: string | null; // null = ignore, or custom field id
}

interface FieldUpdateDetail {
  fieldId: string;
  fieldName: string;
  oldValue: string | null;
  newValue: string;
  skipped: boolean; // true if skipped due to preserve existing values
}

interface UpdateResult {
  rowIndex: number;
  featureId: string;
  featureName: string;
  success: boolean;
  error?: string;
  fieldUpdates: FieldUpdateDetail[];
  allFieldsSkipped?: boolean; // true if all fields were skipped (nothing to update)
}

interface PreviewItem {
  rowIndex: number;
  featureId: string;
  featureName: string;
  updates: { fieldName: string; value: string }[];
  status: 'valid' | 'not_found' | 'error';
  error?: string;
}

// Parse CSV string into rows
function parseCSV(csvText: string): { columns: string[]; rows: CSVRow[] } {
  const lines = csvText.split('\n').filter(line => line.trim());
  if (lines.length === 0) return { columns: [], rows: [] };

  // Parse header
  const columns = parseCSVLine(lines[0]);

  // Parse rows
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

// Format field value for display
function formatFieldValue(value: any): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if (value.name) return value.name;
    if (value.label) return value.label;
    if (Array.isArray(value)) {
      return value.map(v => v.name || v.label || String(v)).join(', ');
    }
    return JSON.stringify(value);
  }
  return String(value);
}

// Check if a value is considered blank (empty, whitespace, '-', or "'-")
function isBlankValue(value: string | undefined | null): boolean {
  if (value === null || value === undefined) return true;
  const trimmed = value.trim();
  return trimmed === '' || trimmed === '-' || trimmed === "'-";
}

// Download update log as CSV
function downloadUpdateLog(
  results: UpdateResult[],
  mappings: { csvColumn: string; fieldName: string }[],
  preserveExistingValues: boolean
) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `bulk-update-log-${timestamp}.csv`;

  const escapeCSV = (value: string): string => {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  };

  // Build dynamic headers based on field mappings
  // Format: Row, Feature ID, Feature Name, Status, Error, [Field1 Old], [Field1 New], [Field2 Old], [Field2 New], ...
  const baseHeaders = ['Row', 'Feature ID', 'Feature Name', 'Status', 'Error'];
  const fieldHeaders: string[] = [];
  for (const mapping of mappings) {
    fieldHeaders.push(`${mapping.fieldName} (Old)`);
    fieldHeaders.push(`${mapping.fieldName} (New)`);
    fieldHeaders.push(`${mapping.fieldName} (Skipped)`);
  }
  const headers = [...baseHeaders, ...fieldHeaders];

  const rows = results.map(r => {
    // Determine status
    let status = 'Failed';
    if (r.success) {
      if (r.allFieldsSkipped) {
        status = 'Skipped (all fields had data)';
      } else {
        status = 'Updated';
      }
    }

    const baseRow = [
      String(r.rowIndex + 1),
      escapeCSV(r.featureId),
      escapeCSV(r.featureName),
      status,
      escapeCSV(r.error || '')
    ];

    // Add field-level data
    const fieldData: string[] = [];
    for (const mapping of mappings) {
      const fieldUpdate = r.fieldUpdates?.find(f => f.fieldName === mapping.fieldName);
      if (fieldUpdate) {
        fieldData.push(escapeCSV(fieldUpdate.oldValue || ''));
        fieldData.push(escapeCSV(fieldUpdate.newValue || ''));
        fieldData.push(fieldUpdate.skipped ? 'Yes' : 'No');
      } else {
        fieldData.push('');
        fieldData.push('');
        fieldData.push('');
      }
    }

    return [...baseRow, ...fieldData];
  });

  // Calculate metrics
  const successCount = results.filter(r => r.success && !r.allFieldsSkipped).length;
  const failedCount = results.filter(r => !r.success).length;
  const fullySkippedCount = results.filter(r => r.allFieldsSkipped).length;
  const totalFieldsUpdated = results.reduce((acc, r) => {
    if (!r.success) return acc;
    return acc + (r.fieldUpdates?.filter(f => !f.skipped).length || 0);
  }, 0);
  const totalFieldsSkipped = results.reduce((acc, r) => {
    return acc + (r.fieldUpdates?.filter(f => f.skipped).length || 0);
  }, 0);

  const fieldsList = mappings.map(m => `${m.csvColumn} -> ${m.fieldName}`).join(', ');
  const summary = [
    ['CSV Bulk Update Log'],
    [`Date: ${new Date().toLocaleString()}`],
    [`Preserve Existing Values: ${preserveExistingValues ? 'Yes' : 'No'}`],
    [`Field Mappings: ${fieldsList}`],
    [''],
    ['Summary'],
    [`Total Features Processed: ${results.length}`],
    [`Features Updated: ${successCount}`],
    [`Features Failed: ${failedCount}`],
    ...(preserveExistingValues ? [
      [`Features Skipped (all fields had data): ${fullySkippedCount}`],
      [`Total Fields Updated: ${totalFieldsUpdated}`],
      [`Total Fields Skipped (preserved existing): ${totalFieldsSkipped}`],
    ] : []),
    [''],
    headers,
    ...rows
  ];

  const csvContent = summary.map(row => row.join(',')).join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export default function CSVBulkUpdate() {
  // Authentication state
  const [apiToken, setApiToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [connectionError, setConnectionError] = useState<string | null>(null);

  // Step state
  const [currentStep, setCurrentStep] = useState<UpdateStep>('upload');

  // CSV state
  const [csvData, setCsvData] = useState<{ columns: string[]; rows: CSVRow[] } | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Configuration state
  const [uuidColumn, setUuidColumn] = useState<string>('');
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [isLoadingFields, setIsLoadingFields] = useState(false);

  // Mapping state
  const [columnMappings, setColumnMappings] = useState<ColumnMapping[]>([]);
  const [preserveExistingValues, setPreserveExistingValues] = useState(true);

  // Preview state
  const [previewItems, setPreviewItems] = useState<PreviewItem[]>([]);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);

  // Update state
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateProgress, setUpdateProgress] = useState({ current: 0, total: 0 });
  const [updateResults, setUpdateResults] = useState<UpdateResult[]>([]);

  // Convex actions
  const validateApiKey = useAction(api.productboard.validateApiKey);
  const listCustomFields = useAction(api.productboard.listCustomFields);
  const updateFeatureCustomFields = useAction(api.productboard.updateFeatureCustomFields);
  const getFeature = useAction(api.productboard.getFeature);
  const getCustomFieldValue = useAction(api.productboard.getCustomFieldValue);

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

      // Load custom fields
      setIsLoadingFields(true);
      const fieldsResult = await listCustomFields({ apiToken });
      if (fieldsResult.success && fieldsResult.data) {
        setCustomFields(fieldsResult.data);
      }
      setIsLoadingFields(false);

      setConnectionStatus('connected');
    } catch (error) {
      setConnectionStatus('error');
      setConnectionError(String(error));
    }
  }, [apiToken, validateApiKey, listCustomFields]);

  const handleDisconnect = useCallback(() => {
    setApiToken('');
    setConnectionStatus('disconnected');
    setCsvData(null);
    setFileName('');
    setUuidColumn('');
    setCustomFields([]);
    setColumnMappings([]);
    setPreserveExistingValues(true);
    setPreviewItems([]);
    setUpdateResults([]);
    setCurrentStep('upload');
  }, []);

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

      // Initialize column mappings (all ignored by default)
      setColumnMappings(parsed.columns.map(col => ({
        csvColumn: col,
        mappedTo: null,
      })));
    };
    reader.readAsText(file);
  }, []);

  const handleUuidColumnChange = useCallback((column: string) => {
    setUuidColumn(column);
  }, []);

  const updateColumnMapping = useCallback((csvColumn: string, mappedTo: string | null) => {
    setColumnMappings(prev => prev.map(m =>
      m.csvColumn === csvColumn ? { ...m, mappedTo } : m
    ));
  }, []);

  const getValueColumns = useCallback(() => {
    return columnMappings.filter(m => m.mappedTo && m.csvColumn !== uuidColumn);
  }, [columnMappings, uuidColumn]);

  const canProceedToPreview = useCallback(() => {
    const hasUuidColumn = !!uuidColumn;
    const hasAtLeastOneMapping = getValueColumns().length > 0;
    return hasUuidColumn && hasAtLeastOneMapping;
  }, [uuidColumn, getValueColumns]);

  const handleLoadPreview = useCallback(() => {
    if (!csvData || !uuidColumn) return;

    setIsLoadingPreview(true);
    setPreviewItems([]);

    const valueColumns = getValueColumns();
    const items: PreviewItem[] = [];

    // Preview first 100 rows max (fast - no API calls)
    const rowsToPreview = csvData.rows.slice(0, 100);

    for (let i = 0; i < rowsToPreview.length; i++) {
      const row = rowsToPreview[i];
      const featureId = row[uuidColumn]?.trim();

      if (!featureId || featureId === '-') {
        items.push({
          rowIndex: i,
          featureId: '(empty)',
          featureName: '',
          updates: [],
          status: 'error',
          error: 'Missing feature UUID',
        });
        continue;
      }

      // Build updates list - only include non-blank values that parse as numbers
      const updates: { fieldName: string; value: string }[] = [];
      for (const mapping of valueColumns) {
        const field = customFields.find(f => f.id === mapping.mappedTo);
        if (field) {
          const value = row[mapping.csvColumn];
          if (!isBlankValue(value)) {
            // Remove % symbol and trim
            const cleanedValue = value.trim().replace(/%/g, '');
            const numericValue = parseFloat(cleanedValue);
            if (!isNaN(numericValue)) {
              updates.push({
                fieldName: field.name,
                value: String(numericValue),
              });
            }
          }
        }
      }

      // Skip rows with no values to update
      if (updates.length === 0) {
        items.push({
          rowIndex: i,
          featureId,
          featureName: '',
          updates: [],
          status: 'error',
          error: 'No values to update (all mapped columns are blank)',
        });
        continue;
      }

      items.push({
        rowIndex: i,
        featureId,
        featureName: '', // Not fetching names in preview for speed
        updates,
        status: 'valid',
      });
    }

    setPreviewItems(items);
    setIsLoadingPreview(false);
    setCurrentStep('preview');
  }, [csvData, uuidColumn, getValueColumns, customFields]);

  const handleStartUpdate = useCallback(async () => {
    if (!csvData || !uuidColumn) return;

    setCurrentStep('updating');
    setIsUpdating(true);
    setUpdateResults([]);

    const valueColumns = getValueColumns();
    const results: UpdateResult[] = [];

    // Filter rows that have valid UUIDs and at least one non-blank value
    const rowsToProcess: { rowIndex: number; row: CSVRow }[] = [];
    for (let i = 0; i < csvData.rows.length; i++) {
      const row = csvData.rows[i];
      const featureId = row[uuidColumn]?.trim();

      // Skip if no UUID or UUID is blank
      if (isBlankValue(featureId)) {
        continue;
      }

      // Check if there's at least one non-blank value to update
      const hasValueToUpdate = valueColumns.some(mapping => {
        const value = row[mapping.csvColumn];
        return !isBlankValue(value);
      });

      if (hasValueToUpdate) {
        rowsToProcess.push({ rowIndex: i, row });
      }
    }

    setUpdateProgress({ current: 0, total: rowsToProcess.length });

    for (let i = 0; i < rowsToProcess.length; i++) {
      const { rowIndex, row } = rowsToProcess[i];
      const featureId = row[uuidColumn]!.trim();

      // Fetch feature details to get the name
      let featureName = featureId;
      try {
        const featureResult = await getFeature({ apiToken, featureId });
        if (featureResult.success && featureResult.data) {
          featureName = featureResult.data.name || featureId;
        }
      } catch {
        // Continue with UUID as name if fetch fails
      }

      // Build field updates with old/new values tracking
      const fieldUpdates: FieldUpdateDetail[] = [];
      const customFieldUpdates: { fieldId: string; fieldType: string; value: any }[] = [];

      for (const mapping of valueColumns) {
        const field = customFields.find(f => f.id === mapping.mappedTo);
        if (field) {
          const csvValue = row[mapping.csvColumn];
          if (!isBlankValue(csvValue)) {
            // Remove % symbol and trim
            const cleanedValue = csvValue!.trim().replace(/%/g, '');
            const numericValue = parseFloat(cleanedValue);

            if (!isNaN(numericValue)) {
              // Fetch current field value if we need to check for existing data
              let oldValue: string | null = null;
              let shouldSkip = false;

              if (preserveExistingValues) {
                try {
                  const currentValueResult = await getCustomFieldValue({
                    apiToken,
                    customFieldId: field.id,
                    featureId,
                  });

                  if (currentValueResult.success && currentValueResult.hasValue) {
                    oldValue = formatFieldValue(currentValueResult.value);
                    shouldSkip = true; // Skip this field - it has existing data
                  }
                } catch {
                  // If we can't fetch, proceed with update
                }
              }

              fieldUpdates.push({
                fieldId: field.id,
                fieldName: field.name,
                oldValue,
                newValue: String(numericValue),
                skipped: shouldSkip,
              });

              if (!shouldSkip) {
                customFieldUpdates.push({
                  fieldId: field.id,
                  fieldType: field.type,
                  value: numericValue,
                });
              }
            }
          }
        }
      }

      // Check if all fields were skipped (nothing to update)
      const allFieldsSkipped = fieldUpdates.length > 0 && customFieldUpdates.length === 0;

      if (allFieldsSkipped) {
        // All fields had existing values and were skipped
        results.push({
          rowIndex,
          featureId,
          featureName,
          success: true,
          fieldUpdates,
          allFieldsSkipped: true,
        });
      } else if (customFieldUpdates.length === 0) {
        // No valid updates after cleaning (shouldn't happen often)
        continue;
      } else {
        // Perform the update
        try {
          const result = await updateFeatureCustomFields({
            apiToken,
            featureId,
            customFields: customFieldUpdates,
          });

          results.push({
            rowIndex,
            featureId,
            featureName,
            success: result.success,
            error: result.error,
            fieldUpdates,
            allFieldsSkipped: false,
          });
        } catch (error) {
          results.push({
            rowIndex,
            featureId,
            featureName,
            success: false,
            error: String(error),
            fieldUpdates,
            allFieldsSkipped: false,
          });
        }
      }

      setUpdateProgress({ current: i + 1, total: rowsToProcess.length });

      // Rate limiting delay
      if ((i + 1) % 10 === 0 && i + 1 < rowsToProcess.length) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    setUpdateResults(results);
    setIsUpdating(false);
    setCurrentStep('results');
  }, [csvData, uuidColumn, getValueColumns, customFields, apiToken, updateFeatureCustomFields, getFeature, getCustomFieldValue, preserveExistingValues]);

  const valueColumns = getValueColumns();
  const previewRows = csvData?.rows.slice(0, 10) || [];

  // Results calculations
  const successCount = updateResults.filter(r => r.success && !r.allFieldsSkipped).length;
  const failedCount = updateResults.filter(r => !r.success).length;
  const fullySkippedCount = updateResults.filter(r => r.allFieldsSkipped).length;

  // Field-level counts
  const totalFieldsUpdated = updateResults.reduce((acc, r) => {
    if (!r.success) return acc;
    return acc + (r.fieldUpdates?.filter(f => !f.skipped).length || 0);
  }, 0);
  const totalFieldsSkipped = updateResults.reduce((acc, r) => {
    return acc + (r.fieldUpdates?.filter(f => f.skipped).length || 0);
  }, 0);

  const validPreviewCount = previewItems.filter(p => p.status === 'valid').length;
  const skippedPreviewCount = previewItems.filter(p => p.status !== 'valid').length;

  // Calculate total rows that will be processed (have UUID and at least one numeric value)
  const rowsToProcessCount = csvData?.rows.filter(row => {
    const featureId = row[uuidColumn]?.trim();
    if (isBlankValue(featureId)) return false;
    return valueColumns.some(mapping => {
      const value = row[mapping.csvColumn];
      if (isBlankValue(value)) return false;
      const cleanedValue = value.trim().replace(/%/g, '');
      return !isNaN(parseFloat(cleanedValue));
    });
  }).length || 0;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto py-8 px-4">
        {/* Header */}
        <div className="mb-8">
          <Link to="/" className="text-blue-600 hover:text-blue-800 text-sm mb-2 inline-block">
            ← Back to Scripts
          </Link>
          <h1 className="text-3xl font-bold text-gray-900">CSV Bulk Update</h1>
          <p className="mt-2 text-gray-600">
            Update existing features' custom field values from a CSV file.
          </p>

          {/* API Endpoints Used */}
          <div className="mt-4 p-3 bg-gray-100 rounded-lg">
            <p className="text-xs font-medium text-gray-700 mb-2">API Endpoints Used (V1):</p>
            <ul className="text-xs text-gray-600 space-y-1">
              <li>
                <code className="bg-gray-200 px-1 rounded">PATCH /features/:id</code>
                {' '}-{' '}
                <a href="https://developer.productboard.com/reference/updatefeature" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Docs</a>
              </li>
              <li>
                <code className="bg-gray-200 px-1 rounded">GET /hierarchy-entities/custom-fields</code>
                {' '}-{' '}
                <a href="https://developer.productboard.com/reference/listcustomfields" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Docs</a>
              </li>
            </ul>
          </div>
        </div>

        {/* API Key Section */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">API Authentication</h2>

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
                ? `Connected - ${customFields.length} custom fields loaded`
                : connectionStatus === 'connecting'
                ? isLoadingFields ? 'Loading custom fields...' : 'Connecting...'
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
                    CSV should have a column with feature UUIDs and columns with values to update
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
                          setUuidColumn('');
                          setColumnMappings([]);
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
                      onClick={() => setCurrentStep('configure')}
                      className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    >
                      Continue to Configuration
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

        {/* Step 2: Configure UUID Column */}
        {connectionStatus === 'connected' && csvData && currentStep !== 'upload' && (
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                {currentStep !== 'configure' && currentStep !== 'upload' && uuidColumn ? (
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
                <h2 className="text-lg font-semibold text-gray-900">Configure UUID Column</h2>
              </div>
              {currentStep !== 'configure' && currentStep !== 'upload' && uuidColumn && (
                <button
                  onClick={() => setCurrentStep('configure')}
                  className="text-sm text-blue-600 hover:text-blue-800"
                >
                  Edit
                </button>
              )}
            </div>

            {currentStep === 'configure' ? (
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Which column contains the Feature UUIDs?
                  </label>
                  <select
                    value={uuidColumn}
                    onChange={(e) => handleUuidColumnChange(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="">Select column...</option>
                    {csvData.columns.map(col => (
                      <option key={col} value={col}>{col}</option>
                    ))}
                  </select>
                  {uuidColumn && csvData.rows[0] && (
                    <p className="text-xs text-gray-500 mt-2">
                      Sample value: {csvData.rows[0][uuidColumn] || '(empty)'}
                    </p>
                  )}
                </div>

                {uuidColumn && (
                  <div className="flex justify-between items-center">
                    <button
                      onClick={() => setCurrentStep('upload')}
                      className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => setCurrentStep('mapping')}
                      className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    >
                      Continue to Field Mapping
                    </button>
                  </div>
                )}
              </div>
            ) : uuidColumn ? (
              <div className="flex items-center gap-4 text-sm text-gray-600">
                <span className="font-medium text-gray-900">UUID Column: {uuidColumn}</span>
              </div>
            ) : null}
          </div>
        )}

        {/* Step 3: Map Columns to Custom Fields */}
        {connectionStatus === 'connected' && csvData && uuidColumn && currentStep !== 'upload' && currentStep !== 'configure' && (
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                {currentStep !== 'mapping' && currentStep !== 'configure' && currentStep !== 'upload' && valueColumns.length > 0 ? (
                  <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center">
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                ) : (
                  <div className="w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center">
                    <span className="text-white text-sm font-medium">3</span>
                  </div>
                )}
                <h2 className="text-lg font-semibold text-gray-900">Map Columns to Custom Fields</h2>
              </div>
              {currentStep !== 'mapping' && currentStep !== 'configure' && currentStep !== 'upload' && valueColumns.length > 0 && (
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
                <p className="text-sm text-gray-600 mb-6">
                  Map each CSV column to a custom field. The UUID column is excluded from mapping.
                </p>

                {/* Column headers */}
                <div className="flex items-center gap-4 px-3 py-2 mb-2">
                  <div className="w-1/3">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">CSV Column</span>
                  </div>
                  <div className="w-8"></div>
                  <div className="flex-1">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Custom Field</span>
                  </div>
                </div>

                <div className="space-y-3">
                  {columnMappings
                    .filter(m => m.csvColumn !== uuidColumn)
                    .slice(0, 10)
                    .map(mapping => {
                      // Sort custom fields alphabetically
                      const sortedFields = [...customFields].sort((a, b) =>
                        a.name.localeCompare(b.name)
                      );

                      return (
                        <div key={mapping.csvColumn} className="flex items-center gap-4 p-3 bg-gray-50 rounded-lg">
                          <div className="w-1/3">
                            <span className="font-medium text-gray-900">{mapping.csvColumn}</span>
                            <p className="text-xs text-gray-500 truncate">
                              e.g., "{csvData.rows[0]?.[mapping.csvColumn]?.substring(0, 30) || ''}"
                            </p>
                          </div>
                          <div className="text-gray-400">→</div>
                          <div className="flex-1">
                            <select
                              value={mapping.mappedTo || ''}
                              onChange={(e) => updateColumnMapping(mapping.csvColumn, e.target.value || null)}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            >
                              <option value="">Ignore this column</option>
                              {sortedFields.map(field => (
                                <option key={field.id} value={field.id}>
                                  {field.name} ({field.type})
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      );
                    })}
                </div>

                {columnMappings.filter(m => m.csvColumn !== uuidColumn).length > 10 && (
                  <p className="mt-3 text-sm text-gray-500">
                    Showing first 10 of {columnMappings.filter(m => m.csvColumn !== uuidColumn).length} columns. Remaining columns will be ignored.
                  </p>
                )}

                {/* Preserve existing values checkbox */}
                {valueColumns.length > 0 && (
                  <div className="mt-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={preserveExistingValues}
                        onChange={(e) => setPreserveExistingValues(e.target.checked)}
                        className="mt-1 w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                      />
                      <div>
                        <span className="font-medium text-gray-900">Preserve any existing values (don't overwrite)</span>
                        <p className="text-sm text-gray-500 mt-1">
                          When enabled, fields that already have data in Productboard will be skipped.
                          Only empty fields will be updated with values from the CSV.
                        </p>
                      </div>
                    </label>
                  </div>
                )}

                {/* Validation */}
                <div className="mt-6 space-y-2">
                  {valueColumns.length === 0 && (
                    <div className="text-sm text-red-600">
                      You must map at least one column to a custom field
                    </div>
                  )}
                </div>

                <div className="mt-6 flex justify-between items-center">
                  <button
                    onClick={() => setCurrentStep('configure')}
                    className="px-6 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
                  >
                    Back
                  </button>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setCurrentStep('upload')}
                      className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleLoadPreview}
                      disabled={!canProceedToPreview() || isLoadingPreview}
                      className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed transition-colors"
                    >
                      {isLoadingPreview ? 'Loading Preview...' : 'Preview Updates'}
                    </button>
                  </div>
                </div>
              </>
            ) : valueColumns.length > 0 ? (
              <div className="flex items-center gap-4 text-sm text-gray-600">
                <span className="font-medium text-gray-900">{valueColumns.length} fields mapped</span>
                <span>-</span>
                <span>{valueColumns.map(m => {
                  const field = customFields.find(f => f.id === m.mappedTo);
                  return field?.name || m.mappedTo;
                }).join(', ')}</span>
              </div>
            ) : null}
          </div>
        )}

        {/* Step 4: Preview */}
        {connectionStatus === 'connected' && currentStep === 'preview' && csvData && (
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center">
                <span className="text-white text-sm font-medium">4</span>
              </div>
              <h2 className="text-lg font-semibold text-gray-900">Preview Updates</h2>
            </div>

            {/* Preserve/Overwrite Warning Banner */}
            {preserveExistingValues ? (
              <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex items-start gap-3">
                  <svg className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div>
                    <p className="font-medium text-blue-800">Preserve existing values enabled</p>
                    <p className="text-sm text-blue-700 mt-1">
                      Fields that already have data in Productboard will be skipped. Only empty fields will be updated.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                <div className="flex items-start gap-3">
                  <svg className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <div>
                    <p className="font-medium text-amber-800">Overwrite mode enabled</p>
                    <p className="text-sm text-amber-700 mt-1">
                      Existing values in Productboard will be overwritten with CSV values. This cannot be undone.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Summary */}
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="bg-blue-50 p-4 rounded-lg">
                <div className="text-2xl font-bold text-blue-700">{csvData.rows.length}</div>
                <div className="text-sm text-blue-600">Total Rows</div>
              </div>
              <div className="bg-green-50 p-4 rounded-lg">
                <div className="text-2xl font-bold text-green-700">{validPreviewCount}</div>
                <div className="text-sm text-green-600">Will Update</div>
              </div>
              <div className="bg-gray-100 p-4 rounded-lg">
                <div className="text-2xl font-bold text-gray-700">{skippedPreviewCount}</div>
                <div className="text-sm text-gray-600">Skipped (No Values)</div>
              </div>
            </div>

            {/* Update Summary */}
            <div className="bg-gray-50 rounded-lg p-4 mb-6">
              <h3 className="font-medium text-gray-900 mb-2">Update Summary</h3>
              <ul className="text-sm text-gray-600 space-y-1">
                <li>UUID Column: <span className="font-medium">{uuidColumn}</span></li>
                <li>
                  Fields to Update:{' '}
                  <span className="font-medium">
                    {valueColumns.map(m => {
                      const field = customFields.find(f => f.id === m.mappedTo);
                      return field?.name || m.mappedTo;
                    }).join(', ')}
                  </span>
                </li>
              </ul>
            </div>

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
                      <th className="px-4 py-2 text-left font-medium text-gray-700">Feature</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-700">Updates</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-700">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {previewItems.slice(0, 20).map((item) => (
                      <tr key={item.rowIndex} className={item.status !== 'valid' ? 'bg-gray-50 text-gray-400' : ''}>
                        <td className="px-4 py-2 text-gray-500">{item.rowIndex + 1}</td>
                        <td className="px-4 py-2">
                          <div className="text-gray-900 font-medium">{item.featureName || item.featureId}</div>
                          {item.featureName && (
                            <div className="text-xs text-gray-500 font-mono">{item.featureId}</div>
                          )}
                        </td>
                        <td className="px-4 py-2">
                          {item.updates.length > 0 ? (
                            <div className="space-y-1">
                              {item.updates.map((u, idx) => (
                                <div key={idx} className="text-xs">
                                  <span className="text-gray-500">{u.fieldName}:</span>{' '}
                                  <span className="text-gray-900">{u.value || '(empty)'}</span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span className="text-gray-400 italic">-</span>
                          )}
                        </td>
                        <td className="px-4 py-2">
                          <span className={`px-2 py-1 text-xs font-medium rounded ${
                            item.status === 'valid'
                              ? 'bg-green-100 text-green-700'
                              : 'bg-gray-200 text-gray-600'
                          }`}>
                            {item.status === 'valid' ? 'Ready' : 'Skipped'}
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
              {previewItems.length > 20 && (
                <p className="text-sm text-gray-500 mt-2">
                  ...and {previewItems.length - 20} more rows not shown in preview.
                </p>
              )}
              {csvData.rows.length > 100 && (
                <p className="text-sm text-gray-500 mt-2">
                  Note: Preview shows first 100 rows. All rows with values will be processed during update.
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
                  onClick={() => setCurrentStep('upload')}
                  className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleStartUpdate}
                  disabled={rowsToProcessCount === 0}
                  className="px-8 py-3 bg-green-600 text-white text-lg font-medium rounded-lg hover:bg-green-700 disabled:bg-green-300 disabled:cursor-not-allowed transition-colors"
                >
                  Start Update ({rowsToProcessCount} features)
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Step 5: Updating */}
        {connectionStatus === 'connected' && currentStep === 'updating' && (
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center animate-pulse">
                <span className="text-white text-sm font-medium">5</span>
              </div>
              <h2 className="text-lg font-semibold text-gray-900">Updating Features...</h2>
            </div>

            <div className="mb-4">
              <div className="flex justify-between text-sm text-gray-600 mb-2">
                <span>Updating features...</span>
                <span>{updateProgress.current} / {updateProgress.total}</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-3">
                <div
                  className="bg-blue-600 h-3 rounded-full transition-all duration-300"
                  style={{ width: `${(updateProgress.current / updateProgress.total) * 100}%` }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Step 6: Results */}
        {connectionStatus === 'connected' && currentStep === 'results' && (
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center">
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-gray-900">Update Complete</h2>
            </div>

            {/* Feature-level metrics */}
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div className="bg-green-50 p-4 rounded-lg">
                <div className="text-2xl font-bold text-green-700">{successCount}</div>
                <div className="text-sm text-green-600">Features Updated</div>
              </div>
              <div className="bg-red-50 p-4 rounded-lg">
                <div className="text-2xl font-bold text-red-700">{failedCount}</div>
                <div className="text-sm text-red-600">Features Failed</div>
              </div>
              {preserveExistingValues && (
                <div className="bg-gray-100 p-4 rounded-lg">
                  <div className="text-2xl font-bold text-gray-700">{fullySkippedCount}</div>
                  <div className="text-sm text-gray-600">Features Skipped (all fields had data)</div>
                </div>
              )}
            </div>

            {/* Field-level metrics */}
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="bg-blue-50 p-4 rounded-lg">
                <div className="text-2xl font-bold text-blue-700">{totalFieldsUpdated}</div>
                <div className="text-sm text-blue-600">Fields Updated</div>
              </div>
              {preserveExistingValues && (
                <div className="bg-gray-100 p-4 rounded-lg">
                  <div className="text-2xl font-bold text-gray-700">{totalFieldsSkipped}</div>
                  <div className="text-sm text-gray-600">Fields Skipped (preserved existing)</div>
                </div>
              )}
            </div>

            {failedCount > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
                <h3 className="text-sm font-medium text-red-800 mb-2">Failed Updates:</h3>
                <ul className="text-sm text-red-700 space-y-1 max-h-40 overflow-y-auto">
                  {updateResults
                    .filter(r => !r.success)
                    .slice(0, 20)
                    .map((r) => (
                      <li key={r.rowIndex}>
                        Row {r.rowIndex + 1} ({r.featureId}): {r.error}
                      </li>
                    ))}
                  {updateResults.filter(r => !r.success).length > 20 && (
                    <li>...and {updateResults.filter(r => !r.success).length - 20} more errors</li>
                  )}
                </ul>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => downloadUpdateLog(
                  updateResults,
                  valueColumns.map(m => ({
                    csvColumn: m.csvColumn,
                    fieldName: customFields.find(f => f.id === m.mappedTo)?.name || m.mappedTo || '',
                  })),
                  preserveExistingValues
                )}
                className="px-6 py-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition-colors"
              >
                Download Log
              </button>
              <button
                onClick={() => {
                  setCsvData(null);
                  setFileName('');
                  setUuidColumn('');
                  setColumnMappings([]);
                  setPreserveExistingValues(true);
                  setPreviewItems([]);
                  setUpdateResults([]);
                  setCurrentStep('upload');
                }}
                className="px-6 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
              >
                Start New Update
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
