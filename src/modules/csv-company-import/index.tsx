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

interface CompanyFieldConfig {
  id: string;
  name: string;
  type: 'number' | 'text';
}

interface ColumnMapping {
  csvColumn: string;
  mappedTo: 'name' | 'domain' | string | null; // string = custom field ID, null = ignore
}

interface ExistingCompany {
  id: string;
  name: string;
  domain?: string;
}

interface CompanyToImport {
  rowIndex: number;
  name: string;
  domain: string;
  customFields: Record<string, string>;
  existingCompany?: ExistingCompany;
  currentValues?: Record<string, string | number | null>;
  action: 'create' | 'update';
}

interface ImportResult {
  rowIndex: number;
  name: string;
  domain: string;
  action: 'create' | 'update';
  success: boolean;
  companyId?: string;
  error?: string;
  fieldErrors?: string[];
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

// Download import log as CSV
function downloadImportLog(results: ImportResult[]) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `company-import-log-${timestamp}.csv`;

  const escapeCSV = (value: string): string => {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  };

  const createdCount = results.filter(r => r.success && r.action === 'create').length;
  const updatedCount = results.filter(r => r.success && r.action === 'update').length;
  const failedCount = results.filter(r => !r.success).length;

  const headers = ['Row', 'Name', 'Domain', 'Action', 'Status', 'Company ID', 'Error'];
  const rows = results.map(r => [
    String(r.rowIndex + 1),
    escapeCSV(r.name),
    escapeCSV(r.domain),
    r.action === 'create' ? 'Created' : 'Updated',
    r.success ? 'Success' : 'Failed',
    r.companyId || '',
    escapeCSV(r.error || (r.fieldErrors?.join('; ') || ''))
  ]);

  const summary = [
    ['CSV Company Import Log'],
    [`Date: ${new Date().toLocaleString()}`],
    [`Total: ${results.length}`],
    [`Created: ${createdCount}`],
    [`Updated: ${updatedCount}`],
    [`Failed: ${failedCount}`],
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

export default function CSVCompanyImport() {
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

  // Field configuration state
  const [companyFields, setCompanyFields] = useState<CompanyFieldConfig[]>([]);
  const [isLoadingFields, setIsLoadingFields] = useState(false);

  // Mapping state
  const [columnMappings, setColumnMappings] = useState<ColumnMapping[]>([]);

  // Preview state
  const [companiesToImport, setCompaniesToImport] = useState<CompanyToImport[]>([]);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [existingCompanies, setExistingCompanies] = useState<ExistingCompany[]>([]);

  // Import state
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0 });
  const [importResults, setImportResults] = useState<ImportResult[]>([]);

  // Convex actions
  const validateApiKey = useAction(api.productboard.validateApiKey);
  const listCompanies = useAction(api.productboard.listCompanies);
  const listCompanyFields = useAction(api.productboard.listCompanyFields);
  const createCompany = useAction(api.productboard.createCompany);
  const setCompanyFieldValue = useAction(api.productboard.setCompanyFieldValue);
  const getBatchCompanyFieldValues = useAction(api.productboard.getBatchCompanyFieldValues);

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

      // Load company fields
      setIsLoadingFields(true);
      const fieldsResult = await listCompanyFields({ apiToken });
      if (fieldsResult.success) {
        // Filter to only number and text fields
        const filteredFields = (fieldsResult.data || [])
          .filter((f: { id: string; name: string; type: string }) => f.type === 'number' || f.type === 'text')
          .map((f: { id: string; name: string; type: string }) => ({
            id: f.id,
            name: f.name,
            type: f.type as 'number' | 'text',
          }));
        setCompanyFields(filteredFields);
      }
      setIsLoadingFields(false);

      setConnectionStatus('connected');
    } catch (error) {
      setConnectionStatus('error');
      setConnectionError(String(error));
    }
  }, [apiToken, validateApiKey, listCompanyFields]);

  const handleDisconnect = useCallback(() => {
    setApiToken('');
    setConnectionStatus('disconnected');
    setCsvData(null);
    setFileName('');
    setCompanyFields([]);
    setColumnMappings([]);
    setCompaniesToImport([]);
    setExistingCompanies([]);
    setImportResults([]);
    setCurrentStep('upload');
  }, []);

  // Inactivity timeout
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

      // Initialize column mappings
      setColumnMappings(parsed.columns.map(col => ({
        csvColumn: col,
        mappedTo: null,
      })));
    };
    reader.readAsText(file);
  }, []);

  const updateColumnMapping = useCallback((csvColumn: string, mappedTo: string | null) => {
    setColumnMappings(prev => prev.map(m =>
      m.csvColumn === csvColumn ? { ...m, mappedTo } : m
    ));
  }, []);

  const getNameColumn = useCallback(() => {
    return columnMappings.find(m => m.mappedTo === 'name')?.csvColumn || null;
  }, [columnMappings]);

  const getDomainColumn = useCallback(() => {
    return columnMappings.find(m => m.mappedTo === 'domain')?.csvColumn || null;
  }, [columnMappings]);

  const canProceedToPreview = useCallback(() => {
    const hasNameMapping = columnMappings.some(m => m.mappedTo === 'name');
    const hasDomainMapping = columnMappings.some(m => m.mappedTo === 'domain');
    return hasNameMapping && hasDomainMapping;
  }, [columnMappings]);

  const handlePreview = useCallback(async () => {
    if (!csvData) return;

    setIsLoadingPreview(true);
    setCurrentStep('preview');

    const nameColumn = getNameColumn();
    const domainColumn = getDomainColumn();

    if (!nameColumn || !domainColumn) {
      setIsLoadingPreview(false);
      return;
    }

    // Fetch all existing companies
    const allCompanies: ExistingCompany[] = [];
    let nextUrl: string | undefined;

    do {
      const result = await listCompanies({ apiToken, nextUrl });
      if (result.success && result.data) {
        for (const company of result.data) {
          allCompanies.push({
            id: company.id,
            name: company.name,
            domain: company.domain,
          });
        }
        nextUrl = result.nextUrl || undefined;
      } else {
        break;
      }
    } while (nextUrl);

    setExistingCompanies(allCompanies);

    // Build lookup map: "name|domain" -> company
    const companyLookup = new Map<string, ExistingCompany>();
    for (const company of allCompanies) {
      const key = `${company.name.toLowerCase()}|${(company.domain || '').toLowerCase()}`;
      companyLookup.set(key, company);
    }

    // Get custom field mappings
    const customFieldMappings = columnMappings.filter(
      m => m.mappedTo && m.mappedTo !== 'name' && m.mappedTo !== 'domain'
    );
    const mappedFieldIds = customFieldMappings.map(m => m.mappedTo as string);

    // Process CSV rows
    const companies: CompanyToImport[] = [];

    for (let i = 0; i < csvData.rows.length; i++) {
      const row = csvData.rows[i];
      const name = row[nameColumn]?.trim() || '';
      const domain = row[domainColumn]?.trim() || '';

      if (!name || !domain) continue; // Skip rows missing required fields

      // Build custom fields from CSV
      const customFields: Record<string, string> = {};
      for (const mapping of customFieldMappings) {
        const value = row[mapping.csvColumn]?.trim() || '';
        if (mapping.mappedTo) {
          customFields[mapping.mappedTo] = value;
        }
      }

      // Check for existing company
      const key = `${name.toLowerCase()}|${domain.toLowerCase()}`;
      const existing = companyLookup.get(key);

      if (existing) {
        // Will update existing company
        companies.push({
          rowIndex: i,
          name,
          domain,
          customFields,
          existingCompany: existing,
          action: 'update',
        });
      } else {
        // Will create new company
        companies.push({
          rowIndex: i,
          name,
          domain,
          customFields,
          action: 'create',
        });
      }
    }

    // For companies being updated, fetch current field values
    const companiesToUpdate = companies.filter(c => c.action === 'update');
    if (companiesToUpdate.length > 0 && mappedFieldIds.length > 0) {
      for (const company of companiesToUpdate) {
        if (company.existingCompany) {
          const valuesResult = await getBatchCompanyFieldValues({
            apiToken,
            companyId: company.existingCompany.id,
            fieldIds: mappedFieldIds,
          });

          if (valuesResult.success) {
            company.currentValues = {};
            for (const [fieldId, data] of Object.entries(valuesResult.results)) {
              company.currentValues[fieldId] = data.hasValue ? data.value : null;
            }
          }
        }
      }
    }

    setCompaniesToImport(companies);
    setIsLoadingPreview(false);
  }, [csvData, columnMappings, apiToken, getNameColumn, getDomainColumn, listCompanies, getBatchCompanyFieldValues]);

  const handleStartImport = useCallback(async () => {
    if (companiesToImport.length === 0) return;

    setCurrentStep('importing');
    setImportResults([]);

    const results: ImportResult[] = [];
    setImportProgress({ current: 0, total: companiesToImport.length });

    for (let i = 0; i < companiesToImport.length; i++) {
      const company = companiesToImport[i];
      let companyId: string | undefined;
      const fieldErrors: string[] = [];

      if (company.action === 'create') {
        // Create new company
        const createResult = await createCompany({
          apiToken,
          name: company.name,
          domain: company.domain,
        });

        if (!createResult.success) {
          results.push({
            rowIndex: company.rowIndex,
            name: company.name,
            domain: company.domain,
            action: 'create',
            success: false,
            error: createResult.error || 'Failed to create company',
          });
          setImportProgress({ current: i + 1, total: companiesToImport.length });
          continue;
        }

        companyId = createResult.data?.id;
      } else {
        // Update existing company
        companyId = company.existingCompany?.id;
      }

      if (!companyId) {
        results.push({
          rowIndex: company.rowIndex,
          name: company.name,
          domain: company.domain,
          action: company.action,
          success: false,
          error: 'No company ID available',
        });
        setImportProgress({ current: i + 1, total: companiesToImport.length });
        continue;
      }

      // Set custom field values (only non-empty values)
      for (const [fieldId, value] of Object.entries(company.customFields)) {
        if (value === '' || value === null || value === undefined) continue; // Skip empty values

        // Find field type
        const fieldConfig = companyFields.find(f => f.id === fieldId);
        let processedValue: string | number = value;

        if (fieldConfig?.type === 'number') {
          const numValue = parseFloat(value);
          if (!isNaN(numValue)) {
            processedValue = numValue;
          } else {
            fieldErrors.push(`Invalid number value for ${fieldConfig.name}: ${value}`);
            continue;
          }
        }

        const setResult = await setCompanyFieldValue({
          apiToken,
          companyId,
          fieldId,
          fieldType: fieldConfig?.type || 'text',
          value: processedValue,
        });

        if (!setResult.success) {
          const fieldName = fieldConfig?.name || fieldId;
          fieldErrors.push(`${fieldName}: ${setResult.error}`);
        }
      }

      results.push({
        rowIndex: company.rowIndex,
        name: company.name,
        domain: company.domain,
        action: company.action,
        success: fieldErrors.length === 0,
        companyId,
        fieldErrors: fieldErrors.length > 0 ? fieldErrors : undefined,
      });

      setImportProgress({ current: i + 1, total: companiesToImport.length });

      // Rate limiting: 200ms delay every 10 companies
      if ((i + 1) % 10 === 0 && i + 1 < companiesToImport.length) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    setImportResults(results);
    setCurrentStep('results');
  }, [companiesToImport, companyFields, apiToken, createCompany, setCompanyFieldValue]);

  const nameColumn = getNameColumn();
  const domainColumn = getDomainColumn();

  const createCount = companiesToImport.filter(c => c.action === 'create').length;
  const updateCount = companiesToImport.filter(c => c.action === 'update').length;
  const createdSuccessCount = importResults.filter(r => r.success && r.action === 'create').length;
  const updatedSuccessCount = importResults.filter(r => r.success && r.action === 'update').length;
  const failedCount = importResults.filter(r => !r.success).length;

  // Get mapped custom field IDs for preview
  const mappedCustomFields = columnMappings
    .filter(m => m.mappedTo && m.mappedTo !== 'name' && m.mappedTo !== 'domain')
    .map(m => ({
      csvColumn: m.csvColumn,
      fieldId: m.mappedTo as string,
      fieldConfig: companyFields.find(f => f.id === m.mappedTo),
    }));

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto py-8 px-4">
        {/* Header */}
        <div className="mb-8">
          <Link to="/" className="text-blue-600 hover:text-blue-800 text-sm mb-2 inline-block">
            &larr; Back to Scripts
          </Link>
          <h1 className="text-3xl font-bold text-gray-900">CSV Company Import</h1>
          <p className="mt-2 text-gray-600">
            Import companies from a CSV file. Creates new companies or updates existing ones with custom field values.
          </p>

          {/* API Endpoints Used */}
          <div className="mt-4 p-3 bg-gray-100 rounded-lg">
            <p className="text-xs font-medium text-gray-700 mb-2">API Endpoints Used (V1):</p>
            <ul className="text-xs text-gray-600 space-y-1">
              <li>
                <code className="bg-gray-200 px-1 rounded">GET /companies</code>
                {' '}-{' '}
                <a href="https://developer.productboard.com/reference/getcompanies" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Docs</a>
              </li>
              <li>
                <code className="bg-gray-200 px-1 rounded">POST /companies</code>
                {' '}-{' '}
                <a href="https://developer.productboard.com/reference/createcompany" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Docs</a>
              </li>
              <li>
                <code className="bg-gray-200 px-1 rounded">GET /companies/custom-fields</code>
                {' '}-{' '}
                <a href="https://developer.productboard.com/reference/listcompanyfields-1" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Docs</a>
              </li>
              <li>
                <code className="bg-gray-200 px-1 rounded">PUT /companies/:companyId/custom-fields/:fieldId/value</code>
                {' '}-{' '}
                <a href="https://developer.productboard.com/reference/setcompanyfieldvalue-1" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Docs</a>
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
                ? 'Connected to Productboard'
                : connectionStatus === 'connecting'
                ? 'Connecting...'
                : connectionStatus === 'error'
                ? 'Connection failed'
                : 'Not connected'}
            </span>
            {isLoadingFields && (
              <span className="text-sm text-gray-500 ml-2">Loading company fields...</span>
            )}
          </div>

          {connectionError && (
            <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {connectionError}
            </div>
          )}

          {connectionStatus !== 'connected' && (
            <SecurityNotice className="mt-4" />
          )}

          {/* Available Company Fields */}
          {connectionStatus === 'connected' && companyFields.length > 0 && (
            <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm font-medium text-blue-800 mb-2">Available Custom Fields:</p>
              <div className="flex flex-wrap gap-2">
                {companyFields.map(field => (
                  <span key={field.id} className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-sm">
                    {field.name} ({field.type})
                  </span>
                ))}
              </div>
            </div>
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
                      onClick={() => setCurrentStep('mapping')}
                      className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    >
                      Continue to Column Mapping
                    </button>
                  </div>
                </div>
              )
            ) : csvData ? (
              <div className="flex items-center gap-4 text-sm text-gray-600">
                <span className="font-medium text-gray-900">{fileName}</span>
                <span>&bull;</span>
                <span>{csvData.columns.length} columns</span>
                <span>&bull;</span>
                <span>{csvData.rows.length} rows</span>
              </div>
            ) : null}
          </div>
        )}

        {/* Step 2: Column Mapping */}
        {connectionStatus === 'connected' && csvData && (
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                {currentStep !== 'mapping' && currentStep !== 'upload' && nameColumn && domainColumn ? (
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
                <h2 className="text-lg font-semibold text-gray-900">Map Columns</h2>
              </div>
              {currentStep !== 'mapping' && currentStep !== 'upload' && nameColumn && domainColumn && (
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
                  Map each CSV column to a company field. Company Name and Domain are required.
                </p>

                {/* Column headers */}
                <div className="flex items-center gap-4 px-3 py-2 mb-2">
                  <div className="w-1/3">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">CSV Column</span>
                  </div>
                  <div className="w-8"></div>
                  <div className="flex-1">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Company Field</span>
                  </div>
                </div>

                <div className="space-y-3">
                  {columnMappings.slice(0, 10).map(mapping => {
                    // Sort custom fields alphabetically
                    const sortedCustomFields = [...companyFields].sort((a, b) =>
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
                        <div className="text-gray-400">&rarr;</div>
                        <div className="flex-1">
                          <select
                            value={mapping.mappedTo || ''}
                            onChange={(e) => updateColumnMapping(mapping.csvColumn, e.target.value || null)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          >
                            <option value="">Ignore this column</option>
                            <optgroup label="Required Fields">
                              <option value="name">Company Name *</option>
                              <option value="domain">Domain *</option>
                            </optgroup>
                            {sortedCustomFields.length > 0 && (
                              <optgroup label="Custom Fields">
                                {sortedCustomFields.map(field => (
                                  <option key={field.id} value={field.id}>
                                    {field.name} ({field.type})
                                  </option>
                                ))}
                              </optgroup>
                            )}
                          </select>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {columnMappings.length > 10 && (
                  <p className="mt-3 text-sm text-gray-500">
                    Showing first 10 of {columnMappings.length} columns. Remaining columns will be ignored.
                  </p>
                )}

                {/* Validation */}
                <div className="mt-6 space-y-2">
                  {!nameColumn && (
                    <div className="text-sm text-red-600">
                      You must map a column to "Company Name" (required field)
                    </div>
                  )}
                  {!domainColumn && (
                    <div className="text-sm text-red-600">
                      You must map a column to "Domain" (required field)
                    </div>
                  )}
                </div>

                <div className="mt-6 flex justify-between items-center">
                  <button
                    onClick={() => setCurrentStep('upload')}
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
                      onClick={handlePreview}
                      disabled={!canProceedToPreview()}
                      className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed transition-colors"
                    >
                      Preview Import
                    </button>
                  </div>
                </div>
              </>
            ) : currentStep !== 'upload' && nameColumn && domainColumn ? (
              <div className="flex items-center gap-4 text-sm text-gray-600">
                <span className="font-medium text-gray-900">{columnMappings.filter(m => m.mappedTo).length} fields mapped</span>
                <span>&bull;</span>
                <span>
                  {columnMappings.filter(m => m.mappedTo).map(m => {
                    if (m.mappedTo === 'name') return 'Company Name';
                    if (m.mappedTo === 'domain') return 'Domain';
                    const field = companyFields.find(f => f.id === m.mappedTo);
                    return field?.name || m.mappedTo;
                  }).join(', ')}
                </span>
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

            {isLoadingPreview ? (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
                <p className="text-gray-600">Loading companies and preparing preview...</p>
              </div>
            ) : (
              <>
                {/* Summary */}
                <div className="grid grid-cols-4 gap-4 mb-6">
                  <div className="bg-blue-50 p-4 rounded-lg">
                    <div className="text-2xl font-bold text-blue-700">{companiesToImport.length}</div>
                    <div className="text-sm text-blue-600">Total Companies</div>
                  </div>
                  <div className="bg-green-50 p-4 rounded-lg">
                    <div className="text-2xl font-bold text-green-700">{createCount}</div>
                    <div className="text-sm text-green-600">New (Create)</div>
                  </div>
                  <div className="bg-orange-50 p-4 rounded-lg">
                    <div className="text-2xl font-bold text-orange-700">{updateCount}</div>
                    <div className="text-sm text-orange-600">Existing (Update)</div>
                  </div>
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <div className="text-2xl font-bold text-gray-700">{existingCompanies.length}</div>
                    <div className="text-sm text-gray-600">Companies in PB</div>
                  </div>
                </div>

                {/* Companies to Create */}
                {createCount > 0 && (
                  <div className="mb-6">
                    <h3 className="font-medium text-gray-900 mb-3">Companies to Create ({createCount})</h3>
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200 text-sm">
                        <thead className="bg-green-50">
                          <tr>
                            <th className="px-4 py-2 text-left font-medium text-gray-700">Row</th>
                            <th className="px-4 py-2 text-left font-medium text-gray-700">Company Name</th>
                            <th className="px-4 py-2 text-left font-medium text-gray-700">Domain</th>
                            {mappedCustomFields.map(({ fieldConfig }) => (
                              <th key={fieldConfig?.id} className="px-4 py-2 text-left font-medium text-gray-700">
                                {fieldConfig?.name}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {companiesToImport.filter(c => c.action === 'create').slice(0, 10).map((company) => (
                            <tr key={company.rowIndex}>
                              <td className="px-4 py-2 text-gray-500">{company.rowIndex + 1}</td>
                              <td className="px-4 py-2 text-gray-900">{company.name}</td>
                              <td className="px-4 py-2 text-gray-900">{company.domain}</td>
                              {mappedCustomFields.map(({ fieldId }) => (
                                <td key={fieldId} className="px-4 py-2 text-gray-900">
                                  {company.customFields[fieldId] || <span className="text-gray-400 italic">(empty)</span>}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {createCount > 10 && (
                      <p className="text-sm text-gray-500 mt-2">
                        ...and {createCount - 10} more companies to create.
                      </p>
                    )}
                  </div>
                )}

                {/* Companies to Update */}
                {updateCount > 0 && (
                  <div className="mb-6">
                    <h3 className="font-medium text-gray-900 mb-3">Companies to Update ({updateCount})</h3>
                    <p className="text-sm text-gray-600 mb-3">
                      These companies already exist in Productboard (matched by name AND domain). Only non-empty custom field values will be updated.
                    </p>
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200 text-sm">
                        <thead className="bg-orange-50">
                          <tr>
                            <th className="px-4 py-2 text-left font-medium text-gray-700">Row</th>
                            <th className="px-4 py-2 text-left font-medium text-gray-700">Company Name</th>
                            <th className="px-4 py-2 text-left font-medium text-gray-700">Domain</th>
                            {mappedCustomFields.map(({ fieldConfig }) => (
                              <th key={fieldConfig?.id} className="px-4 py-2 text-left font-medium text-gray-700">
                                {fieldConfig?.name}
                                <br />
                                <span className="text-xs font-normal text-gray-500">Current &rarr; New</span>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {companiesToImport.filter(c => c.action === 'update').slice(0, 10).map((company) => (
                            <tr key={company.rowIndex}>
                              <td className="px-4 py-2 text-gray-500">{company.rowIndex + 1}</td>
                              <td className="px-4 py-2 text-gray-900">{company.name}</td>
                              <td className="px-4 py-2 text-gray-900">{company.domain}</td>
                              {mappedCustomFields.map(({ fieldId }) => {
                                const currentValue = company.currentValues?.[fieldId];
                                const newValue = company.customFields[fieldId];
                                const hasChange = newValue && newValue !== String(currentValue ?? '');

                                return (
                                  <td key={fieldId} className="px-4 py-2">
                                    <div className="flex flex-col">
                                      <span className="text-gray-500 text-xs">
                                        {currentValue !== null && currentValue !== undefined ? String(currentValue) : '(empty)'}
                                      </span>
                                      <span className="text-gray-400">&darr;</span>
                                      {newValue ? (
                                        <span className={hasChange ? 'text-orange-600 font-medium' : 'text-gray-600'}>
                                          {newValue}
                                        </span>
                                      ) : (
                                        <span className="text-gray-400 italic">(no change)</span>
                                      )}
                                    </div>
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {updateCount > 10 && (
                      <p className="text-sm text-gray-500 mt-2">
                        ...and {updateCount - 10} more companies to update.
                      </p>
                    )}
                  </div>
                )}

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
                      onClick={handleStartImport}
                      disabled={companiesToImport.length === 0}
                      className="px-8 py-3 bg-green-600 text-white text-lg font-medium rounded-lg hover:bg-green-700 disabled:bg-green-300 disabled:cursor-not-allowed transition-colors"
                    >
                      Start Import ({companiesToImport.length} companies)
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Step 4: Importing */}
        {connectionStatus === 'connected' && currentStep === 'importing' && (
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center animate-pulse">
                <span className="text-white text-sm font-medium">4</span>
              </div>
              <h2 className="text-lg font-semibold text-gray-900">Importing...</h2>
            </div>

            <div className="mb-4">
              <div className="flex justify-between text-sm text-gray-600 mb-2">
                <span>Processing companies...</span>
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

            <div className="grid grid-cols-4 gap-4 mb-6">
              <div className="bg-blue-50 p-4 rounded-lg">
                <div className="text-2xl font-bold text-blue-700">{importResults.length}</div>
                <div className="text-sm text-blue-600">Total Processed</div>
              </div>
              <div className="bg-green-50 p-4 rounded-lg">
                <div className="text-2xl font-bold text-green-700">{createdSuccessCount}</div>
                <div className="text-sm text-green-600">Created</div>
              </div>
              <div className="bg-orange-50 p-4 rounded-lg">
                <div className="text-2xl font-bold text-orange-700">{updatedSuccessCount}</div>
                <div className="text-sm text-orange-600">Updated</div>
              </div>
              <div className="bg-red-50 p-4 rounded-lg">
                <div className="text-2xl font-bold text-red-700">{failedCount}</div>
                <div className="text-sm text-red-600">Failed</div>
              </div>
            </div>

            {failedCount > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
                <h3 className="text-sm font-medium text-red-800 mb-2">Failed Imports:</h3>
                <ul className="text-sm text-red-700 space-y-1 max-h-40 overflow-y-auto">
                  {importResults
                    .filter(r => !r.success)
                    .slice(0, 20)
                    .map((r) => (
                      <li key={r.rowIndex}>
                        Row {r.rowIndex + 1} ({r.name}): {r.error || r.fieldErrors?.join('; ')}
                      </li>
                    ))}
                  {importResults.filter(r => !r.success).length > 20 && (
                    <li>...and {importResults.filter(r => !r.success).length - 20} more errors</li>
                  )}
                </ul>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => downloadImportLog(importResults)}
                className="px-6 py-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition-colors"
              >
                Download Log
              </button>
              <button
                onClick={() => {
                  setCsvData(null);
                  setFileName('');
                  setColumnMappings([]);
                  setCompaniesToImport([]);
                  setExistingCompanies([]);
                  setImportResults([]);
                  setCurrentStep('upload');
                }}
                className="px-6 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
              >
                Import Another CSV
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
